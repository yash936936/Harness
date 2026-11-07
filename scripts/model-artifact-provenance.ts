export interface ModelArtifactProvenance {
  model: string
  revision: string
  sha256: string
  source: string
}

/** Only a full Git commit hash is immutable enough to identify a model revision. */
export function validateModelArtifactProvenance(value: unknown): ModelArtifactProvenance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('provenance must be a JSON object')
  }
  const p = value as Record<string, unknown>
  if (typeof p.model !== 'string' || !p.model.trim() ||
      typeof p.source !== 'string' || !p.source.trim() ||
      typeof p.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(p.sha256)) {
    throw new Error('provenance must contain model, source, and a 64-character SHA-256')
  }
  if (typeof p.revision !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(p.revision)) {
    throw new Error('provenance revision must be a full immutable 40- or 64-character Git commit hash')
  }
  return { model: p.model, revision: p.revision, source: p.source, sha256: p.sha256 }
}
