---
"@effected/toml": minor
---

## Features

### `Toml.parseResult` and `Toml.stringifyResult`: the synchronous `Result` primitives

TOML parsing and stringification are pure synchronous computation, so the `Effect` wrapper on `Toml.parse` and `Toml.stringify` carried nothing but a tracing span and the error channel. Synchronous callers — a lint-staged handler, a non-Effect config loader — had to build a runtime and write `Effect.runSync(Effect.result(...))` to reach an engine that never suspends.

Both entry points now have a sync twin returning `Result` directly:

```ts
import { Toml } from "@effected/toml";
import { Result } from "effect";

const parsed = Toml.parseResult('name = "Alice"');
if (Result.isSuccess(parsed)) {
	console.log(parsed.success); // => { name: "Alice" }
}

const text = Toml.stringifyResult({ name: "Alice" });
```

`parseResult` returns `Result<unknown, TomlParseError>` and `stringifyResult` returns `Result<string, TomlStringifyError>`, with the same `TomlStringifyOptions` parameter — the same values, the same typed errors and the same diagnostics the `Effect` forms already produced.

This follows the kit's sync-primitive convention, matching `Jsonc.parseResult` / `Jsonc.stringifyResult` and `Markdown.parseResult` / `Markdown.stringifyResult`. `Toml.parse` and `Toml.stringify` are unchanged in signature, error channel and span, and are now defined as `Effect.fromResult(Toml.parseResult(...))` and `Effect.fromResult(Toml.stringifyResult(...))` behind those same spans, so the two forms cannot drift: the `Result` variant is the single engine path, and the `Effect` variant adds only the span. The `TomlFromString` codec's encode direction routes through `stringifyResult` for the same reason.

The defect firewall is unchanged and now pinned on both paths. The engine's raw carriers (`RawTomlError`, `GuardExceeded`) still materialize into `TomlParseError` / `TomlStringifyError` — including a `NestingDepthExceeded` diagnostic for a depth bomb — while any other throw is a genuine defect and still escapes: as a `Die` through the `Effect` forms, and as a real synchronous throw to a `Result` caller, which is the correct shape for a defect at a synchronous boundary.

Parity is asserted directly rather than assumed. Every representative document, error case and depth bomb is checked in both directions, so a future edit that re-derives the engine on one side fails in this package's own suite rather than in a consumer.
