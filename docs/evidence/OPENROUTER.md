# OpenRouter live-run evidence

**Status: BLOCKED-KEY.** No live request was made in this change. Scripted provider tests do not prove a real request succeeded.

Set the key and free-tier model only in environment variables. Never paste the key into a terminal transcript, issue, session log, or file.

PowerShell:
```powershell
$env:OPENROUTER_API_KEY = "<set locally; do not paste>"
$env:OPENROUTER_MODEL = "<exact free-tier model id>"
npm run harness -- code --provider openrouter --model "$env:OPENROUTER_MODEL" "Inspect this project and report its architecture. Do not edit files."
```

Git Bash:
```bash
export OPENROUTER_API_KEY='<set locally; do not paste>'
export OPENROUTER_MODEL='<exact free-tier model id>'
npm run harness -- code --provider openrouter --model "$OPENROUTER_MODEL" "Inspect this project and report its architecture. Do not edit files."
```

Then run a full coding task that produces a policy approval. Save redacted stdout and session path. Verify via seeded-secret scan that the literal key is absent from stdout, JSONL logs and committed files without printing the key.

## Evidence
- Selected model ID:
- Request date/time:
- First response status:
- Full task session ID:
- Approval event seq(s):
- Session log path:
- Key exclusion check (command/output, redacted):
- Redacted stdout:
