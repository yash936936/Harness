import type { Binding, ModelRecord } from './types.js'

/**
 * The one real pin recorded so far (D-042). Every value below was copied
 * from output the owner pasted from their own machine on 2026-09-28 after
 * `ollama pull qwen2.5-coder:3b-instruct` - nothing here is recalled or
 * inferred:
 * - `sha256`: the weights blob's hash, from the `FROM ...\blobs\sha256-<hash>`
 *   line of `ollama show --modelfile`; Ollama itself printed "verifying sha256
 *   digest" for the same `4a188102020e` prefix during the pull. This is the
 *   value `ModelStore.verifyFile` can re-check against the blob on disk.
 * - `sourceDigest`: what `/api/tags` reports as `digest` (also the `ID` column
 *   of `ollama list`). It is a different value from the blob hash - a manifest
 *   digest - so it is kept separate rather than passed off as the file hash.
 * - `license`: the text `ollama show --license` printed. It is NOT
 *   Apache-2.0: it is the Qwen RESEARCH LICENSE AGREEMENT (2024-09-19),
 *   whose grant (section 2a) is "FOR NON-COMMERCIAL PURPOSES ONLY".
 */
export const REFERENCE_WORKER_PIN: ModelRecord = {
  id: 'qwen2.5-coder:3b-instruct',
  source: 'ollama-library',
  revision: 'ollama tag qwen2.5-coder:3b-instruct, pulled 2026-09-28 (manifest f72c60cabf62)',
  sha256: '4a188102020e9c9530b687fd6400f775c45e90a0d7baafe65bd0a36963fbb7ba',
  sourceDigest: 'f72c60cabf6237b07f6e632b2c48d533cef25eda2efbd34bed21c5e9c01e6225',
  license: 'Qwen RESEARCH LICENSE AGREEMENT (2024-09-19) - non-commercial use only; commercial use requires a separate license from Alibaba Cloud',
  notes: 'GGUF, Q4_K_M, 3.1B parameters, ~1.9 GB (D-030). The Ollama tag is mutable: a later pull of the same tag may hash differently.',
}

export const REFERENCE_WORKER_BINDING: Binding = {
  name: 'worker',
  pinnedModelId: REFERENCE_WORKER_PIN.id,
  fallbackIds: [],
}

/**
 * Needle pin (D-049, closes the 1B.3 Needle criterion). Every value came from the
 * owner's own machine on 2026-09-29, not from recall:
 * - `revision`: the Hugging Face commit of `Cactus-Compute/needle2` that was downloaded
 *   (from the local `.cache/huggingface/download` metadata).
 * - `sha256`: `npm run pin` hashed `needle2/needle2.cact` on that machine.
 * - `license`: Apache-2.0; the downloaded `needle2/LICENSE` begins with the Apache
 *   License 2.0 text (owner pasted the first lines).
 * Only the weights file is pinned. The download also ships native binaries and Python
 * wheels, which are NOT covered; pin them separately if the harness ever runs or links them.
 * The `checkpoints/needle2.pkl` pickle must never be loaded.
 */
export const NEEDLE_PIN: ModelRecord = {
  id: 'needle2',
  source: 'cactus-compute',
  revision: '32e9e3a93b205f786929697446ae669cf0a84579',
  sha256: 'b43aabfcaf1a6db6acf488076eab71d823c08697c7af4521fc1d174b60ede5ba',
  license: 'Apache-2.0',
  notes: 'needle2.cact weights file, 45M generation (D-049). No binding yet: the router is Phase 4.5. Never load checkpoints/needle2.pkl.',
}

/** The router's model binding (4.5): pinned to Needle, no fallback model (the fallback chain is rules then worker, not another model). */
export const ROUTER_BINDING: Binding = {
  name: 'router',
  pinnedModelId: NEEDLE_PIN.id,
  fallbackIds: [],
}
