import { describe, expect, it } from 'vitest'
// @ts-ignore - plain .mjs helper with no type declarations
import { sumTreeWorkingSetMB } from '../app/desktop/bench/measure-lib.mjs'

const MB = 1024 * 1024
describe('sumTreeWorkingSetMB', () => {
  const procs = [
    { ProcessId: 1, ParentProcessId: 0, WorkingSetSize: 500 * MB }, // unrelated
    { ProcessId: 10, ParentProcessId: 1, WorkingSetSize: 40 * MB }, // app root
    { ProcessId: 11, ParentProcessId: 10, WorkingSetSize: 60 * MB }, // webview child
    { ProcessId: 12, ParentProcessId: 11, WorkingSetSize: 20 * MB }, // grandchild
    { ProcessId: 99, ParentProcessId: 2, WorkingSetSize: 300 * MB }, // unrelated
  ]
  it('sums the root and all descendants, ignoring unrelated processes', () => {
    const r = sumTreeWorkingSetMB(procs, 10)
    expect(r.mb).toBe(120)
    expect(r.processCount).toBe(3)
  })
  it('reports zero processes when the root is absent (caller must fail, not record 0)', () => {
    expect(sumTreeWorkingSetMB(procs, 12345).processCount).toBe(0)
  })
  it('survives a parent-pid cycle', () => {
    const cyc = [
      { ProcessId: 5, ParentProcessId: 6, WorkingSetSize: MB },
      { ProcessId: 6, ParentProcessId: 5, WorkingSetSize: MB },
    ]
    expect(sumTreeWorkingSetMB(cyc, 5).processCount).toBe(2)
  })
})
