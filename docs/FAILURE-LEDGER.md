# Failure ledger

> GENERATED from `docs/logs/events.jsonl` by `scripts/events/failure-report.mjs`. Do not edit by hand.
> Ordered by current occurrence count (failures since the last logged resolution), highest first. HOLD threshold: 3.

| # | Count | Total | Status | Area | Signature | First seen | Last seen | Last command |
|--:|--:|--:|---|---|---|---|---|---|
| 1 | 2 | 2 | watch | CI | `ci: test expectation stale after intentional behavior change` | 2026-11-10 | 2026-11-10 |  |
| 2 | 1 | 1 | seen | retrieval-rank | `src/bundles/retrieval-rank/index.ts(313,20): error TS2304: Cannot find name 'IndexSkip'.` | 2026-11-11 | 2026-11-11 | `npm run typecheck (GitHub Actions run #474)` |
| 3 | 0 | 2 | on-hold | S0 | `crabbox: cannot create : directory nonexistent` | 2026-11-08 | 2026-11-08 |  |
| 4 | 0 | 1 | on-hold | S0 | `crabbox doctor: host rsync missing` | 2026-11-08 | 2026-11-08 |  |
| 5 | 0 | 1 | on-hold | S0 | `local-container exited <n> during apt bootstrap` | 2026-11-08 | 2026-11-08 |  |

**HOLD** = the same failure recurred at least the threshold number of times without a resolution. Stop retrying it. See AGENTS.md, "Repeated failure rule". Log a `resolution` event once the part is changed wholesale or put on hold with a decision ID.

---
**Next:** Return to [`context.md`](../context.md).
