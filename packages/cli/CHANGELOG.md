# @effected/cli

## 0.2.0

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.4.2 | 0.5.0 |

* | Dependency | Type           | Action  | From           | To           |                                                                       |
  | :--------- | :------------- | :------ | :------------- | :----------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.1.0

### Features

* ### New package: `@effected/cli`

  The boundary layer of a command-line program built on `effect/unstable/cli` — how output reaches a human, how a failure is reported, and how a schema issue becomes a sentence. It is **not** a CLI framework: core owns parsing, flags, the command tree and help, and this package must never grow a second one.

  Everything here shares one property: a consumer only discovers the need by shipping bad output to a person. None of it fails a type-check, a test, or a review of the code in isolation.

  ```ts
  import { CliLogger, CliRuntime } from "@effected/cli";
  import { NodeRuntime } from "@effect/platform-node";
  import { Effect, Layer } from "effect";

  const MainLive = Layer.mergeAll(AppLive, CliLogger.layer());

  NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures(), Effect.provide(MainLive)));
  ```

  **`CliLogger`** renders a log record as a plain line and routes `Error`/`Fatal` to stderr. Effect's default logger emits `[00:33:56.619] INFO (#2): message`, which is right for a service being scraped and wrong for a tool someone is watching. It reads the `Console` off the fiber rather than writing to `process.stdout`: `Logger.make` takes a synchronous callback and a `Sink` write is an `Effect`, so `Stdio` is unreachable from a logger — and the reference approach keeps the package platform-free while making the stream split assertable, which a `process.stdout` write is not. `References.LogToStderr` is honoured as a one-way override: it can force everything to stderr, never move an error onto stdout.

  **`CliRuntime.reportFailures`** fixes *where* a failure is reported. A platform `runMain` composes its reporting `tapCause` around the already-provided effect, so an unhandled failure prints through Effect's **default** logger — outside your layers, in the format `CliLogger` exists to replace, on **stdout**. This catches inside the program, renders through your logger, and re-fails carrying `Runtime.errorExitCode` and `Runtime.errorReported`, so the exit code is right and the runtime does not report it twice. No platform import. An error that already carries its own exit code keeps it; an interrupt is left alone.

  **`SchemaIssueRenderer`** and **`ConfigIssueRenderer`** flatten an issue tree to `unknown key at groups.g.cleanup.rulesetz`. Core ships the formatters this wraps, and they are effectively undiscoverable — they live on `SchemaIssue` rather than `SchemaError` or `Schema`, are named `makeFormatter*`, and `SchemaError.message` does not use them, so printing the error hints at nothing. One phrasing is overridden: core's `"Expected no excess property"` describes the schema's rule rather than the user's mistake. Lines are deduplicated, because a union otherwise repeats the same unknown-key line once per branch, burying the lines that say which shapes were allowed.

  `@effected/config-file` is an **optional** peer, consumed only by `ConfigIssueRenderer`, which is a module nothing else imports — so a consumer who does not install it never reaches for it at runtime. [#352][#352]

### Dependencies

| Dependency            | Type       | Action  | From  | To    |
| --------------------- | ---------- | ------- | ----- | ----- |
| @effected/config-file | dependency | updated | 0.3.1 | 0.4.0 |

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#352]: https://github.com/spencerbeggs/effected/pull/352
