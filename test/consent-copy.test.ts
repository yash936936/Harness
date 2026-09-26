import { describe, expect, it } from 'vitest'
import { buildConsentScreenData, lookupProviderPolicy } from '../src/bundles/app-core/consent-copy.js'

describe('lookupProviderPolicy', () => {
  it('returns a dated claim for a provider we have a checked source for', () => {
    const ollama = lookupProviderPolicy('ollama')
    expect(ollama).toBeDefined()
    expect(ollama!.summary.length).toBeGreaterThan(0)
    expect(ollama!.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const openrouter = lookupProviderPolicy('openrouter')
    expect(openrouter).toBeDefined()
    expect(openrouter!.sourceUrl).toMatch(/^https:\/\//)
    expect(openrouter!.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns undefined, never a fabricated claim, for a provider with no checked source', () => {
    expect(lookupProviderPolicy('some-random-provider-nobody-checked')).toBeUndefined()
  })
})

describe('buildConsentScreenData', () => {
  it('always includes the D-020 general statement covering telemetry, local, and cloud cases', () => {
    const data = buildConsentScreenData('ollama')
    expect(data.generalStatement).toContain('no telemetry')
    expect(data.generalStatement).toContain('local provider keeps')
    expect(data.generalStatement).toContain('cloud provider sends')
  })

  it('a local binding (no egress, or remote: false) says nothing is sent anywhere, and still attaches a known claim if one exists', () => {
    const noEgress = buildConsentScreenData('ollama')
    expect(noEgress.binding.local).toBe(true)
    expect(noEgress.binding.destination).toContain('nothing is sent anywhere')
    expect(noEgress.binding.policyClaim).toBeDefined()

    const explicitLocal = buildConsentScreenData('ollama', { host: '127.0.0.1', remote: false })
    expect(explicitLocal.binding.local).toBe(true)
  })

  it('a remote binding with a known provider names the real destination host and attaches the claim', () => {
    const data = buildConsentScreenData('openrouter', { host: 'openrouter.ai', remote: true })
    expect(data.binding.local).toBe(false)
    expect(data.binding.destination).toContain('openrouter.ai')
    expect(data.binding.policyClaim?.provider).toBe('openrouter')
  })

  it('a remote binding with an unknown provider says so plainly instead of omitting the gap silently', () => {
    const data = buildConsentScreenData('some-custom-provider', { host: 'custom.example.com', remote: true })
    expect(data.binding.local).toBe(false)
    expect(data.binding.destination).toContain('custom.example.com')
    expect(data.binding.destination).toContain('No checked data policy is on file')
    expect(data.binding.policyClaim).toBeUndefined()
  })

  it('destination always names the specific provider passed in, not a generic placeholder', () => {
    const data = buildConsentScreenData('my-provider-name', { host: 'x.example.com', remote: true })
    expect(data.binding.provider).toBe('my-provider-name')
    expect(data.binding.destination).toContain('my-provider-name')
  })
})
