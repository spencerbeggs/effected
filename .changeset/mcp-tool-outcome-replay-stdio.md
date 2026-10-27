---
"@effected/mcp": minor
---

## Features

* `ToolOutcome` is the expected-failure envelope `{ ok: false, error: { _tag, message, remediation, … } }` with `catchAsEnvelope` and `isFailure`. `ToolOutcome.envelope(success, errors, { identifier, description })` publishes the failure member under `$defs/<identifier>`, and the envelope fields now carry default descriptions in the served JSON Schema (additive to every `outputSchema` using these helpers).
* `ToolReplay.wrap` replays idempotent tool successes over a store, and never caches an `ok: false` result. Pass `store: { get, set }` to drop `KeyValueStore` from `R`; a `KeyValueStore` value fits as-is. The key must identify the whole request, since a hit compares neither params nor schema version.
* `@effected/mcp/node` adds `StdioCapture`, which keeps an in-process library's stdout off the JSON-RPC wire, and `StdioCapture.nullWritable()` for a real null `Writable`. It needs `@types/node`.
* `@effected/mcp/guard` exports the `InjectCrash` type returned by `McpGuard.parseInjectCrash`.
