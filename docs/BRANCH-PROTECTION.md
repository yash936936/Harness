# Branch protection (merge gate)

The repo has merged red twice (PR #39 failed on both platforms after merge; run #369 failed on main after PR #29). A workflow file cannot prevent that; only a branch-protection rule can. This must be set by the repository owner. It is **not applied** by anything in this repo.

## Required settings for `main`

- Require a pull request before merging.
- Require status checks to pass: **`ci-pass`** (the single aggregate job in `.github/workflows/ci.yml`). Mark "Require branches to be up to date before merging".
- Do not allow bypassing for administrators (or accept that bypasses are logged as failure events).
- Block force pushes and deletions.

## Apply with the GitHub CLI (owner, authenticated `gh`)

Apply these settings through the repository's GitHub settings UI or the GitHub CLI. Confirm the exact payload for your GitHub CLI version before applying; this repository does not apply branch protection automatically.

Verify: `gh api repos/yash936936/Harness/branches/main/protection/required_status_checks`. Log the result with `node scripts/events/log-event.mjs --kind review --area CI --outcome success --summary "branch protection applied"`.

## What CI does not prove

Real sandbox, live providers, human-labelled evaluation and desktop measurements are not run in CI; the `not-run` job says so in every run summary.

---
**Next:** Return to [`context.md`](../context.md).


## Observed repository state — 2026-11-13

The GitHub branch endpoint currently reports `main.protected=false` and `protection.enabled=false`. The `ci-pass` workflow passed in post-merge run #570, but that does **not** mean the status check is required before merges. The owner must apply the settings above in GitHub repository settings or with an authenticated GitHub CLI session, then re-query the protection endpoint and log the verified result. This chat's GitHub integration can read the setting but does not expose a branch-protection write action.
