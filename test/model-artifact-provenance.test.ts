import { describe, expect, it } from 'vitest'
import { validateModelArtifactProvenance } from '../scripts/model-artifact-provenance.js'

const good = {
  model: 'Qwen/Qwen2.5-Coder-7B-Instruct',
  revision: '0123456789abcdef0123456789abcdef01234567',
  source: 'https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct',
  sha256: 'a'.repeat(64),
}

describe('model artifact provenance', () => {
  it('accepts a full immutable commit hash and SHA-256', () => {
    expect(validateModelArtifactProvenance(good)).toEqual(good)
  })

  it.each(['main', 'latest', 'v1.0', '0123456789abcdef'])('rejects mutable or abbreviated revision %s', (revision) => {
    expect(() => validateModelArtifactProvenance({ ...good, revision })).toThrow(/full immutable/)
  })

  it('rejects missing model/source and malformed artifact digests', () => {
    expect(() => validateModelArtifactProvenance({ ...good, sha256: 'bad' })).toThrow(/SHA-256/)
    expect(() => validateModelArtifactProvenance({ ...good, source: '' })).toThrow(/model, source/)
    expect(() => validateModelArtifactProvenance(null)).toThrow(/JSON object/)
  })
})
