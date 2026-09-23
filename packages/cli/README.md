# @effected/cli

[![npm](https://img.shields.io/npm/v/@effected%2Fcli?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

The boundary layer of a command-line program built on `effect/unstable/cli`: how output reaches a human, how a failure is reported, and how a schema issue becomes a sentence someone can act on. `CliLogger` renders log records as plain lines and routes diagnostics to stderr, reading the `Console` off the fiber so it needs no platform package and the stream split is actually testable. `CliRuntime.reportFailures` catches inside your program so a failure prints through *your* logger instead of Effect's default one on stdout, then re-fails with the exit code and the no-double-report mark; `CliRuntime.main` assembles a whole program — platform layer, a fresh `CliExit`, failure reporting, and the logger — in the one order that reports every failure well. `CliExit` lets a findings command (a linter that found problems, say) succeed with a non-zero exit code, with finalizers intact on any runtime. `CliColor` decides once, per the no-color.org rule, whether output carries ANSI colour, and hands core's own `CliOutput.Formatter` the same decision. `SchemaIssueRenderer` and `ConfigIssueRenderer` turn issue trees into `unknown key at groups.g.rulesetz`. The `./testing` subpath's `CliTest` spawns a built bin hermetically for a test that wants a real subprocess.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 prerelease. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/cli

Everything here shares one property: **you only discover you needed it by shipping bad output to a person.** None of it fails a type-check, a test, or a review of the code in isolation.

Effect's default logger emits `[00:33:56.619] INFO (#2): message`. That is correct for a service being scraped and wrong for a tool someone is watching — it turns a formatted table into noise — and nothing at the call site suggests it. A platform `runMain` then reports an unhandled failure through that *same* default logger, which sits outside the layers your program was provided, so a program that carefully installs a CLI logger still prints its failures in the format that logger exists to replace, on **stdout**, the one stream errors must not use. And a decode failure arrives as a structured tree when what a user needs is a sentence naming the key they got wrong; core does ship formatters for this, but they live on `SchemaIssue` rather than `SchemaError`, are named `makeFormatter*`, and are not referenced by `SchemaError.message` — two engineers searched for two rounds and concluded they did not exist.

This package is **not a CLI framework**. `effect/unstable/cli` owns argument parsing, flags, the command tree and help, and this package must never grow a second one.

## Install

```bash
npm install @effected/cli effect
```

```bash
pnpm add @effected/cli effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

`@effected/config-file` is an **optional** peer, needed only for `ConfigIssueRenderer`. It lives in its own module and is imported as a type, so nothing at runtime reaches for it.

## Quick start

```ts
import { CliLogger, CliRuntime } from "@effected/cli";
import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";

declare const AppLive: Layer.Layer<never>;

const program = Effect.gen(function* () {
  yield* Effect.logInfo("building 3 packages"); // a diagnostic, not the product
  yield* Console.log("build.json contents");    // the program's actual output
  yield* Effect.logError("nothing to build");
});

// Merged, not provided beneath: this way it also covers lines emitted during
// layer construction, which is exactly where a startup failure prints.
const MainLive = Layer.mergeAll(AppLive, CliLogger.layer());

NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures(), Effect.provide(MainLive)));
// stdout: build.json contents
// stderr: building 3 packages
// stderr: nothing to build
// No timestamp, no level, no fiber id — and stdout carries only what Console.log wrote.
```

Rendering a bad config into something actionable:

```ts
import { CliRuntime, ConfigIssueRenderer } from "@effected/cli";
import { Effect } from "effect";

configFile.load.pipe(
  Effect.catchTag("ConfigValidationError", (error) =>
    Effect.gen(function* () {
      yield* Effect.logError(String(error));
      for (const line of ConfigIssueRenderer.render(error)) yield* Effect.logError(`  ${line}`);

      // Re-fail, or the handler SUCCEEDS and a CLI exits 0 on invalid config.
      // `reported` carries the exit code and the mark that stops the runtime
      // printing the same failure a second time.
      return yield* Effect.fail(CliRuntime.reported(error));
    }),
  ),
);
```

```text
ConfigValidationError: Config validation failed at "/home/me/.config/app/config.toml"
  unknown key at variables.keep.KEEP_ME
  Missing key at variables.keep.file
  Missing key at variables.keep.value
  Missing key at variables.keep.resolved
```

Print-then-`reported` is for a program run **without** `CliRuntime.main` or `reportFailures`. Under either, do not print the failure yourself: `reportFailures` renders every error except a `ShowHelp`, a `CliError.UserError` whose reported mark is `false` (one `Command.runWith` already printed, or one you marked with `reported`) and the `CliExit` sentinel, so it would print twice. Fail with the error and put the multi-line rendering in the `render` option instead — see "Rendering a multi-line failure" in the [advanced guide](https://effected.spencerbeg.gs/cli/advanced#rendering-a-multi-line-failure).

## Putting it together

A findings command — one whose non-zero exit reports a result rather than a
crash — wires `CliRuntime.main`, `CliExit.set` and `CliColor.formatterLayer`
around an ordinary `effect/unstable/cli` command:

```ts
import { CliColor, CliExit, CliRuntime } from "@effected/cli";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/unstable/cli";

