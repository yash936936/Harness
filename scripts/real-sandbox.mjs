#!/usr/bin/env node
// D-110: S0 / Docker / WSL / Crabbox is permanently held. Do not probe or retry it.
console.error('BLOCKED by D-110: real Crabbox sandbox acceptance is permanently on hold. No host probes or workarounds are permitted.')
process.exitCode = 1
