---
"@effected/engine": minor
---

## Features

First release. `@effected/engine` is platform-free primitives shared by every front end (CLI, MCP, LSP, ...) of an Effect v4 tool — `effect` is its only dependency, and there is no `process` or `node:` read anywhere in it.

### Carrier distribution identity

- `Distribution` — a `Schema.Struct` (`{ name, version }`) identifying the carrier package a tool's bins were installed through.
- `DistributionField` — `Schema.NullOr(Distribution)`, the shape of a `distribution` field in a machine-readable envelope: `null` for a direct install.
- `CurrentDistribution` — a `Context.Reference<Option.Option<Distribution>>`, so it is readable anywhere without appearing in `R` and defaults to `Option.none()` for a direct install. A front end's `main` provides it once, at the top of the program.
- `distributionSuffix(distribution)` — renders the ` via <name> <version>` suffix a `--version` line or startup log appends, or `""` for a direct install.

### Remediation

- `Remediation` — a `Schema.Struct` (`{ hint, suggestedTool?, suggestedArgs? }`) describing what a caller, usually an agent, should do after a failure.

### Launch context

- `LaunchContext.projectDir(input)` — resolves where a tool launched by an agent host should treat as its project: the first usable positional argument, then the first usable environment variable in a given key order, then the working directory. A value counting as "usable" is non-empty after trimming and carries no unsubstituted `${VAR}` placeholder — the bug this replaces, since Claude Code passes `${CLAUDE_PROJECT_DIR}` through unsubstituted on some launch paths.
- `LaunchContext.isUnsubstituted(value)` — the placeholder check on its own.
- `ProjectDirInput` — the input shape (`argv?`, `env`, `keys`, `cwd`); nothing reads `process` directly, so the resolution rule stays shared and testable.

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