const findProblems = (strict: boolean): ReadonlyArray<string> =>
  strict ? ["missing changeset", "unpinned dependency"] : ["missing changeset"];

const check = Command.make("check", { strict: Flag.Boolean("strict").pipe(Flag.withDefault(false)) }, (config) =>
  Effect.gen(function* () {
    const problems = findProblems(config.strict);
    for (const problem of problems) yield* Console.log(problem);

    // Findings, not a crash: the handler still SUCCEEDS. CliExit.set records
    // the code CliRuntime.main turns into a real exit once the program ends.
    if (problems.length > 0) yield* CliExit.set(1);
  }),
);

// Satisfies Command.Environment (Command.run needs it) AND feeds Stdio to
// CliColor.formatterLayer, so help text, parse errors and rendered output
// never disagree about whether colour is on.
const Platform = CliColor.formatterLayer().pipe(Layer.provideMerge(NodeServices.layer));

// CliRuntime.main provides a fresh CliExit, the platform layer inside failure
// reporting, and the logger outermost — do NOT provide CliExit.layer here
// yourself, or CliExit.set writes to a second, unread cell and `check`
// silently exits 0.
NodeRuntime.runMain(CliRuntime.main(Command.run(check, { version: "1.0.0" }), { platform: Platform }));
```

```bash
$ node check.js
missing changeset
$ echo $?
1
```

## Features

- `CliLogger.layer(options?)` — replaces the default logger with plain lines, routing every level to stderr by default. The threshold is the `stderrFrom` option (pass `"Error"` to restore the old split), compared ordinally, so a level added upstream lands on the right stream without a change here.
- `CliLogger.make(options?)` — the `Logger` itself, for composing into a logger set you already have.
- `CliRuntime.reportFailures(options?)` — reports through your logger, then re-fails with an exit code and the mark that stops the runtime reporting it a second time. Never renders a `CliError.ShowHelp` (already printed by `Command.runWith`) — a `ShowHelp` carrying errors is remapped to `usageExitCode` (default `64`).
- `CliRuntime.main(program, { platform, logger?, ... })` — assembles a whole program in the one order that reports every failure well: a fresh `CliExit`, the platform layer inside failure reporting, and the logger outermost.
- `CliRuntime.reported(error, exitCode?)` — marks an error you reported yourself, so the runtime stays quiet about it. A typed `Error` comes back as its own type (the marks are added in place) when it passes `instanceof Error` at runtime; any other value — including one that only satisfies `Error`'s shape structurally — is wrapped in a plain `Error`. A `CliError.UserError` marked with `reported` is treated as already printed and is not rendered — use a different error type if the program has not printed it. It keeps the code you pass: `reported(userError, 3)` exits `3`, not `usageExitCode`.
- `CliExit.set(code)` — records a findings exit code from a successful program; the highest code set during the run wins. `CliExit.layer` mints a fresh cell per provide (`Layer.fresh`) — `CliRuntime.main` provides it for you.
- `CliColor.enabled` — `Effect<boolean, never, Stdio>`, the no-color.org decision: off when stdout is not a terminal, or `NO_COLOR` is a non-empty value. `FORCE_COLOR` is ignored.
- `CliColor.formatterLayer(overrides?)` — core's `CliOutput.Formatter`, coloured by the same decision as `CliColor.enabled`.
- `SchemaIssueRenderer.render(issue)` — a `SchemaIssue` tree becomes one line per rejected value.
- `ConfigIssueRenderer.render(error)` — the same rendering, reading `issue` off a `ConfigValidationError`.

Two behaviours worth knowing before you rely on them:

- `CliLogger` honours `References.LogToStderr` as a **one-way** override — it can force everything to stderr, and can never move an error onto stdout.
- `CliRuntime` keeps an exit code the error already carries via `Runtime.errorExitCode`; the `exitCode` option is a fallback, not an override. An interrupt is left alone.

## Testing

`@effected/cli/testing` is a separate entrypoint — importing `@effected/cli`
never pulls it in — for spawning a **built** bin hermetically and reading its
exit code and streams as data:

```ts
import { CliTest } from "@effected/cli/testing";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

describe("check", () => {
  it.effect("exits 1 when it finds a problem", () =>
    Effect.gen(function* () {
      const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" });
      const result = yield* CliTest.run("./dist/check.js", ["--strict"], {
        sandbox,
        execPath: process.execPath,
      });
      assert.strictEqual(result.exitCode, 1);
      assert.include(result.stdout, "missing changeset");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
```

`CliTest.sandbox({ path })` mints a scoped temp directory with a fresh `HOME`
and `XDG_{CONFIG,DATA,STATE,CACHE}_HOME`, `NO_COLOR: "1"`, and the `path` you
pass as `PATH` — the host environment is never inherited. `CliTest.run` never
leaves `stdin` as an open pipe: when you omit it, or pass `""`, the child
receives an already-ended empty input, so a stdin-reading bin cannot hang the
test.

## License

[MIT](LICENSE)
