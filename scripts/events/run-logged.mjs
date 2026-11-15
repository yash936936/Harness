#!/usr/bin/env node
// Disabled by D-117: this former wrapper spawned arbitrary commands on the host.
console.error(
  'run-logged is disabled: D-117 permits development commands only inside an explicitly selected remote cloud sandbox. ' +
  'No host subprocess or local fallback is allowed.',
)
process.exitCode = 2
