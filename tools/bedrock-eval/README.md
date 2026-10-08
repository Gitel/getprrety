# Standalone Grok 4.6 evaluation runner

The runner sends selected, minimized quiz cases and their linked photos to Grok 4.6 on Amazon Bedrock. It is separate from the application and never connects to MongoDB. The separate `extract.cjs` utility reads raw analysis documents in read-only mode and exports minimized case files; it does not write to MongoDB. Each runner case is read from a `case-*` folder containing `case.json`; linked image paths must stay inside that folder. The selected product catalogue is read from a separate JSON snapshot.

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

The case file should contain only minimized, de-identified answers and images that are actually attached to that analysis. The runner loads image bytes locally and passes `{ angle, mediaType, base64 }` to `contract.cjs`. The catalogue JSON can be an array or `{ "products": [...] }` / `{ "catalogue": [...] }`. The contract reads catalogue IDs from `_id`; if a raw seed record has no `_id`, the evaluation-only snapshot must map its `seedKey` to `_id` as a stable evaluation ID. Do not substitute production database IDs.

## Run

Use Node 20 or newer. From this directory:

```powershell
npm ci
npm test
node run.cjs `
  --input-dir "C:\path\outside\git\bedrock-check\input" `
  --catalogue "C:\path\outside\git\bedrock-check\catalogue.json" `
  --output "C:\path\outside\git\bedrock-check\reports\pilot.json" `
  --server-dir "C:\path\to\getprrety\server" `
  --max-cases 1 --languages en --max-run-cost 3 --max-analysis-cost 0.25
```

`AWS_BEARER_TOKEN_BEDROCK` from the process environment takes precedence. Otherwise, `--server-dir` loads its existing `.env` with that folder's installed `dotenv` module. The secret is kept in memory and is never printed or written to the report. The endpoint and model are fixed in code to Oregon's Bedrock Mantle endpoint and `xai.grok-4.6`.

The tool runs cases and languages sequentially. Each attempt has a 45-second timeout and an 8,000-token output cap. A completed JSON/schema/semantic failure may get one correction attempt; API, network, refusal, and timeout failures are not automatically retried. Full model output is written only to the explicit `--output` path, which must be outside this worktree. Standard output emits progress after each attempt and a final summary; it contains only case IDs, language, status, latency, finish reason, and token-based cost metrics.

## Cost and limits

Pricing constants are the Bedrock Standard in-Region rates checked on 2026-10-08: $2.20 per million uncached input tokens, $0.55 per million cached input tokens, and $6.60 per million output tokens. The tool counts reasoning tokens as output when Bedrock includes them in `completion_tokens`. It uses reported cached-token counts when present; reported usage is required for cost accounting. If usage is absent or a request times out, cost is `null` (unknown), not zero, and the run stops before another logical analysis.

The per-analysis $0.25 ceiling is checked against reported usage after each attempt. The run-cost cap is also checked after a provider response and prevents starting another case once the observed total reaches it. These are post-response guards: provider input/image tokens are not known to the runner before the first call, and a single call can therefore exceed a cap before the runner can observe its billable usage. A retry can also push a logical analysis above its cap; the report flags that outcome and the run stops. The 8,000-token output cap bounds the output portion of one attempt at $0.0528 at these rates, but it does not bound input/image cost.

Pricing and model capabilities: [AWS Grok 4.6 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-6.html). The runner requests JSON Schema output; the model card lists structured outputs for `bedrock-mantle`.

## Interpreting results

`valid: true` means the response parsed as JSON, passed the required-field schema, and passed the contract's current semantic checks. Those checks validate known Era/catalogue IDs, a basic literal allergy lookup, and a language heuristic. They do not verify allergy aliases or ingredient classes, whether every essential generic step (such as SPF) is carried into a non-empty SR routine, image identification accuracy, or clinical quality. Treat validity as contract conformance, not evidence that the advice is clinically correct or production-ready.

The live pilot returned structurally valid JSON with a non-empty SR routine that omitted SPF; the app's home routine prefers SR steps when they exist. The production gate therefore remains failed pending a prompt/contract fix and a passing rerun, even if the response is marked valid.

The runner's normal timeout is 45 seconds. A separate pilot diagnostic used a 90-second timeout; that diagnostic is a distinct attempt and must not be reported as a passing 45-second run. Any case that failed at the 45-second limit remains a failure for that configured run.

## Test scope

`npm test` uses injected mock fetch responses and temporary local files only. It does not load credentials, call Bedrock, connect to the application, or access a database.
