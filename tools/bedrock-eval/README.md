# Bedrock evaluation tools

Claude Opus 4.6 is the active application provider on this feature branch. Skin analysis,
score reading and market recommendations share `server/services/bedrock/client.js`, using
native Bedrock Runtime in `us-east-1`, the US profile `us.anthropic.claude-opus-4-6-v1`,
Standard pricing, schema-aware token counting and no automatic retries.

The Opus evaluator is `opus46.cjs`. Its `--mode count` and `--mode analysis` use the shared
production skin request builder. Pass `--catalogue-file` with a reviewed `{ "products": [...] }`
snapshot to test seeded Mongo `_id` values; it does not connect to MongoDB. Without that
option it explicitly uses the checked-in seed. Application requests read active home-use
products from the existing database, rather than from the seed file. A count report must
match the exact prompt/schema before paid evaluation; unknown cost or a failed request
stops the wave. Retests require their own authorized scope.

The compact wire omits redundant catalogue names, numeric step order and localized
category labels. The server restores those values and validates the full canonical
contract before returning it. The UI API shape is unchanged. The verified matched pilot
on 2026-10-13 passed no-photo and shelf-photo EN/HE with the seeded catalogue; it is not a
production deployment or a clinical/image-accuracy evaluation.

## Historical Grok runner

The `run.cjs` instructions and pricing below describe the retained Grok comparison tool.
They do not select the application's provider. Grok is historical evaluation evidence;
Opus remains the required target when an Opus test fails.

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

The case file should contain only minimized, de-identified answers and images that are actually attached to that analysis. The runner accepts up to ten JPEG/PNG images (five unique skin angles and five shelf images), validates signatures, and enforces the API's 8 MiB per-image and 24 MiB total limits. Exported `shelf-01` style labels are normalized to `shelf` for analysis. The runner loads image bytes locally and passes `{ angle, mediaType, base64 }` to `contract.cjs`. By default it uses the checked-in `server/data/catalogue-seed/products.json`; pass `--catalogue` only to use a separate JSON array or `{ "products": [...] }` / `{ "catalogue": [...] }` snapshot. Seed rows use their stable `seedKey` as the evaluation ID when `_id` is absent. Do not substitute production database IDs.

## Run

Use Node 20 or newer. From this directory:

```powershell
npm ci
npm test
node run.cjs `
  --input-dir "C:\path\outside\git\bedrock-check\input" `
  --output "C:\path\outside\git\bedrock-check\reports\pilot.json" `
  --server-dir "C:\path\to\getprrety\server" `
  --max-cases 1 --languages en --max-run-cost 3 --max-analysis-cost 0.25 --max-attempts 1
```

`AWS_BEARER_TOKEN_BEDROCK` from the process environment takes precedence. Otherwise, `--server-dir` loads its existing `.env` with that folder's installed `dotenv` module. The secret is kept in memory and is never printed or written to the report. The endpoint and model are fixed in code to Oregon's Bedrock Mantle endpoint and `xai.grok-4.6`.

The tool runs cases and languages sequentially. Each attempt has a 90-second timeout and an 8,000-token output cap. `--max-attempts` accepts `1` or `2` and defaults to `1`; invalid JSON, schema, or semantic output stays invalid, and no correction prompt is sent. Two attempts are available only when explicitly requested for a comparison. API, network, refusal, and timeout failures are never automatically retried. The report records the selected attempt limit. Full model output is written only to the explicit `--output` path, which must be outside this worktree. Standard output emits progress after each attempt and a final summary; it contains only case IDs, language, status, latency, finish reason, and token-based cost metrics.

## Cost and limits

Pricing constants are the Bedrock Standard in-Region rates checked on 2026-10-08: $2.20 per million uncached input tokens, $0.55 per million cached input tokens, and $6.60 per million output tokens. The tool counts reasoning tokens as output when Bedrock includes them in `completion_tokens`. It uses reported cached-token counts when present; reported usage is required for cost accounting. If usage is absent or a request times out, cost is `null` (unknown), not zero, and the run stops before another logical analysis.

The per-analysis $0.25 ceiling is checked against reported usage after each attempt; the CLI rejects values above this ceiling. The run-cost cap is also checked after a provider response and prevents starting another case once the observed total reaches it. These are post-response guards: provider input/image tokens are not known to the runner before the first call, and a single call can therefore exceed a cap before the runner can observe its billable usage. An explicitly requested comparison retry can also push a logical analysis above its cap; the report flags that outcome and the run stops. The 8,000-token output cap bounds the output portion of one attempt at $0.0528 at these rates, but it does not bound input/image cost.

Pricing and model capabilities: [AWS Grok 4.6 model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-6.html). The runner requests JSON Schema output; the model card lists structured outputs for `bedrock-mantle`.

## Interpreting results

`valid: true` means the response parsed as JSON, passed the required-field schema, and passed the contract's current semantic checks. Those checks validate known Era/catalogue IDs, ingredient safety exclusions using the available catalogue data, category/order coverage for required routine steps (including SPF), and a language heuristic. They do not establish image identification accuracy or clinical quality. Treat validity as contract conformance, not evidence that the advice is clinically correct or production-ready.

The live pilot returned structurally valid JSON with a non-empty SR routine that omitted SPF; the app's home routine prefers SR steps when they exist. The production gate therefore remains failed pending a prompt/contract fix and a passing rerun, even if the response is marked valid.

The earlier 45- and 60-second waves remain failures for their configured runs. A separate historical pilot diagnostic used 90 seconds. The user selected a 90-second timeout on 2026-10-12; new runs do not overwrite or reinterpret the earlier observations.

## Streaming timing investigation

`investigate.cjs` uses the deployable Bedrock client and shared contract. Pass `--input-dir`, `--output`, and `--server-dir` as above, plus `--mode diagnostics` or `--mode acceptance`. The input directory must contain exactly these case folders: `case-568f7d2ab3`, `case-80fd909fc6`, `case-842e0d34ad`, `case-b84442ecb2`, `case-c2798b8a6b`, and `case-f3df5c5c7d`; missing or extra case folders are rejected. Input/output must remain outside this worktree; an existing report cannot be overwritten. The report is atomically checkpointed before each request with that request marked in-flight and unknown-cost, then after each result, preserving the last valid JSON checkpoint if a write is interrupted. It contains timings, schema/prompt hashes, counters and reported costs, without private input, generated text or credentials.

Diagnostics makes one non-streaming control, one streaming comparison and one compact-prose streaming comparison on the first authorized English case. Each configuration has its own label and 90-second deadline; there are no retries. The compact instruction affects this diagnostic only. One comparison per configuration is exploratory and cannot establish a causal speed improvement.

Acceptance makes one streaming request for each of six cases in English and Hebrew, using the unchanged production prompt. Its provider budget is derived from the server deadline constants: `ANALYSIS_SERVER_TIMEOUT_MS` (85 seconds) minus `RESPONSE_RESERVE_MS` (one second), currently 84 seconds. This direct test bypasses application upload, Mongo-backed budgets and deployment proxies, so it does not prove deployed end-to-end completion. Every response must pass the current schema/semantic checks and reported-cost ceiling; unknown or excessive costs stop further paid requests. No partial streamed model output is accepted or saved.

## Test scope

`npm test` uses injected mock fetch responses and temporary local files only. It does not load credentials, call Bedrock, connect to the application, or access a database.
