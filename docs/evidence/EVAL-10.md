# Prototype human-evaluation evidence

**Status: BLOCKED-HUMAN.** No sessions or labels are fabricated here. The tracked root `labels.json` currently contains only three `good` labels; it does not meet D-109 (10+ labels and both classes) and is not accepted as evaluation evidence.

Create at least 10 distinct real model-driven sessions through npm run harness -- code; use 20 or more if that many already exist. Use varied, non-sensitive tasks, including both successful and unsuccessful outcomes. The owner is the single labeler. The model that generated a session must not label it.

1. Record the real session IDs and short task summaries without project secrets.
2. Label using the schema accepted by scripts/eval-calibrate.ts, with both good and bad classes.
3. Compute SHA-256 over the exact labels file.
4. Commit the labels file and hash before running the scorer or viewing any scorer output.
5. Only after that commit, run npm run eval -- <logDir> labels.json; preserve complete output and scorer version.
6. Report raw agreement, class counts, and the human-label-versus-scorer confusion table as **prototype-grade, not calibrated**. There is no minimum agreement percentage.

## Evidence
- Session IDs:
- Labels path:
- SHA-256:
- Commit containing labels and hash:
- Scorer version and output:
- Raw agreement (prototype-grade, not calibrated):
- Confusion table:
- Disagreements and owner notes:
