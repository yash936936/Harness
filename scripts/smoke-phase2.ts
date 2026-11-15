/**
 * Disabled by D-117.
 *
 * The former phase-2 smoke check invoked ripgrep through the host Subprocess
 * service and read the host checkout directly. Retrieval acceptance must use
 * an explicitly selected remote cloud workspace; that workspace transfer and
 * synchronization path is not implemented under D-118 yet.
 */
console.error(
  'smoke-phase2 is disabled: it used host-backed retrieval and subprocess execution. ' +
  'Remote task-scoped workspace acceptance is not implemented.',
)
process.exitCode = 2
