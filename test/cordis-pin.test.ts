/** ENG-07: Cordis is a release candidate (4.0.0-rc.x) and its behaviour has already surprised us (no optional inject, plugins with missing deps never start). Upgrades must be deliberate. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (p: string) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'))

describe('cordis pin', () => {
  it('is an exact version in package.json (no ^ or ~), so npm cannot move it on its own', () => {
    const want = read('../package.json').dependencies.cordis as string
    expect(want).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/)
  })
  it('matches what is installed; to upgrade, change package.json, run the whole suite on Linux AND Windows, and log a decision', () => {
    expect(read('../node_modules/cordis/package.json').version).toBe(read('../package.json').dependencies.cordis)
  })
})
