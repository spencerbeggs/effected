---
name: effect-v4-cli
description: Use when building or porting a command-line tool on Effect v4 — @effect/cli is DEAD on the v4 line (its latest peers on effect ^3.21.x), and the CLI framework now lives in core as effect/unstable/cli (Command, Flag, Argument, Primitive, Prompt), with HTTP as effect/unstable/http (HttpClient, FetchHttpClient). Covers Command.Environment and why a CLI package is integrated tier rather than pure, the exit-code contract (a usage error must fail, a no-match must not), and the process-spawning gap. Verified against effect@4.0.0-beta.94.
---

# Effect v4 CLIs

**Do not install `@effect/cli`.** Its latest release is `0.75.2`, it declares
`peerDependencies: { effect: "^3.21.2" }`, and it publishes **no beta
dist-tag** — there is no v4 line. Installing it drags a v3 `effect` and the
`@effect/platform` / `@effect/printer` peer chain into a v4 package.

The CLI framework moved **into core**:

| you want | v4 |
| --- | --- |
| `@effect/cli` | **`effect/unstable/cli`** |
| `@effect/platform` `HttpClient` | **`effect/unstable/http`** |

`effect/unstable/cli` exports `Argument`, `CliError`, `CliOutput`, `Command`,
`Completions`, `Flag`, `GlobalFlag`, `HelpDoc`, `Param`, `Primitive`, `Prompt`.
Note the v3→v4 vocabulary shift: an option is a **`Flag`**, not an `Option` (the
name `Option` belongs to the data type).

`effect/unstable/http` carries `HttpClient` and `FetchHttpClient`.
**`FetchHttpClient.layer` is `Layer<HttpClient>` with no error channel and no
requirements** — it needs no platform package at all, so an HTTP-calling CLI does
not become integrated tier on the HTTP client's account.

## `Command.Environment` — the fact that decides your package tier

~~~ts
// effect/unstable/cli/Command.ts:355
export type Environment =
  FileSystem.FileSystem | Path.Path | Terminal.Terminal | ChildProcessSpawner | Stdio.Stdio
~~~

Running a `Command` requires all five. **Core declares all five and implements
almost none of them for Node:**

| service | what core actually ships |
| --- | --- |
| `Path` | `Path.layer` — a real implementation (posix) |
| `FileSystem` | `FileSystem.layerNoop(partial)` — a **stub factory**, for tests |
| `Stdio` | `Stdio.layerTest(partial)` — **test-only**, by its name and its shape |
| `Terminal` | **no layer at all** |
| `ChildProcessSpawner` | **no layer at all** |

So a CLI you actually intend to run needs `@effect/platform-node` for the real
`Terminal` / `FileSystem` / `Stdio` implementations. **That is what makes a CLI
package integrated tier**, not pure — and it is a structural fact about core, not
a naming detail you can design around. Budget for the dependency at design time;
do not discover it when the first `Effect.provide` fails to typecheck.

The corollary: **do not put a CLI in the same package as a pure library.** Split
the CLI into its own package so the library keeps its `effect`-only peer closure.

## There is no process-spawning `Command` in core

Effect v4 core has **no `Command` / `CommandExecutor`** of the v3
process-spawning kind — `effect/unstable/cli`'s `Command` is the *CLI command
declaration*, an entirely different thing that happens to share the name.
`ChildProcessSpawner` is the v4 primitive for spawning, and as noted core ships
**no layer** for it. Shelling out therefore also requires `@effect/platform-node`
— the same structural class of gap, and the same tier consequence.

## The exit-code contract

`effect/unstable/cli` never calls `process.exit`. The non-zero exit comes from
the **program failing** — the runtime maps a failed effect to a non-zero status.
Everything follows from that one fact:

> **A usage error must FAIL. A no-match result must NOT.**

`CliError.UserError` is the general-purpose failure for "the user asked for
something invalid". The full `CliError` union is `UnrecognizedOption`,
`DuplicateOption`, `MissingOption`, `MissingArgument`, `InvalidValue`,
`UnknownSubcommand`, `ShowHelp`, `UserError`.

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

- **`effect-v4-construct-map`** — the v3→v4 lookup tables (`references/platform.md`
  for `@effect/platform-node` and `PlatformError`).
- **`effect-v4-services-layers`** — providing `Command.Environment` once at the
  boundary, and the memoization discipline.
- **`effect-v4-testing`** — `TestClock`, `TestConsole`, and proving a suite can fail.
