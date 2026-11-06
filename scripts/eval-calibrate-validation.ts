export type HumanRunLabel = 'good' | 'bad'
export type HumanRunLabels = Record<string, HumanRunLabel>

export function validateHumanRunLabels(value: unknown, availableIds: readonly string[] = []): {
  labels: HumanRunLabels
  unknownIds: string[]
  classCounts: { good: number; bad: number }
} {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('labels.json must be an object mapping session IDs to "good" or "bad"')
  }
  const labels = value as Record<string, unknown>
  for (const [id, label] of Object.entries(labels)) {
    if (!id.trim()) throw new Error('label session ID must not be blank')
    if (label !== 'good' && label !== 'bad') {
      throw new Error(`label for ${JSON.stringify(id)} must be "good" or "bad", got ${JSON.stringify(label)}`)
    }
  }
  const available = new Set(availableIds)
  const unknownIds = Object.keys(labels).filter((id) => !available.has(id))
  const matchedLabels = Object.entries(labels).filter(([id]) => available.has(id)).map(([, label]) => label as HumanRunLabel)
  const classCounts = { good: 0, bad: 0 }
  for (const label of matchedLabels) classCounts[label]++
  return { labels: labels as HumanRunLabels, unknownIds, classCounts }
}

/** Minimum for prototype-grade evidence. Agreement is reported but is not a pass/fail gate. */
export function meetsCalibrationMinimum(labelledCount: number, classCounts: { good: number; bad: number }, minimumLabels = 10): boolean {
  return labelledCount >= minimumLabels && classCounts.good > 0 && classCounts.bad > 0
}
