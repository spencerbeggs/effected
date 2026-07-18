---
"@effected/jsonc": minor
---

## Features

Added `Jsonc.parseResult(text, options?)` — a pure, synchronous
`Result`-returning parse variant for callers that are not already inside an
`Effect`. It runs the same error-recovery engine as `Jsonc.parse`: every
parse error is collected and the failure side carries one aggregate
`JsoncParseError`.

```ts
import { Jsonc } from "@effected/jsonc";
import { Result } from "effect";

const ok = Jsonc.parseResult('{ "port": 3000 // dev\n }');
if (Result.isSuccess(ok)) {
	console.log(ok.success); // => { port: 3000 }
}

const bad = Jsonc.parseResult("{ bad }");
if (Result.isFailure(bad)) {
	console.log(bad.failure._tag); // => "JsoncParseError"
}
```

`Jsonc.parse` is now defined in terms of `Jsonc.parseResult` — behavior is
unchanged, and the `Effect` variant still carries the `Jsonc.parse` tracing
span. Reach for `parseResult` at synchronous boundaries (a plain config
loader, a build script) instead of wrapping
`Effect.runSync(Effect.result(Jsonc.parse(text)))`.
