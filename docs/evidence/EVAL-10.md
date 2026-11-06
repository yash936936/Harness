# Prototype human-evaluation evidence

**Status: BLOCKED-HUMAN.** No sessions or labels are fabricated here. The tracked root `labels.json` currently contains only three `good` labels; it does not meet D-109 (10+ labels and both classes) and is not accepted as evaluation evidence.

Create at least 10 distinct real model-driven sessions through npm run harness -- code; use 20 or more if that many already exist. Use varied, non-sensitive tasks, including both successful and unsuccessful outcomes. The owner is the single labeler. The model that generated a session must not label it.

1. Record the real session IDs and short task summaries without project secrets.
2. Label using the schema accepted by scripts/eval-calibrate.ts, with both good and bad classes.
3. Run `powershell -ExecutionPolicy Bypass -File scripts/commit-eval-labels.ps1 -LabelsPath <path-to-labels.json>`. The script computes SHA-256, writes a sidecar, commits both, and verifies the committed bytes.
4. Only after the script succeeds, run the scorer. Do not inspect scorer output before the label commit.
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
