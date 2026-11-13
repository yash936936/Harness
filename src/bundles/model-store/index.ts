import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Context, Service } from 'cordis'
import { ModelStoreError, type Binding, type InstalledCheck, type ModelAvailability, type ModelRecord, type ModelSource } from './types.js'

export * from './types.js'
export * from './pins.js'

const ALLOWLISTED_SOURCES: ReadonlySet<ModelSource> = new Set<ModelSource>(['ollama-library', 'ornith-ai', 'cactus-compute'])

export interface ModelStoreConfig {
  /** Seed records to register at boot, e.g. from a project's saved config. Same validation as calling `register()` for each - a bad one throws at boot, not silently. */
  models?: ModelRecord[]
  /** Seed bindings to set at boot. */
  bindings?: Binding[]
}

declare module 'cordis' {
  interface Context {
    modelStore: ModelStore
  }
}

/**
 * Registry + verification for D-027/D-026: which models this install
 * trusts, where each came from, and what a binding falls back to if its
 * pinned ID goes missing.
 *
 * In-memory only for now - no `register()` call here is backed by a real
 * checked download in this environment (this container has no network
 * access to Ollama's registry or Hugging Face, so there is nothing real to
 * hash yet). Persistence to disk (mirroring `credentials.ts`/`budgets.ts`'s
 * own pattern) is a follow-up once a real caller populates this with real
 * pins - building it now, against no real data, would be persistence with
 * nothing worth persisting.
 *
 * Deliberately ships with **no pre-registered models**. D-030 names
 * `qwen2.5-coder:3b-instruct` as the reference worker and D-026 names
 * Needle's origin, but neither decision recorded a checked SHA-256 for a
 * specific pulled revision - inventing one to seed this store would be
 * exactly the fabricated-claim failure mode `consent-copy.ts` (D-020,
 * D-037) already exists to avoid, just for a hash instead of a privacy
 * claim. Real pins get registered once someone runs `ollama pull` (or
 * equivalent) for real and computes the real digest.
 */
export class ModelStore extends Service {
  private records = new Map<string, ModelRecord>()
  private bindings = new Map<string, Binding>()

  constructor(ctx: Context, config: ModelStoreConfig = {}) {
    super(ctx, 'modelStore')
    for (const record of config.models ?? []) this.register(record)
    for (const binding of config.bindings ?? []) this.setBinding(binding)
  }

