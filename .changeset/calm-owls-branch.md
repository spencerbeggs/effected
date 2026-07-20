---
"@effected/jsonc": minor
---

## Features

### `parseTreeResult`: the sync `Result` twin of `parseTree`

`Jsonc.parseTree` ran a synchronous parser behind an `Effect`, so the wrapper carried nothing but a tracing span and the error channel. A synchronous caller wanting the AST — a config editor in a lint hook, a non-Effect build script — had to build a runtime and write `Effect.runSync(Effect.result(Jsonc.parseTree(text)))` to get at it. It now has a sync twin returning `Result` directly:

```ts
import { Jsonc } from "@effected/jsonc";
import { Option, Result } from "effect";

const tree = Jsonc.parseTreeResult('{ "port": 3000 // dev\n }');
if (Result.isSuccess(tree) && Option.isSome(tree.success)) {
	console.log(tree.success.value.type); // => "object"
}
```

The return type is `Result<Option<JsoncNode>, JsoncParseError>` — `Option.none()` for empty input under `allowEmptyContent`, the aggregate `JsoncParseError` for malformed input, exactly as `parseTree` behaves.

This completes the package's own symmetry under the kit's sync-primitive convention: `parseResult` and `stringifyResult` have had this shape since they were introduced, and `parseTree` was the one remaining parse entry point reachable only through `Effect`. The `parseTree` signature, error channel and named span are unchanged; it is now defined in terms of `parseTreeResult` via `Effect.fromResult`, so the `Result` variant is the single engine path and the two forms cannot drift.
