---
"@effected/cli": minor
---

## Breaking Changes

On the `0.x` line breaking changes ship as `minor`; the changes below need action on upgrade.

### `CliLogger`'s default `stderrFrom` is now `"All"`

Every log level now goes to stderr by default, closing #716. Previously `stderrFrom` defaulted to `"Error"`, so `Info`/`Warning` went to stdout as program output — fine for a tool whose output *is* its log lines, but wrong the moment stdout is a machine-readable document, since a `--format=json` command would interleave its warnings into the JSON stream.

Write program output with `Console.log`, never `Effect.log`. Pass the old default explicitly if your CLI relies on it:

```ts
import { CliLogger } from "@effected/cli";

CliLogger.layer({ stderrFrom: "Error" }); // restores the pre-0.x split
```

### `reportFailures` no longer double-renders a `UserError`, and `ShowHelp` exit codes changed

`Command.runWith` already renders a `CliError.UserError` itself, through its `CliOutput` formatter, before re-failing with it — `CliRuntime.reportFailures` and `CliRuntime.main` now detect that (the mark `runWith` flips) and skip printing it a second time, exiting with the usage code (`64` by default) instead of the generic fallback.

A bare `ShowHelp` — `--help`, or a root invocation with no parse errors — still exits `0` silently. A `ShowHelp` carrying parse errors now exits `usageExitCode` (default `64`, BSD `EX_USAGE`) instead of the previous fallback of `1`.

## Features

### `CliRuntime.main` and `MainOptions`

Assembles a whole program in the one order that reports every failure well: a fresh `CliExit` cell, then your platform layer (inside failure reporting, so a layer-build failure renders as one line instead of escaping to a stack trace), then failure reporting, then the logger outermost.

```ts
import { CliRuntime } from "@effected/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command } from "effect/unstable/cli";

NodeRuntime.runMain(CliRuntime.main(Command.run(root, { version }), { platform: NodeServices.layer }));
```

### `CliExit` and findings exit codes

A findings command — a linter that found problems, say — can now exit non-zero on a *successful* run, with finalizers intact on any runtime:

```ts
import { CliExit } from "@effected/cli";

yield* CliExit.set(2); // highest code set during the run wins; must be an integer 0..255
```

`CliExit` is a `Context.Service`, not a reference, so forgetting to provide it is a type error. A program run under `CliRuntime.main` must not provide `CliExit.layer` itself — `main` already provides a fresh one.

### `CliColor`

The no-color.org colour decision, shared by every renderer:

```ts
import { CliColor } from "@effected/cli";

CliColor.enabled; // Effect<boolean, never, Stdio> — off when stdout isn't a terminal, or NO_COLOR is a non-empty value
CliColor.formatterLayer(); // wires effect/unstable/cli's CliOutput.Formatter to the same decision
```

### `ReportFailuresOptions.usageExitCode`

A new option controlling the exit code for a usage error (a `ShowHelp` carrying parse errors, or an already-rendered `UserError`), separate from the general failure fallback. Defaults to `64`.

### `@effected/cli/testing`

A new subpath, never reachable from the main entrypoint, for spawning a **built** CLI bin hermetically in tests:

```ts
import { CliTest } from "@effected/cli/testing";

const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
const result = yield* CliTest.run("dist/bin.js", ["--help"], { sandbox, execPath: process.execPath });
// { exitCode, stdout, stderr } — a non-zero exit is data, never a failure
```
