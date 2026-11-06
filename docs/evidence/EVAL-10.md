# Prototype human-evaluation evidence

**Status: BLOCKED-HUMAN.** No sessions or labels are fabricated here.

Create at least 20 distinct real model-driven sessions through `npm run harness -- code`. Use varied, non-sensitive tasks, including at least one failure/block. The owner is the single labeler. Do not inspect scorer output before labels are committed and hashed.

1. Record at least 20 matched session IDs and task summaries without project secrets.
2. Label using the schema accepted by `scripts/eval-calibrate.ts`; include both `good` and `bad` classes.
3. Compute SHA-256 over the exact labels file.
4. Commit labels and hash before running any scorer.
5. Run `npm run eval -- <logDir> labels.json`; preserve complete output/scorer version. The evaluator requires at least 20 matched sessions, both label classes, and at least 90% agreement. Report raw agreement as **prototype-grade, not calibrated**.

## Evidence
- Session IDs:
- Labels path:
- SHA-256:
- Commit containing labels and hash:
- Scorer version and output:
- Raw agreement (prototype-grade, not calibrated):
- Disagreements and owner notes:
