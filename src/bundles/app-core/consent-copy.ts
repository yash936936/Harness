export interface ProviderDataPolicyClaim {
  provider: string
  /** Paraphrased in our own words, one or two sentences - a claim we relay, never verify (D-020). */
  summary: string
  sourceUrl?: string
  /** ISO date this summary was last checked against the source. Show this next to the claim, always. */
  checkedOn: string
}

/**
 * A small, curated registry - one entry per provider we actually checked a
 * real source for. A provider not listed here gets no fabricated claim
 * (see `lookupProviderPolicy`): D-020 is explicit that a provider's
 * "sends no data"/retention statement is *that provider's* claim, not
 * something this harness can verify, and inventing one on a provider's
 * behalf would be worse than having none.
 */
const KNOWN_PROVIDER_POLICIES: Record<string, ProviderDataPolicyClaim> = {
  ollama: {
    provider: 'ollama',
    summary:
      'Ollama is the local model runtime itself, not a hosted service - when it is running on this machine (the default), nothing about a prompt leaves the machine through Ollama. If Ollama is instead pointed at a remote host, that host is a third party and its own policy applies, not this one.',
    checkedOn: '2026-09-24',
  },
  openrouter: {
    provider: 'openrouter',
    summary:
      'OpenRouter states it does not store prompt or response content by default and does not use it to train models, unless prompt logging is explicitly opted into (for a small usage discount). Every request still crosses two boundaries: OpenRouter itself, and whichever underlying model provider it routes the request to - that provider has its own, separate data and training policy, which can vary by model and even by specific endpoint. OpenRouter offers an account-level "Zero Data Retention" setting that restricts routing to providers with no retention at all.',
    sourceUrl: 'https://openrouter.ai/docs/guides/privacy/provider-logging',
    checkedOn: '2026-09-24',
  },
}

/** `undefined` for a provider we have no checked source for - never a guess. */
export function lookupProviderPolicy(providerName: string): ProviderDataPolicyClaim | undefined {
  return KNOWN_PROVIDER_POLICIES[providerName]
}

export interface ConsentScreenBindingSection {
  provider: string
  /** What leaves the machine for this specific binding, in plain language (D-020). */
  destination: string
  /** true if this binding does not send prompts off the machine at all. */
  local: boolean
  /** Absent when there is no checked source for this provider - never a fabricated claim. */
  policyClaim?: ProviderDataPolicyClaim
}

export interface ConsentScreenData {
  /** D-020's general rule, true regardless of what's configured - always shown. */
  generalStatement: string
  binding: ConsentScreenBindingSection
}

const GENERAL_STATEMENT =
  "This harness collects no telemetry of its own. What leaves this machine depends entirely on which provider is connected: a local provider keeps every prompt and response on this machine; a cloud provider sends what the model sees to that provider, under that provider's own policy - a policy this harness relays as a dated claim below, but cannot verify or enforce."

/**
 * Builds the consent-screen data for one configured binding. `egress` is
 * the same `{ host, remote }` shape a `model-adapter` provider already
 * declares (D-022) - pass `undefined` (or `remote: false`) for a local
 * binding.
 */
export function buildConsentScreenData(providerName: string, egress?: { host: string; remote: boolean }): ConsentScreenData {
  const claim = lookupProviderPolicy(providerName)
  const isLocal = !egress || !egress.remote

  const destination = isLocal
    ? `${providerName}: runs on this machine - nothing is sent anywhere by it.`
    : claim
      ? `${providerName}: every prompt and the model's response is sent to ${egress!.host}, under that provider's own policy (see the claim below - not verified by this harness).`
      : `${providerName}: every prompt and the model's response is sent to ${egress!.host}. No checked data policy is on file for this provider - review its own privacy/data-retention policy before sending anything sensitive.`

  return {
    generalStatement: GENERAL_STATEMENT,
    binding: { provider: providerName, destination, local: isLocal, policyClaim: claim },
  }
}
