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
