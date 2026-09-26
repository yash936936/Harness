import { LLMError, type LLMProvider, type ProviderRequest } from '../model-adapter/types.js'

/** Best-effort - a host with no listing endpoint, or one that errors, is not a connection failure. */
export interface ModelListingResult {
  ok: boolean
  names?: string[]
  error?: string
}

export interface ProviderConnectionResult {
  ok: boolean
  /** Wall-clock time of the probe completion call, in ms. Present whenever the call was attempted, success or failure. */
  latencyMs?: number
  /** The model the provider's own response named (may differ from the pinned config on a misconfigured host). */
  model?: string
  /** Present only when the provider implements `listModels`. */
  models?: ModelListingResult
  /** Present only when `ok` is false. Reuses `model-adapter`'s `LLMErrorKind` so callers get one error vocabulary. */
  error?: { kind: string; message: string }
}

export interface TestConnectionOptions {
  /**
   * Required `true` for a provider whose `egress.remote` is true; ignored for
   * a local (loopback) provider. This is the user's one-off "go ahead and
   * ping this provider to check my key/host" action at setup time - it is
   * deliberately a *different*, narrower gate than the persisted per-project
   * consent (`ctx.egress`, D-029) that `LLMService.complete` enforces for
   * every call once the provider is actually in use. A connection test has
   * to be able to run *before* that persisted consent exists (the wizard
   * screen order is connection, then consent - `docs/phases.md` 1B.4), so it
   * cannot depend on it; it still refuses by default rather than silently
   * sending a probe the moment a remote config is typed in.
   */
  acknowledgeRemote?: boolean
  /** Default 20s - short on purpose: this is a "does it answer at all" check, not a real task. */
  timeoutMs?: number
  signal?: AbortSignal
}

const PROBE_REQUEST: ProviderRequest = {
  messages: [{ role: 'user', content: 'Reply with exactly one word: ok' }],
  maxTokens: 8,
}

/**
 * Connection test (1B.2): list models (best-effort), then one tiny
 * completion call, timed. Never throws - a failed test is data the wizard
 * needs to show the user, not an exception to catch. Takes a constructed
 * `LLMProvider` directly rather than a name registered on `ctx.llm`: at
 * setup time the provider usually isn't registered yet (the point of the
 * test is to decide whether it's worth registering).
 */
export async function testProviderConnection(
  provider: LLMProvider,
  opts: TestConnectionOptions = {},
): Promise<ProviderConnectionResult> {
  if (provider.egress?.remote && !opts.acknowledgeRemote) {
    return {
      ok: false,
      error: {
        kind: 'consent',
        message: `refused to contact ${provider.egress.host} for a connection test without acknowledging the remote call (pass acknowledgeRemote: true once the user confirms) - this is a one-off setup check, separate from the project's ongoing egress consent.`,
      },
    }
  }

  // One shared deadline for the whole test, not per-call: a hung `/models` endpoint must not
  // be able to keep the probe call from ever running, and vice versa.
  const timeout = opts.timeoutMs !== undefined ? AbortSignal.timeout(opts.timeoutMs) : AbortSignal.timeout(20_000)
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout

  const models = provider.listModels ? await safeListModels(provider, signal) : undefined
  if (signal.aborted) {
    return { ok: false, models, error: { kind: 'timeout', message: `no response within ${opts.timeoutMs ?? 20_000}ms (timed out while listing models)` } }
  }

  const start = Date.now()
  try {
    const res = await provider.complete(PROBE_REQUEST, signal)
    return { ok: true, latencyMs: Date.now() - start, model: res.model, models }
  } catch (e) {
    const latencyMs = Date.now() - start
    if (e instanceof LLMError) return { ok: false, latencyMs, models, error: { kind: e.kind, message: e.message } }
    if (timeout.aborted && !opts.signal?.aborted) {
      return { ok: false, latencyMs, models, error: { kind: 'timeout', message: `no response within ${opts.timeoutMs ?? 20_000}ms` } }
    }
    const message = e instanceof Error ? e.message : String(e)
    return { ok: false, latencyMs, models, error: { kind: 'unknown', message } }
  }
}

async function safeListModels(provider: LLMProvider, signal?: AbortSignal): Promise<ModelListingResult> {
  try {
    const names = await provider.listModels!(signal)
    return { ok: true, names }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