  /** Refuses a source outside the allowlist (D-027) and refuses to silently overwrite an existing id - re-pinning under the same id defeats the point of pinning. */
  register(record: ModelRecord): void {
    if (!record || typeof record !== 'object') throw new ModelStoreError('model record must be an object', 'invalid_record')
    if (!ALLOWLISTED_SOURCES.has(record.source)) {
      throw new ModelStoreError(
        `model "${String(record.id)}": source "${String(record.source)}" is not allowlisted (allowed: ${[...ALLOWLISTED_SOURCES].join(', ')})`,
        'unallowlisted_source',
      )
    }
    const nonEmpty = (value: unknown, max: number): value is string =>
      typeof value === 'string' && value.trim().length > 0 && value.length <= max && !value.includes('\0')
    if (!nonEmpty(record.id, 256) || !nonEmpty(record.revision, 512) || !nonEmpty(record.license, 1024) ||
        typeof record.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sha256) ||
        (record.sourceDigest !== undefined && (typeof record.sourceDigest !== 'string' || !/^[a-f0-9]{64}$/i.test(record.sourceDigest))) ||
        (record.notes !== undefined && typeof record.notes !== 'string')) {
      throw new ModelStoreError('model record requires a bounded id, revision, license and valid 64-character SHA-256 digests', 'invalid_record')
    }
    if (this.records.has(record.id)) {
      throw new ModelStoreError(`model "${record.id}" is already registered - use a different id for a different revision`, 'duplicate')
    }
    this.records.set(record.id, Object.freeze({ ...record, sha256: record.sha256.toLowerCase() }))
  }

  get(id: string): ModelRecord | undefined {
    const record = this.records.get(id)
    return record ? { ...record } : undefined
  }

  list(): ModelRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }))
  }

  /** Throws `ModelStoreError('digest_mismatch')` on any mismatch - never silently accepts a changed artifact under a pinned id. Comparison is case-insensitive. */
  verifyDigest(id: string, actualSha256: string): void {
    const record = this.records.get(id)
    if (!record) throw new ModelStoreError(`model "${id}" is not registered - nothing to verify its digest against`, 'unknown_model')
    if (typeof actualSha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(actualSha256)) throw new ModelStoreError('actual digest must be a 64-character SHA-256 hex string', 'invalid_digest')
    const actual = actualSha256.toLowerCase()
    if (actual !== record.sha256) {
      throw new ModelStoreError(`model "${id}": digest mismatch - pinned ${record.sha256}, got ${actual}`, 'digest_mismatch')
    }
  }

  /** Hashes a file on disk (streamed - model files are GBs) and checks it against the pin. Throws like `verifyDigest`. */
  async verifyFile(id: string, path: string): Promise<void> {
    this.verifyDigest(id, await sha256File(path))
  }

  /**
   * Compares `ollama-library` records against what an Ollama host reports as installed
   * (`name` + `digest` from `/api/tags`). Compares `sourceDigest` - the digest Ollama itself
   * reports - not `sha256`, which is a different value (D-042). Read-only.
   */
  checkInstalled(installed: Array<{ name: string; digest?: string }>): InstalledCheck[] {
    return this.list()
      .filter((r) => r.source === 'ollama-library')
      .map((r): InstalledCheck => {
        const found = installed.find((m) => m.name === r.id)
        if (!found) return { id: r.id, status: 'not_installed' }
        if (!r.sourceDigest || !found.digest) return { id: r.id, status: 'unchecked', installedDigest: found.digest }
        return { id: r.id, status: found.digest.toLowerCase() === r.sourceDigest.toLowerCase() ? 'matches_pin' : 'differs_from_pin', installedDigest: found.digest }
      })
  }

  setBinding(binding: Binding): void {
    if (!binding || typeof binding !== 'object' ||
        typeof binding.name !== 'string' || !binding.name.trim() || binding.name.length > 128 ||
        typeof binding.pinnedModelId !== 'string' || !binding.pinnedModelId.trim() || binding.pinnedModelId.length > 256 ||
        !Array.isArray(binding.fallbackIds) ||
        binding.fallbackIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > 256) ||
        new Set(binding.fallbackIds).size !== binding.fallbackIds.length ||
        binding.fallbackIds.includes(binding.pinnedModelId)) {
      throw new ModelStoreError('binding requires a name, pinned model id, and unique fallback ids distinct from the pin', 'invalid_binding')
    }
    this.bindings.set(binding.name, Object.freeze({ ...binding, fallbackIds: Object.freeze([...binding.fallbackIds]) as unknown as string[] }))
  }

  getBinding(name: string): Binding | undefined {
    const binding = this.bindings.get(name)
    return binding ? { ...binding, fallbackIds: [...binding.fallbackIds] } : undefined
  }

  listBindings(): Binding[] {
    return [...this.bindings.values()].map((binding) => ({ ...binding, fallbackIds: [...binding.fallbackIds] }))
  }

  /** One binding's availability: the pin if registered, else the first *registered* fallback in order, else unavailable. Read-only - never registers or mutates anything. */
  resolve(bindingName: string): ModelAvailability {
    const binding = this.bindings.get(bindingName)
    if (!binding) return { bindingName, usedPin: false, unavailable: true }
    if (this.records.has(binding.pinnedModelId)) {
      return { bindingName, resolvedId: binding.pinnedModelId, usedPin: true, unavailable: false }
    }
    for (const fallbackId of binding.fallbackIds) {
      if (this.records.has(fallbackId)) return { bindingName, resolvedId: fallbackId, usedPin: false, unavailable: false }
    }
    return { bindingName, usedPin: false, unavailable: true }
  }

  /** Every registered binding's availability, for `doctor` (1B.3's testing criterion: "unavailable-pinned-model test in `doctor`"). */
  resolveAll(): ModelAvailability[] {
    return [...this.bindings.keys()].map((name) => this.resolve(name))
  }
}

/** Hex-encoded SHA-256, for computing the digest side of a `verifyDigest` call against real bytes. */
export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Streamed hex SHA-256 of a file - safe for multi-GB model blobs. */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export const name = 'bundle-model-store'
export function apply(ctx: Context, config: ModelStoreConfig = {}) {
  ctx.plugin(ModelStore, config)
}
