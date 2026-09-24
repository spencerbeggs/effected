---
name: effect-v4-cli
description: Use when building or reviewing a command-line program on Effect v4 — effect/unstable/cli in core, its exit-code contract, and the @effected/cli boundary that keeps stdout clean and failures on stderr.
when_to_use: effect/unstable/cli, Command, Flag, Argument, @effect/cli, exit code, usage error, --format json, stdout vs stderr, CliLogger, CliRuntime, NO_COLOR, bin-only package, emitDts false, Command.Environment, ChildProcess vs Command
---

# Effect v4 CLIs

Core owns parsing: `effect/unstable/cli` is the whole framework — `Command`,
`Flag`, `Argument`, help, exit-code mapping. It owns nothing about how output
reaches a person. `@effected/cli` is the boundary that fixes that: it plugs a
terminal-appropriate logger, a runtime wrapper that reports failures through
your own layers, and typed renderers for schema and config issues into the
gap core leaves open.

| construct | import | reach for it when |
| --- | --- | --- |
| `Command`, `Flag`, `Argument` | `effect/unstable/cli` | declaring the command tree, its flags and positional arguments |
| `ChildProcess`, `ChildProcessSpawner` | `effect/unstable/process` | building or running a spawned command — **not** `effect/unstable/cli`'s `Command`, which only declares your own CLI |
| `CliLogger` | `@effected/cli` | replacing the default `[00:33:56.619] INFO (#2)` logger with plain, level-routed output |
| `CliRuntime` | `@effected/cli` | assembling `main`, reporting failures through your own logger, and setting the process exit code |

## Standards

- Build the CLI on `effect/unstable/cli`, never `@effect/cli` — its releases still peer on `effect ^3.x`.
- Give every `Flag.Boolean` an explicit `Flag.withDefault` or `Flag.optional` — omission is a usage error, not `false`.
- Provide `@effect/platform-node`'s `NodeServices.layer` once, at the program boundary, to satisfy `Command.Environment`.
- Fail a usage error (`Effect.fail(new CliError.UserError(...))`); succeed a query that legitimately matches nothing.
- Write program output with `Console.log`, never `Effect.log*` — every log call is a diagnostic, not output.
- Set `emitDts: false` in `savvy.build.ts` for a package whose `exports` is `"./package.json"` only.

## Footguns

- No v4 line of `@effect/cli` exists — see `core-framework.md`.
- `Flag.Boolean` has no implicit `false`; omission is `MissingOption` — see `core-framework.md`.
- The default logger and `runMain`'s failure report both land on stdout, not stderr — see `output-and-logging.md`.
- `errorReported: false` is what SUPPRESSES the runtime's own log, not what causes it — see `output-and-logging.md`.
- `Cannot merge zero API models` means the package needs `emitDts: false`, not an `index.ts` — see `bin-only-package.md`.
- A no-match result must succeed; only a usage error may fail — see `exit-codes.md`.
- `it.effect` starts `TestClock` at the epoch, and `TestConsole.logLines` accumulates across a whole test — see `testing-a-cli.md`.

## Additional resources

- [core-framework.md](./references/core-framework.md) — the module inventory, the rc.113 PascalCase rename, `Flag.Boolean`'s missing default, `Command.Environment`, and the two different `Command`s. Load when: writing or reviewing the `Command`/`Flag`/`Argument` declaration itself.
- [output-and-logging.md](./references/output-and-logging.md) — the three defaults core gets wrong at a terminal and the `@effected/cli` implementation facts behind `CliLogger` and exit-code reporting. Load when: wiring a logger, formatting output, or debugging a duplicate or missing failure report.
- [bin-only-package.md](./references/bin-only-package.md) — `emitDts: false`, the `exports: "./package.json"` shape, and why `Cannot merge zero API models` is not an extractor bug. Load when: building a package whose only surface is a `bin`.
- [exit-codes.md](./references/exit-codes.md) — the exit-code contract, the `CliError` union, and the WRONG/RIGHT shape of a usage-error check. Load when: deciding whether a code path should fail or succeed, or handling `CliError` exhaustively.
- [testing-a-cli.md](./references/testing-a-cli.md) — the two false-green traps specific to testing a CLI. Load when: writing a test that asserts on CLI output or time-dependent behavior.

Anchors in this skill and its references cite the vendored tag at
`.repos/effect/packages/effect/src/`; a consumer without that tree searches
`node_modules/effect/src` by symbol name instead of by line number.

## Related skills

- **`effect-v4-module-index`** — which core module owns a capability, including
  `effect/unstable/process` and the `NodeServices.layer` boundary.
- **`effect-v4-idioms`** — `PlatformError`, typed errors and core patterns.
- **`effect-v4-services-layers`** — providing `Command.Environment` once at the
  boundary, and the memoization discipline.
- **`effect-v4-testing`** — `TestClock`, `TestConsole`, and proving a suite can fail.
