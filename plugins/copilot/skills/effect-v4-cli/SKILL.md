---
name: effect-v4-cli
description: >-
  Use when building a command-line tool on Effect v4 — there is no v4 @effect/cli package (its
  releases still peer on effect ^3.x), and the CLI framework lives in core as
  effect/unstable/cli (Command, Flag, Argument, Primitive, Prompt), with HTTP as
  effect/unstable/http (HttpClient, FetchHttpClient). Covers Command.Environment and why a CLI
  package is integrated tier rather than pure, the exit-code contract (a usage error must fail, a
  no-match must not), and the two different `Command`s (spawning is core's
  effect/unstable/process, NOT unstable/cli). Surface verified against effect@4.0.0-rc.109.
---

# Effect v4 CLIs

**Do not install `@effect/cli`.** Its latest release is `0.77.0`, it declares
`peerDependencies: { effect: "^3.22.1", "@effect/platform": "^0.97.1",
"@effect/printer": "^0.51.0", "@effect/printer-ansi": "^0.51.0" }`, and its
only dist-tags are `latest` and `snapshot` — **no `beta` tag, so there is no v4
line**. It keeps shipping releases, so "it was updated recently" is not evidence
of v4 support; check the `effect` peer range, which has never crossed to `^4`.
Installing it drags an `effect@3` and the `@effect/platform` / `@effect/printer`
peer chain into a v4 package.

The CLI framework lives **in core**:

| you might reach for | what actually exists |
| --- | --- |
| `@effect/cli` | **`effect/unstable/cli`** |
| `@effect/platform` `HttpClient` | **`effect/unstable/http`** |

`effect/unstable/cli` exports twelve modules: `Argument`, `CliConfig`,
`CliError`, `CliOutput`, `Command`, `Completions`, `Flag`, `GlobalFlag`,
`HelpDoc`, `Param`, `Primitive`, `Prompt`. Note the vocabulary: an
option is a **`Flag`**, not an `Option` (the name `Option` belongs to the data
type).

`effect/unstable/http` carries `HttpClient` and `FetchHttpClient`.
**`FetchHttpClient.layer` is `Layer<HttpClient>` with no error channel and no
requirements** — it needs no platform package at all, so an HTTP-calling CLI does
not become integrated tier on the HTTP client's account.

## `Command.Environment` — the fact that decides your package tier

~~~ts
// effect/unstable/cli/Command.ts:391
export type Environment =
  FileSystem.FileSystem | Path.Path | Terminal.Terminal | ChildProcessSpawner | Stdio.Stdio
~~~

Running a `Command` requires all five. **Core declares all five and implements
almost none of them for Node:**

| service | what core actually ships |
| --- | --- |
| `Path` | `Path.layer` — a real implementation (posix), `Path.ts:867` |
| `FileSystem` | `FileSystem.layerNoop(partial)` — a **stub factory**, for tests (`FileSystem.ts:954`) |
| `Stdio` | `Stdio.layerTest(partial)` — **test-only**, by its name and its shape (`Stdio.ts:152`) |
| `Terminal` | **no layer at all** — `Terminal.ts` declares no `layer` export |
| `ChildProcessSpawner` | the contract and the `ChildProcess` command values, but **no layer** — see below |

So a CLI you actually intend to run needs `@effect/platform-node` for the real
`Terminal` / `FileSystem` / `Stdio` implementations. **That is what makes a CLI
package integrated tier**, not pure — and it is a structural fact about core, not
a naming detail you can design around. Budget for the dependency at design time;
do not discover it when the first `Effect.provide` fails to typecheck.

The corollary: **do not put a CLI in the same package as a pure library.** Split
the CLI into its own package so the library keeps its `effect`-only peer closure.

## Two different `Command`s — spawning lives in `effect/unstable/process`

`effect/unstable/cli`'s `Command` is the **CLI command declaration**. It is not
the process-spawning `Command`, and the shared name is the whole trap.

Spawning is **in core**, at `effect/unstable/process`, which exports exactly two
modules (`unstable/process/index.ts`):

| you want | v4 |
| --- | --- |
| `@effect/platform/Command` (build a command value) | **`effect/unstable/process` `ChildProcess`** — `ChildProcess.make("git", ["status"])`, plus `pipeTo` / `prefix` / `setCwd` / `setEnv` (`ChildProcess.ts:603,693,727,792,831`). **Warning:** `setEnv` never sets `extendEnv` — it merges into `options.env` and leaves `extendEnv` untouched, so the child's env is ONLY what you pass; it loses `PATH`/`HOME` and can't find its own binaries. To add vars on top of the parent env, use `Run.extendEnv` from `@effected/commands` (or pass `{ env, extendEnv: true }` to `make`, where `extendEnv` is a real option at `ChildProcess.ts:405`) |
| `@effect/platform/CommandExecutor` (run it) | **`effect/unstable/process` `ChildProcessSpawner`** — a `Context.Service` with `spawn` / `exitCode` / `string` / `lines` / `streamString` / `streamLines` (`ChildProcessSpawner.ts:252`) |

> **Do not hand-roll a `node:child_process` layer or a parallel
> `Command`/`CommandRunner` vocabulary.** One did survive four review gates in
> this repo before a source check found `effect/unstable/process` already
> declared the entire surface; the package was deleted the same day it was built.

What core does **not** ship is a **layer** for `ChildProcessSpawner` — the
contract is declared, the Node implementation is not (it arrives with
`NodeServices.layer` from `@effect/platform-node`). That is the same structural
class of gap as `Terminal`, with the same tier consequence for a CLI that
actually shells out. Requiring `ChildProcessSpawner` in `R` is free; taking
`@effect/platform-node` as a dependency edge is not.

