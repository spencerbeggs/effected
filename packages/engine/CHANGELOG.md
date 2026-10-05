# @effected/engine

## 0.4.0

### Features

#### `@effected/engine/guard`

- A new subpath with no runtime imports exports `ProcessGuard`, a transport-neutral guard for `uncaughtException` and `unhandledRejection` in a long-running process such as a stdio server. `ProcessGuard.run` installs the listeners before the server's module graph loads, then awaits `load(guard)`. `load` calls `guard.markConnected()` once the server is serving. From then on, the `"exitBeforeConnect"` policy logs a stray error and keeps going instead of exiting. A rejected `load` reports `startup failed` and exits 1.

- `ProcessGuard.parseInjectCrash(value)` parses the `<at>:<kind>` crash-injection grammar a launcher reads from a test-only environment variable. Any value outside that grammar, or no value, returns `undefined`.

- The supporting types are `ProcessGuardHost`, `ProcessGuardPolicy`, `ProcessGuardInjection`, `ProcessGuardControl` and `ProcessGuardOptions`. [#944][#944]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#944]: https://github.com/spencerbeggs/effected/pull/944

## 0.3.0

### Breaking Changes

- The kit now builds on and peers stable `effect` `^4.0.0`, in place of an exact release-candidate pin. Move `effect` and every `@effect/*` package to the same `4.x` version in one install: Effect releases them together at one version. A package from this release cannot share an install with an `effect` release candidate. The peer is a caret range, so later `4.x` releases of Effect satisfy the kit without a kit release.
- Kit exports are unchanged. A consumer moving to stable `effect` meets these changes in its own code:
  - `Array`, `Chunk`, `Effect` and `Record` `partition`, their `separate` helpers and `Option.partitionMap` return `[successes, failures]`. Where both sides share a type, the reversed destructuring still compiles, so search for every call.
  - `Schema.brand` takes one identifier and is type-only: the identifier is not stored on the AST and does not survive `SchemaRepresentation`. Compose distinct brands by applying `brand` more than once.
  - `TestSchema`'s round-trip assertion is `verifyRoundTrip`, with Effect forms `succeedEffect`, `failEffect` and `verifyRoundTripEffect`.
  - Effect marks some APIs `@stability unstable`: those may change in a minor Effect release. Untagged APIs follow semver.

### Documentation

- Every exported construct's TSDoc was reviewed against the current API. Summaries open with what the construct does, error channels and requirements are stated, examples use real imports and compile, and links resolve. Comments that described options, errors or defaults the code does not have were corrected. [#910][#910]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#910]: https://github.com/spencerbeggs/effected/pull/910

## 0.2.0

### Breaking Changes

- The kit now builds on and peers `effect` `4.0.0-rc.118`, pinned exactly. Consumers must move `effect` and every `@effect/*` package to `4.0.0-rc.118` in the same install. Effect removed the `effect/unstable/*` export paths in this release, so an `@effected` package built on rc.118 cannot share an install with `effect` rc.117.

- Moving the pin also closes a fresh-install failure on rc.117. `@effect/platform-node@4.0.0-rc.117` depends on `@effect/platform-node-shared` with a caret, so an install without a lockfile paired the rc.118 shared package with `effect` rc.117 and failed at startup with `ERR_MODULE_NOT_FOUND`.

- Consumers moving to this release: effect removed the `effect/unstable/*` export paths (imports become `effect/<module>`), moved `Arbitrary` to `effect`, split `effect/Encoding` into `effect/encoding/Base64`, `Base64Url` and `Hex`, and renamed the `Schema` range and string checks (`isLengthBetween` → `isBetweenLength`, `isStartsWith` → `isStartingWith`, and so on). Kit exports are otherwise unchanged; the kit's own imports moved onto the new paths. [#864][#864]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#864]: https://github.com/spencerbeggs/effected/pull/864

## 0.1.0

### Features

- First release. `@effected/engine` is platform-free primitives shared by every front end (CLI, MCP, LSP, ...) of an Effect v4 tool — `effect` is its only dependency, and there is no `process` or `node:` read anywhere in it.

#### Carrier distribution identity

- `Distribution` — a `Schema.Struct` (`{ name, version }`) identifying the carrier package a tool's bins were installed through.
- `DistributionField` — `Schema.NullOr(Distribution)`, the shape of a `distribution` field in a machine-readable envelope: `null` for a direct install.
- `CurrentDistribution` — a `Context.Reference<Option.Option<Distribution>>`, so it is readable anywhere without appearing in `R` and defaults to `Option.none()` for a direct install. A front end's `main` provides it once, at the top of the program.
- `distributionSuffix(distribution)` — renders the `  via <name> <version> ` suffix a `--version` line or startup log appends, or `""` for a direct install.

#### Remediation

- `Remediation` — a `Schema.Struct` (`{ hint, suggestedTool?, suggestedArgs? }`) describing what a caller, usually an agent, should do after a failure.

#### Launch context

- `LaunchContext.projectDir(input)` — resolves where a tool launched by an agent host should treat as its project: the first usable positional argument, then the first usable environment variable in a given key order, then the working directory. A value counting as "usable" is non-empty after trimming and carries no unsubstituted `${VAR}` placeholder — the bug this replaces, since Claude Code passes `${CLAUDE_PROJECT_DIR}` through unsubstituted on some launch paths.
- `LaunchContext.isUnsubstituted(value)` — the placeholder check on its own.
- `ProjectDirInput` — the input shape (`argv?`, `env`, `keys`, `cwd`); nothing reads `process` directly, so the resolution rule stays shared and testable. [#821][#821]

```ts
import { CurrentDistribution, distributionSuffix, LaunchContext } from "@effected/engine";
import { Effect, Option } from "effect";

const projectDir = LaunchContext.projectDir({
	argv: positionals,
	env: process.env,
	keys: ["MY_TOOL_PROJECT_DIR", "CLAUDE_PROJECT_DIR"],
	cwd: process.cwd(),
});

const program = Effect.gen(function* () {
	const distribution = yield* CurrentDistribution;
	yield* Effect.log(`my-tool v1.0.0${distributionSuffix(distribution)}`);
});
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#821]: https://github.com/spencerbeggs/effected/pull/821
