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
