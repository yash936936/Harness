import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface CredentialStore {
  get(key: string): Promise<string | undefined>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/** Thrown by `KeychainCredentialStore` when the OS backend itself can't be reached (not "no entry" - that's `undefined`). */
export class KeychainUnavailableError extends Error {
  override name = 'KeychainUnavailableError'
  constructor(message: string, public cause?: unknown) {
    super(message)
  }
}

let keyringModule: Promise<typeof import('@napi-rs/keyring')> | undefined
/** Lazy, memoized - so an unsupported platform (no prebuilt binary) fails on first *use*, not at process/module load. */
function loadKeyring() {
  if (!keyringModule) keyringModule = import('@napi-rs/keyring')
  return keyringModule
}

/**
 * Wraps the OS credential store (Windows Credential Manager / macOS
 * Keychain / Linux Secret Service, via `@napi-rs/keyring`). Real-world
 * check (not assumed): in an environment with no live secret-service
 * session (a headless container, some minimal Linux setups), `getPassword`
 * for a missing entry returns `null` quietly, but `setPassword` throws
 * `"Couldn't access platform storage: ..."` - so failure is only reliably
 * visible on a write, not a read. That is exactly why this class is never
 * used alone in `AppCore` - see `AutoCredentialStore` below, which proves
 * the backend actually works with a round-trip before trusting it.
 */
export class KeychainCredentialStore implements CredentialStore {
  constructor(private readonly service: string) {}

  async get(key: string): Promise<string | undefined> {
    try {
      const { Entry } = await loadKeyring()
      const value = new Entry(this.service, key).getPassword()
      return value ?? undefined
    } catch (e) {
      throw new KeychainUnavailableError(`keychain: could not read "${key}" - ${describe(e)}`, e)
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const { Entry } = await loadKeyring()
      new Entry(this.service, key).setPassword(value)
    } catch (e) {
      throw new KeychainUnavailableError(`keychain: could not store "${key}" - ${describe(e)}`, e)
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const { Entry } = await loadKeyring()
      new Entry(this.service, key).deletePassword()
    } catch (e) {
      throw new KeychainUnavailableError(`keychain: could not delete "${key}" - ${describe(e)}`, e)
    }
  }
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export interface FileCredentialStoreConfig {
  /** Path to the encrypted credentials file. */
  path: string
  /** Path to the local encryption key file. Default: `<path>.key`, alongside it. */
  keyPath?: string
}

/**
 * Fallback when the OS keychain is unavailable. Values are encrypted at
 * rest with AES-256-GCM using a key generated once and stored in a
 * sibling file.
 *
 * Honest limit, not glossed over: the key lives on the same disk as the
 * data it protects, readable by the same user. This stops a credential
 * from sitting in plain text - it defends against passive exposure
 * (backups, sync tools, a stray `cat` of the wrong file, disk loss without
 * full-disk encryption) - but it does **not** defend against another
 * process running as the same OS user, which could read both files the
 * same way this code does. That level of protection is what the OS
 * keychain path provides; this class exists for when that path isn't
 * available, not as its equal.
 */
export class FileCredentialStore implements CredentialStore {
  constructor(private readonly config: FileCredentialStoreConfig) {}

  private get keyPath(): string {
    return this.config.keyPath ?? `${this.config.path}.key`
  }

  private async loadOrCreateKey(): Promise<Buffer> {
    try {
      return await readFile(this.keyPath)
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e
      const key = randomBytes(32)
      await mkdir(dirname(this.keyPath), { recursive: true })
      await writeFile(this.keyPath, key, { mode: 0o600 })
      await chmod(this.keyPath, 0o600).catch(() => {}) // best-effort; a no-op-ish permission model on Windows
      return key
    }
  }

  private async readAll(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(this.config.path, 'utf8')
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (e: any) {
      if (e?.code === 'ENOENT') return {}
      throw e
    }
  }

  private async writeAll(all: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.config.path), { recursive: true })
    const tmp = `${this.config.path}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
    await writeFile(tmp, JSON.stringify(all, null, 2), { mode: 0o600 })
    await rename(tmp, this.config.path)
  }

  async get(key: string): Promise<string | undefined> {
    const all = await this.readAll()
    const packed = all[key]
    if (!packed) return undefined
    const keyBuf = await this.loadOrCreateKey()
    return decrypt(packed, keyBuf)
  }

  async set(key: string, value: string): Promise<void> {
    const keyBuf = await this.loadOrCreateKey()
    const all = await this.readAll()
    all[key] = encrypt(value, keyBuf)
    await this.writeAll(all)
  }

  async delete(key: string): Promise<void> {
    const all = await this.readAll()
    if (!(key in all)) return
    delete all[key]
    await this.writeAll(all)
  }
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv, tag, ciphertext].map((b) => b.toString('base64')).join(':')
}

function decrypt(packed: string, key: Buffer): string {
  const [ivB64, tagB64, ctB64] = packed.split(':')
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('credentials: malformed stored value')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8')
}

/**
 * The store `AppCore` actually uses: tries `primary` (the OS keychain)
 * first, but only trusts it after a real round-trip - set a probe value,
 * read it back, confirm it matches - since (per `KeychainCredentialStore`'s
 * own doc) a broken backend can fail silently on read. The verdict is
 * cached for this instance's lifetime; a keychain that starts working
 * mid-process is not retried (matches how most such systems behave -
 * documented, not hidden).
 */
export class AutoCredentialStore implements CredentialStore {
  private resolved: Promise<CredentialStore> | undefined

  constructor(
    private readonly primary: CredentialStore,
    private readonly fallback: CredentialStore,
    private readonly probeKey = '__harness_probe__',
  ) {}

  private async resolve(): Promise<CredentialStore> {
    if (!this.resolved) this.resolved = this.probe()
    return this.resolved
  }

  private async probe(): Promise<CredentialStore> {
    const probeValue = `probe-${randomBytes(8).toString('hex')}`
    try {
      await this.primary.set(this.probeKey, probeValue)
      const readBack = await this.primary.get(this.probeKey)
      await this.primary.delete(this.probeKey).catch(() => {})
      return readBack === probeValue ? this.primary : this.fallback
    } catch {
      return this.fallback
    }
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.resolve()).get(key)
  }

  async set(key: string, value: string): Promise<void> {
    return (await this.resolve()).set(key, value)
  }

  async delete(key: string): Promise<void> {
    return (await this.resolve()).delete(key)
  }
}
