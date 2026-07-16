---
"@effected/tsconfig-json": minor
---

## Features

### `TsconfigLoaderSync` — a synchronous facade

For sync-only host APIs (bundler plugin hooks, config factories) that cannot run an Effect, `TsconfigLoaderSync` runs the same `TsconfigLoader` pipeline synchronously against consumer-supplied file and path operations:

```ts
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { TsconfigLoaderSync } from "@effected/tsconfig-json";

const resolved = TsconfigLoaderSync.resolve("./tsconfig.json", {
	fileSystem: { exists: existsSync, readFile: (p) => readFileSync(p, "utf8") },
	path,
});
```

`TsconfigLoaderSync.load`, `.resolve` and `.compilerOptions` mirror the async pipeline's typed failures (`TsconfigParseError`, `TsconfigExtendsError`, or a `PlatformError` wrapping a thrown read) — thrown as themselves rather than a fiber-failure wrapper. No `node:*` import and no posix assumption: pass a win32-appropriate `path` for Windows correctness.

### `JsxConfig` — JSX transform projection

`JsxConfig.fromCompilerOptions` projects decoded compiler options to the JSX transform a bundler can configure: the automatic runtime (`react-jsx` / `react-jsxdev`, with `importSource` defaulting to `"react"` per tsc) or the classic runtime (`react`). `"preserve"`, `"react-native"` and an absent `jsx` project to `Option.none()` — there is nothing for a bundler to configure.

```ts
import { JsxConfig } from "@effected/tsconfig-json";

const jsx = JsxConfig.fromCompilerOptions(compilerOptions);
// Option.some(JsxConfig({ runtime: "automatic", importSource: "react" }))
```

### `TsconfigLoader.compilerOptions`

A thin projection of `TsconfigLoader.resolve` down to the merged `compilerOptions`, for the common "just give me the effective options" query:

```ts
import { TsconfigLoader } from "@effected/tsconfig-json";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const options = yield* TsconfigLoader.compilerOptions("./tsconfig.json");
	return options;
});
```
