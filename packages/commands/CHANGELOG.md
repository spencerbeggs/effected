# @effected/commands

## 0.6.0

### Breaking Changes

#### `@effected/schemastore` no longer ships `AnnotationCarriers`

- `AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

- Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

- If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

#### `StoreDocument` and `SchemaPipeline` error channels are wider

- `StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

### Features

#### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

- `StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

- Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

- Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

#### The whole kit tracks Effect `4.0.0-rc.112`

- Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

### Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

### Documentation

#### The Claude Code and Copilot plugins are Effect v4 only

- The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

- The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

- Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest. [#623][#623]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.5.0

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.4.0

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required. [#322][#322]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.3.1

### Bug Fixes

- `Run.jsonLine` now scans stdout lines from the end and takes the first line that both parses as JSON and decodes under the schema, instead of requiring the last non-empty line to decode. A child that writes after its payload — for example a pnpmfile hook logging from `process.on("exit", ...)` — no longer displaces the payload and fails the parse.
  - Noise is tolerated on both sides of the payload; any run whose last non-empty line decodes behaves exactly as before
  - When multiple lines decode, the last one wins — shape consumer schemas as a discriminated envelope (a required `ok` literal) so accidental log lines cannot satisfy them
  - When nothing decodes, the typed `CommandOutputError` keeps its near-miss diagnostics: kind `schema` with the last JSON-parseable line's decode failure as `cause` when at least one line parsed, kind `notJson` only when no line anywhere was JSON — exit code and both redacted streams still carried as context [#293][#293]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#293]: https://github.com/spencerbeggs/effected/pull/293

## 0.3.0

### Features

- Added `Run.jsonLine(command, schema, options?)`, a framing variant of `Run.json` for a child process that reports through a single JSON protocol payload on its final stdout line.

  Unlike `Run.json`, which parses the whole of stdout and requires a zero exit, `Run.jsonLine` takes the last non-empty stdout line — tolerant of noise before it, such as a subprocess-loaded hook's own logging — and parses it regardless of exit code, since a protocol payload typically discriminates success in-band.
  ```ts
  import { Run } from "@effected/commands";
  import { Schema } from "effect";

  const Payload = Schema.Struct({ ok: Schema.Boolean });

  const result = yield* Run.jsonLine(ChildProcess.make("node", ["script.js"]), Payload);
  ```
  `CommandOutputError` also gains optional `exitCode`, `stderr` and `stdout` context fields (`stderr`/`stdout` redacted), populated when `Run.jsonLine` fails so the exit code and captured streams are available as diagnostic evidence when no usable payload arrives.

  Both additions are additive; no existing surface changed. [#288][#288]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#288]: https://github.com/spencerbeggs/effected/pull/288

## 0.2.1

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.0

### Breaking Changes

- `ExecContext` gains a required `scriptPrefix: ReadonlyArray<string>` field —
  the argv prefix that runs a `package.json` script (`["npm", "run", "--"]`,&#10;`["pnpm", "run"]`, `["yarn", "run"]`, `["bun", "run"]`). Any code constructing&#10;`ExecContext.make(...)` directly must now supply it; code going through&#10;`LocalExec.layer(launcher)` gets it automatically.
  ```ts
  // Before
  ExecContext.make({ label: "pnpm", prefix, dlxPrefix, directory });

  // After
  ExecContext.make({ label: "pnpm", prefix, dlxPrefix, scriptPrefix, directory });
  ```

### Features

- `LocalExec.scriptPrefix(launcher)` returns just the script-runner prefix for
  a launcher.
- `LauncherPrefixes` is now exported, so a consumer can hold or pass the whole&#10;`{ prefix, dlxPrefix, scriptPrefix }` record without re-deriving its shape.
- `ExecContext.applyScript(command)` runs a `package.json` script by name,
  mirroring `apply` and `applyDlx`.

npm's script prefix is `["npm", "run", "--"]`, not `["npm", "run"]` — a bare&#10;`npm run <script> --flag` silently claims `--flag` for npm itself instead of
forwarding it to the script; the other three launchers forward post-script
arguments without the extra `--`.

### Documentation

- `Run`'s class remarks now document that `Run.text` and `Run.lines` trim
  whitespace (not just a trailing newline), alongside the existing exit-code
  split between `Run.collect`/`exitCode`/`succeeds` (result-based) and&#10;`Run.text`/`Run.lines` (typed-failure-based). Output where leading whitespace
  is data — `git status --porcelain`'s status column — should be read from&#10;`Run.collect`'s untrimmed `stdout` instead. [#191][#191]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#191]: https://github.com/spencerbeggs/effected/pull/191

## 0.1.0

### Features

- First release. Structured command running and CLI tool discovery over Effect
  core's `ChildProcessSpawner` — this package owns no subprocess vocabulary and
  no spawner backend; it adds the outcome, the policy and the tool-discovery
  layer on top of core's own `ChildProcess.Command`.
  ### `Run` — typed command output
  `Run.collect` / `Run.exitCode` / `Run.succeeds` report a non-zero exit as a
  result; `Run.text` / `Run.lines` / `Run.json` treat it as a typed&#10;`CommandFailedError`. `Run.extendEnv` merges environment variables onto a
  command **without** dropping the inherited parent environment (`PATH`,&#10;`HOME`, …) — the trap a bare core `setEnv` falls into. `Run.stream` and&#10;`Run.detach` round out the surface, plus `Redaction` (secret scrubbing by
  value or by flag heuristic) and `Retry` (transient-failure vocabulary for&#10;`Effect.retry`).
  ### `ToolDiscovery` — find a tool and know which one you got
  ```ts
  import { LocalExec, Run, Tool, ToolDiscovery } from "@effected/commands";
  import { NodeServices } from "@effect/platform-node";
  import { Effect, Layer } from "effect";

  const program = Effect.gen(function* () {
    const discovery = yield* ToolDiscovery;
    const biome = yield* discovery.resolve(Tool.named("biome"));
    return yield* Run.text(biome.command("check", "."));
  });

  const AppLayer = ToolDiscovery.layer.pipe(
    Layer.provide(LocalExec.layerFor("pnpm", { directory: "/repo" })),
    Layer.provide(NodeServices.layer),
  );
  ```
  Presence is decided by whether the process ran, not by its exit code, so a
  tool whose `--version` exits 1 still counts as found. `LocalExec` is the
  narrow contract a workspace tool (`@effected/workspaces`) implements to teach&#10;`ToolDiscovery` how to run a package manager's own binaries.
  ### `ScriptedSpawner` — a public test double
  `ScriptedSpawner.make(script)` provides core's `ChildProcessSpawner` from a
  scripted response list and records every spawn (command, args, cwd, env,
  whether `unref` ran) for assertions in a consumer's own test suite. [#180][#180]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180