## The boundary core does not give you — reach for `@effected/cli`

`effect/unstable/cli` owns parsing, flags, the command tree and help. It owns
**nothing** about how output reaches a person, and the three defaults you get
are all wrong at a terminal. Each is invisible from the code and only shows up
when a user looks at the output:

1. **Effect's default logger emits `[00:33:56.619] INFO (#2): message`** — right
   for a scraped service, wrong for a tool someone is watching. It will destroy
   any formatted table you print.
2. **An unhandled failure is reported by `runMain` through the DEFAULT logger,
   on stdout** — outside the layers your program installed. So a program that
   carefully installs a CLI logger still prints its failures in the shape that
   logger exists to replace, on the one stream errors must not use
   (`mytool run > log.txt` must still show failures on the terminal).
3. **A `SchemaIssue` tree is not a sentence.** Core *does* ship formatters —
   `SchemaIssue.makeFormatterStandardSchemaV1` — but they live in `SchemaIssue`
   rather than `Schema` or `SchemaError`, are named `makeFormatter*` rather than
   anything containing "render", and `SchemaError.message` does not use them, so
   the obvious probe hints at nothing. Two engineers searched for two rounds and
   concluded they did not exist.

**`@effected/cli` is the boundary for all three** — `CliLogger`, `CliRuntime`
and the schema/config issue renderers. It is deliberately not a second
framework: parsing stays core's.

Two implementation facts worth knowing even if you write your own:

- **A logger cannot write through `Stdio`'s sinks.** `Logger.make` takes a
  *synchronous* callback and a `Sink` write is an `Effect`. The path that works
  is the one core's own `defaultLogger` takes: read the **`Console` reference off
  the fiber** (`Console.Console` is a public `Context.Reference` with a default,
  so nothing enters `R`), then `console.error` vs `console.log` by level. It is
  also the only design that is *testable* — a `process.stdout` write cannot be
  asserted without stubbing globals, which is why nobody notices when the
  stderr/stdout split regresses. **Compare levels ordinally**
  (`LogLevel.isGreaterThanOrEqualTo`), never by string equality against `"Error"`.
- **Exit code and duplicate-report suppression are markers on the error**, read
  off the squashed failure: `Runtime.errorExitCode` and `Runtime.errorReported`.
  Beware the polarity — **`errorReported: false` is what SUPPRESSES** the
  runtime's own log ("already reported"); omitted or non-boolean is treated as
  `true` and it logs. The intuitive `true` produces exactly the double report
  you were trying to avoid.

## The exit-code contract

`effect/unstable/cli` never calls `process.exit`. The non-zero exit comes from
the **program failing** — the runtime maps a failed effect to a non-zero status.
Everything follows from that one fact:

> **A usage error must FAIL. A no-match result must NOT.**

`CliError.UserError` is the general-purpose failure for "the user asked for
something invalid". The full `CliError` union is nine members
(`CliError.ts:74`): `UnrecognizedOption`, `DuplicateOption`, `MissingOption`,
`MissingArgument`, `UnexpectedArgument`, `InvalidValue`, `UnknownSubcommand`,
`ShowHelp`, `UserError`. An exhaustive `catchTags` or `Match` that omits
`UnexpectedArgument` will not compile — and one written before it existed is
exactly the shape that breaks on a beta advance.

~~~ts
import { CliError } from "effect/unstable/cli"

// WRONG — logs the problem and returns void. The effect SUCCEEDS, so the
// process exits 0 and CI treats the broken invocation as a pass.
Effect.gen(function* () {
  if (!isValid(input)) {
    yield* Effect.logError(`bad --target: ${input}`)
    return
  }
  …
})

// RIGHT — a usage error is a FAILURE.
Effect.gen(function* () {
  if (!isValid(input)) {
    return yield* Effect.fail(new CliError.UserError({ cause: `bad --target: ${input}` }))
  }
  …
})
~~~

This is not a hypothetical: a review found usage errors exiting 0 in exactly this
shape. Logging feels like reporting; to the shell it is silence.

The other half of the rule is just as load-bearing. **A query that legitimately
matches nothing is a success, not a usage error.** "No versions satisfied the
range" is a *result* — print it and exit 0. Failing it teaches users' CI to treat
an honest empty answer as a broken invocation. Ask: did the *user* do something
wrong (fail), or did the *world* simply not contain what they asked for (succeed)?

## Testing a CLI

Two false-green traps bite CLIs specifically. Both are covered in
`effect-v4-testing`, and both have cost this repo a bug:

- **`it.effect` installs `TestClock` at the epoch**, so anything reading
  `DateTime.now` computes against **1970**. A CLI that filters releases by date
  resolves *zero* of them, because every release is "in the future". Set the clock
  before asserting on anything time-dependent.
- **`TestConsole.logLines` accumulates for the whole test.** A test that invokes
  the CLI twice and asserts on `logLines` both times is asserting against the
  first run's output both times — the second assertion cannot fail.

## Related skills

- **`effect-v4-module-index`** — which core module owns a capability, including
  `effect/unstable/process` and the `NodeServices.layer` boundary.
- **`effect-v4-idioms`** — `PlatformError`, typed errors and core patterns.
- **`effect-v4-services-layers`** — providing `Command.Environment` once at the
  boundary, and the memoization discipline.
- **`effect-v4-testing`** — `TestClock`, `TestConsole`, and proving a suite can fail.
