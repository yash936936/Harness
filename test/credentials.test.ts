import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AutoCredentialStore,
  FileCredentialStore,
  KeychainCredentialStore,
  KeychainUnavailableError,
  type CredentialStore,
} from '../src/bundles/app-core/credentials.js'

describe('FileCredentialStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'credentials-test-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a value, and a missing key resolves to undefined', async () => {
    const store = new FileCredentialStore({ path: join(dir, 'creds.json') })
    expect(await store.get('missing')).toBeUndefined()
    await store.set('openrouter', 'sk-test-value')
    expect(await store.get('openrouter')).toBe('sk-test-value')
  })

  it('multiple keys coexist without cross-contamination', async () => {
    const store = new FileCredentialStore({ path: join(dir, 'creds.json') })
    await store.set('a', 'value-a')
    await store.set('b', 'value-b')
    expect(await store.get('a')).toBe('value-a')
    expect(await store.get('b')).toBe('value-b')
  })

  it('delete removes a key; deleting an absent key is a no-op, not an error', async () => {
    const store = new FileCredentialStore({ path: join(dir, 'creds.json') })
    await store.set('k', 'v')
    await store.delete('k')
    expect(await store.get('k')).toBeUndefined()
    await expect(store.delete('never-existed')).resolves.toBeUndefined()
  })

  it('a fresh instance pointed at the same path reads what an earlier one wrote (survives restart)', async () => {
    const path = join(dir, 'creds.json')
    await new FileCredentialStore({ path }).set('k', 'persisted-value')
    const reopened = new FileCredentialStore({ path })
    expect(await reopened.get('k')).toBe('persisted-value')
  })

  it('creates a 32-byte key file at the default sibling path, mode 0o600 where the platform honors it', async () => {
    const path = join(dir, 'creds.json')
    await new FileCredentialStore({ path }).set('k', 'v')
    const keyBytes = readFileSync(`${path}.key`)
    expect(keyBytes.length).toBe(32)
  })

  it('tightens permissions on an existing key file before using it', async () => {
    if (process.platform === 'win32') return
    const path = join(dir, 'creds.json')
    const keyPath = `${path}.key`
    const store = new FileCredentialStore({ path })
    await store.set('k', 'v')
    chmodSync(keyPath, 0o644)
    expect(await store.get('k')).toBe('v')
    expect(statSync(keyPath).mode & 0o777).toBe(0o600)
  })

  it.skipIf(process.platform === 'win32')('refuses an existing encryption key symlink', async () => {
    const path = join(dir, 'creds.json')
    const target = join(dir, 'other-key')
    writeFileSync(target, Buffer.alloc(32, 7))
    symlinkSync(target, `${path}.key`)
    const store = new FileCredentialStore({ path })
    await expect(store.get('k')).rejects.toThrow(/regular file, not a symlink/)
  })

  it('values are not stored as plaintext in the data file', async () => {
    const path = join(dir, 'creds.json')
    const secret = 'sk-super-secret-value-should-not-appear-raw'
    await new FileCredentialStore({ path }).set('k', secret)
    const raw = readFileSync(path, 'utf8')
    expect(raw).not.toContain(secret)
  })

  it('concurrent writers preserve every credential and a fresh instance can decrypt them', async () => {
    const path = join(dir, 'concurrent.json')
    const stores = Array.from({ length: 4 }, () => new FileCredentialStore({ path }))
    await Promise.all(Array.from({ length: 24 }, (_, i) => stores[i % stores.length]!.set(`key-${i}`, `value-${i}`)))
    const reopened = new FileCredentialStore({ path })
    for (let i = 0; i < 24; i++) expect(await reopened.get(`key-${i}`)).toBe(`value-${i}`)
  })

  it('rejects using the same path for encrypted data and the encryption key', () => {
    const path = join(dir, 'same-path.json')
    expect(() => new FileCredentialStore({ path, keyPath: path })).toThrow(/distinct/)
  })

  it('supports the literal __proto__ key without mutating the data object prototype', async () => {
    const store = new FileCredentialStore({ path: join(dir, 'proto.json') })
    await store.set('__proto__', 'safe-value')
    expect(await store.get('__proto__')).toBe('safe-value')
  })

  it('a tampered ciphertext fails to decrypt (GCM auth tag catches it) rather than returning garbage silently', async () => {
    const path = join(dir, 'creds.json')
    await new FileCredentialStore({ path }).set('k', 'original-value')
    const data = JSON.parse(readFileSync(path, 'utf8'))
    const [iv, tag, ct] = data.k.split(':')
    // Flip the ciphertext to something else, same lengths, re-encode.
    const ctBuf = Buffer.from(ct, 'base64')
    ctBuf[0] = ctBuf[0]! ^ 0xff
    data.k = [iv, tag, ctBuf.toString('base64')].join(':')
    writeFileSync(path, JSON.stringify(data))
    const store = new FileCredentialStore({ path })
    await expect(store.get('k')).rejects.toThrow()
  })

  it('two stores with different key files cannot decrypt each other\'s values', async () => {
    const pathA = join(dir, 'a.json')
    const pathB = join(dir, 'b.json')
    await new FileCredentialStore({ path: pathA }).set('k', 'secret-a')
    await new FileCredentialStore({ path: pathB }).set('k', 'secret-b')
    // Swap the data files but keep each store's own key file - ciphertext now under the wrong key.
    const dataA = readFileSync(pathA, 'utf8')
    const dataB = readFileSync(pathB, 'utf8')
    writeFileSync(pathA, dataB)
    writeFileSync(pathB, dataA)
    await expect(new FileCredentialStore({ path: pathA }).get('k')).rejects.toThrow()
    await expect(new FileCredentialStore({ path: pathB }).get('k')).rejects.toThrow()
  })
})

