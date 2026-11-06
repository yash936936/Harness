import { describe, expect, it } from 'vitest'
import { meetsCalibrationMinimum, validateHumanRunLabels } from '../scripts/eval-calibrate-validation.js'

describe('real-run evaluation input validation', () => {
  it('counts only labels attached to available session IDs', () => {
    const result = validateHumanRunLabels({ realGood: 'good', realBad: 'bad' }, ['realGood', 'realBad', 'unlabelled'])
    expect(result.unknownIds).toEqual([])
    expect(result.classCounts).toEqual({ good: 1, bad: 1 })
  })
  it('reports stale labels without counting them toward evaluation', () => {
    const result = validateHumanRunLabels({ realGood: 'good', staleBad: 'bad' }, ['realGood'])
    expect(result.unknownIds).toEqual(['staleBad'])
    expect(result.classCounts).toEqual({ good: 1, bad: 0 })
  })
  it('rejects malformed maps, blank IDs, and invalid labels', () => {
    expect(() => validateHumanRunLabels([], ['s1'])).toThrow(/must be an object/)
    expect(() => validateHumanRunLabels({ s1: 'maybe' }, ['s1'])).toThrow(/must be "good" or "bad"/)
    expect(() => validateHumanRunLabels({ ' ': 'good' }, [' '])).toThrow(/session ID/)
  })
  it('requires 10 matched labels and both classes, without an agreement cutoff', () => {
    expect(meetsCalibrationMinimum(9, { good: 5, bad: 4 })).toBe(false)
    expect(meetsCalibrationMinimum(10, { good: 10, bad: 0 })).toBe(false)
    expect(meetsCalibrationMinimum(10, { good: 5, bad: 5 })).toBe(true)
    expect(meetsCalibrationMinimum(20, { good: 10, bad: 10 })).toBe(true)
  })
})
