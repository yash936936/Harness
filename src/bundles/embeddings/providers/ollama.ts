import { resolveBaseUrl } from '../../model-adapter/providers/ollama.js'
import { NO_REDIRECT, insecureTransportProblem, isRedirect, redirectMessage } from '../../egress/transport.js'
import { EmbeddingProviderError, EmbeddingsConfigError, type EgressInfo, type EmbeddingProvider, type OllamaEmbedConfig } from '../types.js'

const NAME = 'ollama'

/**
 * Ollama's `POST /api/embed`: `input` may be an array (a real batch, one HTTP call),
 * the response is `{ embeddings: number[][] }` (L2-normalised by Ollama).
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = NAME
  readonly model: string
  readonly egress: EgressInfo
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly keepAlive: string | undefined
  private readonly doFetch: typeof fetch
  private readonly allowInsecureHttp: boolean

  constructor(config: OllamaEmbedConfig) {
    if (!config?.model) throw new EmbeddingsConfigError('ollama embeddings: `model` is required in config (e.g. an installed embedding model tag)')
    this.model = config.model
    this.baseUrl = resolveBaseUrl(config.baseUrl)
    let endpoint: URL
    try {
      endpoint = new URL(this.baseUrl)
    } catch {
      throw new EmbeddingsConfigError('ollama embeddings: baseUrl is not a valid URL')
    }
    if (!endpoint.hostname) throw new EmbeddingsConfigError('ollama embeddings: baseUrl must have a host')
    if (endpoint.username || endpoint.password) throw new EmbeddingsConfigError('ollama embeddings: baseUrl must not contain embedded credentials')
    if (endpoint.search || endpoint.hash) throw new EmbeddingsConfigError('ollama embeddings: baseUrl must not contain a query or fragment')
    const host = endpoint.hostname
    this.egress = { host, remote: !/^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)$/i.test(host) }
    this.timeoutMs = config.timeoutMs ?? 120_000
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 4_294_967_295) {
      throw new EmbeddingsConfigError('ollama embeddings: timeoutMs must be an integer from 1 to 4294967295 milliseconds')
    }
    this.keepAlive = config.keepAlive
    this.doFetch = config.fetch ?? fetch
    this.allowInsecureHttp = config.allowInsecureHttp === true
  }

  async embed(texts: readonly string[], outer?: AbortSignal): Promise<ReadonlyArray<ArrayLike<number>>> {
    const timeout = AbortSignal.timeout(this.timeoutMs)
    const signal = outer ? AbortSignal.any([outer, timeout]) : timeout
    const fail = (e: any): EmbeddingProviderError => {
      if (outer?.aborted) return new EmbeddingProviderError('aborted', `${NAME}: request aborted`)
      if (timeout.aborted) return new EmbeddingProviderError('timeout', `${NAME}: no response within ${this.timeoutMs}ms (model still loading?)`)
      const code = e?.cause?.code ?? e?.message ?? 'unknown'
      return new EmbeddingProviderError('network', `${NAME}: cannot reach ${this.baseUrl} (${code}). Is Ollama running? Start it with \`ollama serve\`.`)
    }

    const insecure = insecureTransportProblem(NAME, this.baseUrl, this.egress.remote, this.allowInsecureHttp)
    if (insecure) throw new EmbeddingsConfigError(insecure)

    const body: Record<string, unknown> = { model: this.model, input: texts, truncate: true }
    if (this.keepAlive) body['keep_alive'] = this.keepAlive

    let res: Response
    let raw: string
    try {
      res = await this.doFetch(`${this.baseUrl}/api/embed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
        ...NO_REDIRECT,
      })
      if (isRedirect(res)) throw new EmbeddingProviderError('server', redirectMessage(NAME, res), res.status)
      raw = await res.text()
    } catch (e: any) {
      if (e instanceof EmbeddingProviderError) throw e
      throw fail(e)
    }

    let json: any
    try {
      json = JSON.parse(raw)
    } catch {
      json = undefined
    }

    if (!res.ok) {
      const detail = String(json?.error ?? raw.slice(0, 200))
      if (res.status === 404) {
        throw new EmbeddingProviderError('model_missing', `${NAME}: model "${this.model}" not available (${detail}). Install it with \`ollama pull ${this.model}\`.`, 404)
      }
      throw new EmbeddingProviderError('server', `${NAME}: HTTP ${res.status}: ${detail}`, res.status)
    }

    const vectors: unknown = json?.embeddings
    if (!Array.isArray(vectors) || !vectors.every((v) => Array.isArray(v) && v.every((n) => typeof n === 'number'))) {
      throw new EmbeddingProviderError('malformed', `${NAME}: response has no \`embeddings\` array of number arrays`, res.status)
    }
    return vectors as number[][]
  }
}
