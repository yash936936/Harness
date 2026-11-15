/**
 * Disabled by D-117.
 *
 * The former smoke harness ran model-generated project files by dynamically
 * importing them in the host Node process and auto-approved write operations.
 * A temporary directory is not an execution boundary. The deterministic
 * stand-in used the same host execution path, so it is disabled as well.
 *
 * Re-enable only after task-scoped remote workspace transfer, result
 * synchronization, provider lifecycle auditing, and policy integration are
 * implemented and accepted under D-118.
 */
console.error(
  'smoke-coding is disabled: D-117 prohibits host execution of generated code. ' +
  'Task-scoped remote workspace acceptance is not implemented.',
)
process.exitCode = 2
