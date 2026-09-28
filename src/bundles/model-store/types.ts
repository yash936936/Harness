/**
 * Where a pinned model is allowed to have come from (D-027, D-026). Kept as
 * a closed, small set on purpose - adding a source here is a real decision
 * (log it in `docs/decisions.md`), not something a config file should be
 * able to do on its own. `ollama-library` is the standard `ollama pull`
 * path (D-030's reference worker, `qwen2.5-coder:3b-instruct`); `ornith-ai`
 * is D-027's explicitly-named official source for Ornith; `cactus-compute`
 * is Needle's origin per `docs/architecture.md`'s dependency table.
 */
export type ModelSource = 'ollama-library' | 'ornith-ai' | 'cactus-compute'

export interface ModelRecord {
  /** Locally-unique - what callers and `Binding.pinnedModelId`/`fallbackIds` refer to it by (e.g. "qwen2.5-coder:3b-instruct", "needle-2"). */
  id: string
  source: ModelSource
  /** Tag, commit, or version string from that source - precise enough to re-fetch the exact same bytes. */
  revision: string
  /** Lowercase hex, no "sha256:" prefix - `register()` lowercases it regardless of how it's passed in. */
  sha256: string
  license: string
  /**
   * The digest the *source's own API* reports for this model, when that differs from `sha256`
   * (Ollama's `/api/tags` `digest` is a manifest digest, not the hash of the weights file - the
   * two were observed to differ on a real pull, D-042). Informational; `verifyDigest` only ever
   * checks `sha256`.
   */
  sourceDigest?: string
  /** Free-text - e.g. why this revision/size was picked over another. Never used for verification, display only. */
  notes?: string
}

export type ModelStoreErrorKind = 'unallowlisted_source' | 'digest_mismatch' | 'unknown_model' | 'duplicate'

export class ModelStoreError extends Error {
  override name = 'ModelStoreError'
  constructor(
    message: string,
    public readonly kind: ModelStoreErrorKind,
  ) {
    super(message)
  }
}

/** One provider binding's pinned model plus its ordered fallback chain (D-027). */
export interface Binding {
  name: string
  pinnedModelId: string
  /** Tried in order if the pin isn't registered. First one that *is* registered wins - see `ModelStore.resolve`. */
  fallbackIds: string[]
}

export interface ModelAvailability {
  bindingName: string
  /** The model ID actually selected: the pin if registered, else the first registered fallback. Absent when nothing in the chain is available, or the binding itself doesn't exist. */
  resolvedId?: string
  /** True only when the pin itself resolved - no fallback was needed. */
  usedPin: boolean
  /** True when neither the pin nor any fallback is registered (or the binding was never set at all). */
  unavailable: boolean
}

/** One pinned record compared against what the source's own host reports as installed (1B.3, D-043). */
export interface InstalledCheck {
  id: string
  /** `not_installed`: the host doesn't list it. `matches_pin`: listed, digest equals the record's `sourceDigest`. `differs_from_pin`: listed under the same name with a different digest (the tag moved, or the file changed). `unchecked`: the record has no `sourceDigest`, or the host reported no digest, so nothing can be compared. */
  status: 'not_installed' | 'matches_pin' | 'differs_from_pin' | 'unchecked'
  installedDigest?: string
}
