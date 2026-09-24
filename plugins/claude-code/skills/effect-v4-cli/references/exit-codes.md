# The exit-code contract

Loaded from `effect-v4-cli`. Covers why a non-zero exit comes from the program failing, the `CliError` union, and the WRONG/RIGHT shape of a usage-error check.

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
import { Effect } from "effect"
import { CliError } from "effect/unstable/cli"

declare const input: string
declare function isValid(value: string): boolean

// WRONG — logs the problem and returns void. The effect SUCCEEDS, so the
// process exits 0 and CI treats the broken invocation as a pass.
Effect.gen(function* () {
  if (!isValid(input)) {
    yield* Effect.logError(`bad --target: ${input}`)
    return
  }
  yield* Effect.log("target is valid")
})

// RIGHT — a usage error is a FAILURE.
Effect.gen(function* () {
  if (!isValid(input)) {
    return yield* Effect.fail(new CliError.UserError({ cause: `bad --target: ${input}` }))
  }
  yield* Effect.log("target is valid")
})
~~~

This is not a hypothetical: a review found usage errors exiting 0 in exactly this
shape. Logging feels like reporting; to the shell it is silence.

The other half of the rule is just as load-bearing. **A query that legitimately
matches nothing is a success, not a usage error.** "No versions satisfied the
range" is a *result* — print it and exit 0. Failing it teaches users' CI to treat
an honest empty answer as a broken invocation. Ask: did the *user* do something
wrong (fail), or did the *world* simply not contain what they asked for (succeed)?

## `CliRuntime.main` assembles the whole program, in one order

`CliRuntime.main(program, { platform, logger?, render?, exitCode?, usageExitCode?
})` wraps an `effect/unstable/cli` program so every failure — a parse error, a
layer-build failure, a domain error, a findings exit — reports the same way.
The order it assembles in is the whole point, not an implementation detail:

1. A fresh `CliExit` is provided innermost, so `CliExit.set` inside the
   program writes to the cell `main` reads back after success.
2. The `platform` layer is provided **inside** failure reporting, so a
   layer-build failure (an unset `HOME`, say) renders as one line through the
   configured `render` and exits with the configured `exitCode` fallback,
   instead of escaping to an unhandled stack trace.
3. `CliRuntime.reportFailures` catches every failure, remaps `ShowHelp` and an
   already-rendered `CliError.UserError` to `usageExitCode`, and re-fails with
   a marked, exit-coded error.
4. The `logger` is provided **outermost** (default `CliLogger.layer()`), so it
   is present no matter which of the layers above fails.

`CliRuntime.main` makes no platform choice of its own — pass `platform` and
still call your own runtime's runner:

~~~ts
import { CliExit, CliRuntime } from "@effected/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { Command } from "effect/unstable/cli"

const demo = Command.make("demo", {}, () =>
  Effect.gen(function* () {
    // A findings command: the handler still SUCCEEDS. CliExit.set records the
    // code CliRuntime.main turns into a real process exit once the run ends.
    yield* CliExit.set(2)
  }),
)

NodeRuntime.runMain(CliRuntime.main(Command.run(demo, { version: "1.0.0" }), { platform: NodeServices.layer }))
~~~

Running this prints nothing and exits `2`.

## The exit-code table

| code | when |
| --- | --- |
| `0` | success — including a bare `--help` or root invocation (`ShowHelp` with no errors) |
| `64` | usage — `usageExitCode`'s default, BSD `EX_USAGE`: a `ShowHelp` carrying parse errors, or a `CliError.UserError` `Command.runWith` already rendered |
| `130` | interrupt — the default teardown maps an interrupt-only cause to `130` before any error-exit-code logic runs |
| the `exitCode` fallback (default `1`) | any other failure that carries no `Runtime.errorExitCode` of its own |
| an error's own `Runtime.errorExitCode` | always wins over both fallbacks — see below |
| 1–3 | not reserved by the kit; a consumer's own taxonomy (infrastructure vs. conformance vs. lint, say) |

## Findings exit non-zero by succeeding, never by failing

A command whose non-zero exit reports a *result* — a linter that found
problems — must not fail to get there. **Call `CliExit.set(code)` from a
handler that still succeeds; never fail, and never call `process.exit` in a
handler.** A handler-level `process.exit` skips every finalizer scheduled
above it; `CliExit.set` instead records the code and lets `CliRuntime.main`
turn it into a marked failure the runtime's own teardown honours, with
finalizers intact.

`CliExit.set` keeps the **highest** code seen during a run, not the last one,
so a later "all clean" step can never quietly downgrade an earlier finding.
It dies as a defect naming the value when the code is not an integer in
`0..255` — `256` would silently wrap to a passing `0` exit, and a fraction
makes the eventual `process.exit` throw after the program has already ended.
**A program failure always beats findings**: when the program fails, `main`
never reads the `CliExit` cell at all, and the failure's own exit code (or the
`exitCode` fallback) is what the process exits with.

**`CliExit.layer` is for in-process tests only — never provide it yourself
inside a program `CliRuntime.main` runs.** `main` already provides a fresh
cell (`Layer.fresh`, so every provide mints a new one); providing the layer a
second time creates a second, unrelated cell that `main` never reads back.
`CliExit.set` calls made against that shadow cell are silently discarded, and
a findings run exits `0` having found something.

A domain error that is itself a usage error carries the marker directly —
`override readonly [Runtime.errorExitCode] = 64` on the error class — or is
marked at the throw site with `CliRuntime.reported(error, 64)`.
