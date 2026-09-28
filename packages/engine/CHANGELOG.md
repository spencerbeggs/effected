# @effected/engine

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
