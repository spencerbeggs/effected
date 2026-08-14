# @effected/cli

[![npm](https://img.shields.io/npm/v/@effected%2Fcli?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

The boundary layer of a command-line program built on `effect/unstable/cli`: how output reaches a human, how a failure is reported, and how a schema issue becomes a sentence someone can act on. `CliLogger` renders log records as plain lines and routes diagnostics to stderr, reading the `Console` off the fiber so it needs no platform package and the stream split is actually testable. `CliRuntime.reportFailures` catches inside your program so a failure prints through *your* logger instead of Effect's default one on stdout, then re-fails with the exit code and the no-double-report mark. `SchemaIssueRenderer` and `ConfigIssueRenderer` turn issue trees into `unknown key at groups.g.rulesetz`.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
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
import { Effect, Layer } from "effect";

declare const AppLive: Layer.Layer<never>;

const program = Effect.gen(function* () {
  yield* Effect.log("building 3 packages");
  yield* Effect.logError("nothing to build");
});

// Merged, not provided beneath: this way it also covers lines emitted during
// layer construction, which is exactly where a startup failure prints.
const MainLive = Layer.mergeAll(AppLive, CliLogger.layer());

NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures(), Effect.provide(MainLive)));
// stdout: building 3 packages
// stderr: nothing to build
// No timestamp, no level, no fiber id — and the diagnostic line never lands on stdout.
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

## Features

- `CliLogger.layer(options?)` — replaces the default logger with plain lines, routing `Error` and above to stderr. The threshold is the `stderrFrom` option, compared ordinally, so a level added upstream lands on the right stream without a change here.
- `CliLogger.make(options?)` — the `Logger` itself, for composing into a logger set you already have.
- `CliRuntime.reportFailures(options?)` — reports through your logger, then re-fails with an exit code and the mark that stops the runtime reporting it a second time.
- `CliRuntime.reported(error, exitCode?)` — marks an error you reported yourself, so the runtime stays quiet about it.
- `SchemaIssueRenderer.render(issue)` — a `SchemaIssue` tree becomes one line per rejected value.
- `ConfigIssueRenderer.render(error)` — the same rendering, reading `issue` off a `ConfigValidationError`.

Two behaviours worth knowing before you rely on them:

- `CliLogger` honours `References.LogToStderr` as a **one-way** override — it can force everything to stderr, and can never move an error onto stdout.
- `CliRuntime` keeps an exit code the error already carries via `Runtime.errorExitCode`; the `exitCode` option is a fallback, not an override. An interrupt is left alone.

## License

[MIT](LICENSE)
