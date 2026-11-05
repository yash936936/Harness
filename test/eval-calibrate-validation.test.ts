import { describe, expect, it } from 'vitest'
import { meetsCalibrationMinimum, validateHumanRunLabels } from '../scripts/eval-calibrate-validation.js'

describe('real-run calibration input validation', () => {
  it('counts only labels attached to available session IDs', () => {
    const result = validateHumanRunLabels(
      { realGood: 'good', realBad: 'bad' },
      ['realGood', 'realBad', 'unlabelled'],
    )
    expect(result.unknownIds).toEqual([])
    expect(result.classCounts).toEqual({ good: 1, bad: 1 })
  })

  it('reports stale labels without counting them toward calibration', () => {
    const result = validateHumanRunLabels(
      { realGood: 'good', staleBad: 'bad' },
      ['realGood'],
    )
    expect(result.unknownIds).toEqual(['staleBad'])
    expect(result.classCounts).toEqual({ good: 1, bad: 0 })
  })

  it('rejects malformed maps, blank IDs, and invalid labels', () => {
    expect(() => validateHumanRunLabels([], ['s1'])).toThrow(/must be an object/)
    expect(() => validateHumanRunLabels({ s1: 'maybe' }, ['s1'])).toThrow(/must be "good" or "bad"/)
    expect(() => validateHumanRunLabels({ ' ': 'good' }, [' '])).toThrow(/session ID/)
  })

  it('requires 20 labels, both classes, and at least 90% agreement', () => {
    expect(meetsCalibrationMinimum(19, { good: 10, bad: 9 }, 1)).toBe(false)
    expect(meetsCalibrationMinimum(20, { good: 20, bad: 0 }, 1)).toBe(false)
    expect(meetsCalibrationMinimum(20, { good: 10, bad: 10 }, 0.89)).toBe(false)
    expect(meetsCalibrationMinimum(20, { good: 10, bad: 10 }, 0.9)).toBe(true)
  })
})
