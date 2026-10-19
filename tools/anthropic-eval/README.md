# Anthropic evaluation tools

These evaluation tools call Anthropic directly through the shared SDK adapter in
`server/services/anthropic/client.js`. The selected model is Claude Opus 5.5. The adapter
uses `maxRetries: 0`, schema-aware token counting, a 90-second deadline, and the same
bounded cost calculation used by the application.

`opus46.cjs` retains its historical filename while providing the count and analysis modes.
Count reports record `provider: anthropic`, the model, schema-aware count method, prompt and
schema fingerprints, and the derived output budget. Analysis accepts only a matching
Anthropic count report; old Bedrock count reports are rejected. The evaluator uses the
production request builder and checks the wire schema, hydrated canonical schema, and
semantic contract. The UI API contract remains unchanged.

The legacy `run.cjs` runner also uses the shared Anthropic adapter. It sends minimized quiz
cases and attached photos, applies the existing per-analysis and run cost caps, and can retry
only a completed semantic validation failure when `--max-attempts 2` is explicitly selected.
The separate `extract.cjs` utility remains a read-only database export. Evaluators consume
local case folders and a catalogue snapshot; they do not connect to MongoDB.

## Input shape

```json
{
  "caseId": "case-001",
  "quiz": { "age": 31, "skin_goals": ["dryness"] },
  "images": [
    { "angle": "front", "mediaType": "image/jpeg", "path": "front.jpg" }
  ]
}
```

Case files contain minimized answers and images attached to that analysis. The runner accepts
up to ten JPEG/PNG images, validates image signatures, and enforces 3.75 MiB per image and
24 MiB total. Image paths must stay inside the case folder. The default product catalogue is
`server/data/catalogue-seed/products.json`; `--catalogue` selects a separate JSON snapshot.
Seed rows use their stable `seedKey` as the evaluation ID when `_id` is absent.

## Run

Use Node 20 or newer. From this directory:

```powershell
npm ci
npm test
node run.cjs `
  --input-dir "C:\path\outside\git\anthropic-check\input" `
  --output "C:\path\outside\git\anthropic-check\reports\pilot.json" `
  --server-dir "C:\path\to\getprrety\server" `
  --max-cases 1 --languages en --max-run-cost 3 --max-analysis-cost 0.25 --max-attempts 1
```

Set `ANTHROPIC_API_KEY` in the process environment, or pass `--server-dir` to load that
server folder's `.env`. The key stays in memory and is never printed or written to reports.
Input and output files must remain outside this evaluation worktree.

The runners execute sequentially with a 90-second deadline and an 8,000-token output cap.
Unknown usage or an unknown charge stops further requests. A successful result means the
response passed schema and semantic checks; it does not establish image identification
accuracy or clinical quality.

The shared adapter's Opus 5.5 rates are $4 per million input tokens and $20 per million
output tokens. Each Opus analysis reserves a 128-token input allowance and $0.01 for output
when deriving its maximum output budget. The legacy runner retains its $0.25 per-analysis
ceiling and configurable run-cost cap.

## Other evaluation paths

`investigate.cjs` runs the existing diagnostics or acceptance manifest through the same
Anthropic adapter. It writes checkpoints outside this worktree and stores only timing,
schema/prompt hashes, validation metrics, and usage metadata. `opus46-wave.cjs` completes all
schema-aware counts and checkpoints the boundary before starting inference.

`npm test` runs mocked provider tests and temporary local-file tests only. It does not load
credentials, make network calls, or write to a database.
