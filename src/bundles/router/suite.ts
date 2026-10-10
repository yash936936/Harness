import { createHash } from 'node:crypto'
import type { Candidate, DecisionClass, RouterBackend } from './types.js'

/**
 * The frozen router suite (D-026): labelled cases per decision class. FROZEN means `SUITE_SHA256` pins the exact
 * contents; `test/router.test.ts` fails if a case is edited, so a class cannot be made to "pass" by quietly changing the
 * answers. To change it on purpose, add a new decision and update the hash in the same commit.
 * Honesty about it: the labels were written by one author (Claude), not by independent annotators, there are only
 * `CASES_PER_CLASS` per class, and the phrasings are typical, not adversarial. It can show a router is clearly worse; it
 * cannot show it is better on real traffic. `evaluateClass` therefore refuses to say "owns" below `MIN_CASES`.
 */
export interface SuiteCase { task: string; expect: string }
export interface SuiteClass { candidates: Candidate[]; cases: SuiteCase[] }

const AGENTS: Candidate[] = [
  { id: 'coder', description: 'writes and edits source code to implement a feature or fix a bug' },
  { id: 'researcher', description: 'searches and reads the codebase and docs to find information, read only' },
  { id: 'tester', description: 'writes and runs tests and diagnoses failing tests' },
  { id: 'reviewer', description: 'reviews a diff or file for bugs, style and security problems, read only' },
]
const PLAYBOOKS: Candidate[] = [
  { id: 'fix-bug', description: 'reproduce a defect, find the root cause, make the smallest fix, confirm' },
  { id: 'add-feature', description: 'implement new behaviour with a plan, code and tests' },
  { id: 'refactor', description: 'restructure code without changing behaviour, rename, extract, simplify' },
  { id: 'write-tests', description: 'add unit tests and coverage for existing code' },
  { id: 'explain-code', description: 'read code and explain how it works to a person' },
]
const TOOLS: Candidate[] = [
  { id: 'search_code', description: 'search the project for words or identifiers across files', allowed: true },
  { id: 'list_files', description: 'list the files and directories of the project layout', allowed: true },
  { id: 'read_file', description: 'read the contents of one file, optionally a line range', allowed: true },
  { id: 'git_status', description: 'show which files are modified or staged in the working tree', allowed: true },
  { id: 'run_tests', description: 'run the project test suite and report failures', allowed: true },
]

const c = (task: string, expect: string): SuiteCase => ({ task, expect })

export const SUITE: Record<DecisionClass, SuiteClass> = {
  agent: {
    candidates: AGENTS,
    cases: [
      c('Implement pagination for the users endpoint', 'coder'),
      c('Fix the null pointer in the session cleanup code', 'coder'),
      c('Find where the retry backoff is configured', 'researcher'),
      c('Look through the docs and tell me which providers are supported', 'researcher'),
      c('Add tests for the rate limiter', 'tester'),
      c('The CI run is failing on two tests, find out why', 'tester'),
      c('Review this diff for security problems', 'reviewer'),
      c('Check my change for style issues and possible bugs before I merge', 'reviewer'),
      c('Rename the config loader and update its callers', 'coder'),
      c('Which files import the egress module?', 'researcher'),
      c('Run the suite and explain the failing assertion', 'tester'),
      c('Audit the new login handler for injection risks', 'reviewer'),
      c('Write a function that parses the retry header', 'coder'),
      c('Search the repo for every use of the deprecated api', 'researcher'),
      c('Increase test coverage of the memory compaction module', 'tester'),
    ],
  },
  playbook: {
    candidates: PLAYBOOKS,
    cases: [
      c('The export button crashes when the list is empty', 'fix-bug'),
      c('Users report the date shown is off by one day', 'fix-bug'),
      c('Add support for a dark mode setting', 'add-feature'),
      c('Build a new endpoint that returns usage totals', 'add-feature'),
      c('Split this 600 line function into smaller ones without changing what it does', 'refactor'),
      c('Rename the helper and tidy up the duplicated code', 'refactor'),
      c('We have no tests for the parser, please add some', 'write-tests'),
      c('Add unit tests covering the budget checks', 'write-tests'),
      c('How does the session log replay work?', 'explain-code'),
      c('Walk me through what this module does', 'explain-code'),
      c('It throws an exception on startup when the file is missing', 'fix-bug'),
      c('Implement a new command line flag for verbose output', 'add-feature'),
      c('Simplify the nested loops and extract a helper', 'refactor'),
      c('Write tests for the edge cases of the path validator', 'write-tests'),
      c('Explain to me why the gate holds this action', 'explain-code'),
    ],
  },
  tool: {
    candidates: TOOLS,
    cases: [
      c('Find where the word timeout is used', 'search_code'),
      c('What does the project layout look like', 'list_files'),
      c('Show me the contents of src/main.ts', 'read_file'),
      c('Which files have I changed so far', 'git_status'),
      c('Check whether the tests still pass', 'run_tests'),
      c('Look for every call to parseConfig', 'search_code'),
      c('List what is inside the scripts directory', 'list_files'),
      c('Open package.json and read it', 'read_file'),
      c('Are there uncommitted modifications', 'git_status'),
      c('Run the tests and tell me what fails', 'run_tests'),
      c('Where is the retry constant defined, search for it', 'search_code'),
      c('Show the directory structure of src', 'list_files'),
      c('Read lines 40 to 80 of the router file', 'read_file'),
      c('What is staged for commit right now', 'git_status'),
      c('Run the suite to see if my change broke anything', 'run_tests'),
    ],
  },
}

export const CASES_PER_CLASS = 15
/** Below this many cases a class can never be declared owned. */
export const MIN_CASES = 15

export function suiteSha256(s: Record<DecisionClass, SuiteClass> = SUITE): string {
  return createHash('sha256').update(JSON.stringify(s)).digest('hex')
}
export const SUITE_SHA256 = '0a8888a794cd21b2803ee5d08fe0bcf29806ff374e040e073549241e192d03c9'

export interface ClassResult {
  class: DecisionClass
  backend: string
  cases: number
  correct: number
  abstained: number
  errors: number
  avgLatencyMs: number
  /** Worker requests spent across all cases. */
  requests: number
}

/** Runs one backend over one class of the frozen suite. Abstaining or erroring counts as wrong. */
export async function evaluateClass(backend: RouterBackend, cls: DecisionClass, suite = SUITE): Promise<ClassResult> {
  const { candidates, cases } = suite[cls]
  const offered = cls === 'tool' ? candidates.filter((x) => x.allowed === true) : candidates
  const ids = new Set(offered.map((x) => x.id))
  let correct = 0, abstained = 0, errors = 0, ms = 0
  for (const k of cases) {
    const t = Date.now()
    try {
      const a = await backend.decide(cls, { task: k.task, candidates: offered })
      if (a === null || a === undefined) abstained++
      else if (ids.has(a) && a === k.expect) correct++
    } catch {
      errors++
    }
    ms += Date.now() - t
  }
  return { class: cls, backend: backend.name, cases: cases.length, correct, abstained, errors, avgLatencyMs: Math.round((ms / cases.length) * 10) / 10, requests: (backend.requestCost ?? 0) * cases.length }
}

export interface Verdict {
  owns: boolean
  reason: string
}

/** D-026 / 4.5: a class is owned by the router only if it matches or beats the worker on accuracy AND is faster AND uses fewer requests. */
export function verdict(router: ClassResult, worker: ClassResult): Verdict {
  if (router.cases < MIN_CASES) return { owns: false, reason: `only ${router.cases} cases (< ${MIN_CASES})` }
  if (router.correct < worker.correct) return { owns: false, reason: `less accurate than the worker (${router.correct}/${router.cases} vs ${worker.correct}/${worker.cases})` }
  if (!(router.avgLatencyMs < worker.avgLatencyMs)) return { owns: false, reason: `not faster (${router.avgLatencyMs} ms vs ${worker.avgLatencyMs} ms)` }
  if (!(router.requests < worker.requests)) return { owns: false, reason: `does not save requests (${router.requests} vs ${worker.requests})` }
  return { owns: true, reason: `${router.correct}/${router.cases} vs worker ${worker.correct}/${worker.cases}, ${router.avgLatencyMs} ms vs ${worker.avgLatencyMs} ms, ${router.requests} vs ${worker.requests} requests` }
}