// Fakes for testing AutoCredentialStore's fallback logic without touching the real OS keychain
// (which - per KeychainCredentialStore's own doc - behaves differently across environments).
class MemoryStore implements CredentialStore {
  data = new Map<string, string>()
  setCalls = 0
  getCalls = 0
  async get(key: string) {
    this.getCalls++
    return this.data.get(key)
  }
  async set(key: string, value: string) {
    this.setCalls++
    this.data.set(key, value)
  }
  async delete(key: string) {
    this.data.delete(key)
  }
}

class AlwaysThrowsStore implements CredentialStore {
  async get(): Promise<string | undefined> {
    throw new KeychainUnavailableError('simulated: backend unreachable')
  }
  async set(): Promise<void> {
    throw new KeychainUnavailableError('simulated: backend unreachable')
  }
  async delete(): Promise<void> {
    throw new KeychainUnavailableError('simulated: backend unreachable')
  }
}

/** Simulates the real-world case found by hand: set() "succeeds" but get() silently returns nothing. */
class SilentlyBrokenStore implements CredentialStore {
  async get(): Promise<string | undefined> {
    return undefined
  }
  async set(): Promise<void> {
    // accepts the write but never actually stores it
  }
  async delete(): Promise<void> {}
}

describe('AutoCredentialStore', () => {
  it('uses the primary store once its round-trip probe succeeds', async () => {
    const primary = new MemoryStore()
    const fallback = new MemoryStore()
    const auto = new AutoCredentialStore(primary, fallback)
    await auto.set('k', 'v')
    expect(await auto.get('k')).toBe('v')
    expect(primary.data.get('k')).toBe('v')
    expect(fallback.data.size).toBe(0)
  })

  it('falls back when the primary throws on the probe', async () => {
    const primary = new AlwaysThrowsStore()
    const fallback = new MemoryStore()
    const auto = new AutoCredentialStore(primary, fallback)
    await auto.set('k', 'v')
    expect(await auto.get('k')).toBe('v')
    expect(fallback.data.get('k')).toBe('v')
  })

  it('falls back when the primary silently fails the probe (accepts writes, never returns them - the real case found by hand)', async () => {
    const primary = new SilentlyBrokenStore()
    const fallback = new MemoryStore()
    const auto = new AutoCredentialStore(primary, fallback)
    await auto.set('k', 'v')
    expect(await auto.get('k')).toBe('v')
    expect(fallback.data.get('k')).toBe('v')
  })

  it('concurrent instances use distinct probe keys and both retain a working primary', async () => {
    const primary = new MemoryStore()
    const fallbackA = new MemoryStore()
    const fallbackB = new MemoryStore()
    const a = new AutoCredentialStore(primary, fallbackA)
    const b = new AutoCredentialStore(primary, fallbackB)
    await Promise.all([a.set('a', 'one'), b.set('b', 'two')])
    expect(await a.get('a')).toBe('one')
    expect(await b.get('b')).toBe('two')
    expect(fallbackA.data.size + fallbackB.data.size).toBe(0)
  })

  it('probes the primary at most once, even across many calls', async () => {
    const primary = new MemoryStore()
    const fallback = new MemoryStore()
    const auto = new AutoCredentialStore(primary, fallback)
    await auto.set('a', '1')
    await auto.get('a')
    await auto.set('b', '2')
    await auto.get('b')
    // one set+get+delete for the probe itself, plus one set per real .set() call above
    expect(primary.setCalls).toBe(1 /* probe */ + 2 /* a, b */)
  })

  it('the probe key does not leak into normal reads as application data', async () => {
    const primary = new MemoryStore()
    const fallback = new MemoryStore()
    const auto = new AutoCredentialStore(primary, fallback, '__probe__')
    await auto.set('real-key', 'real-value')
    expect(primary.data.has('__probe__')).toBe(false)
  })
})

describe('KeychainCredentialStore (real backend - environment-tolerant smoke test)', () => {
  // The real OS keychain is not available/reliable in every environment this suite runs in
  // (verified by hand: a headless container with no live secret-service session throws on
  // write). This test only bounds the failure mode - it must not crash or hang, and any
  // failure must surface as KeychainUnavailableError - not assert the backend actually works.
  it('either round-trips a probe value, or fails cleanly with KeychainUnavailableError', async () => {
    const store = new KeychainCredentialStore('harness-test-suite')
    const probeKey = `probe-${Date.now()}`
    try {
      await store.set(probeKey, 'probe-value')
      const value = await store.get(probeKey)
      expect(value).toBe('probe-value')
      await store.delete(probeKey)
    } catch (e) {
      expect(e).toBeInstanceOf(KeychainUnavailableError)
    }
  })
})
