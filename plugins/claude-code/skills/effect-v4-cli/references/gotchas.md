# CLI gotchas

Loaded from `effect-v4-cli`. Seven traps that pass a type-check and a casual test run, and only show up when the CLI is actually invoked the wrong way.

## `Command.provide` builds its layer before the handler runs

`Command.provide` (`unstable/cli/Command.ts:1448`) wraps the handler in
`Effect.provide(handler, layer)`. The layer is built to satisfy the handler's
requirements before the handler's own body can execute — so a handler cannot
validate an input the layer itself depends on (a `--config` path, say)
*before* that layer is built. Pre-flight the input in the handler and only
call `Effect.provide` there, instead of reaching for `Command.provide`, when
the layer might fail on a value the handler needs to check first.

~~~ts
import { Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { ChildProcessSpawner } from "effect/unstable/process"

const CliTestLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(() => Effect.die("unused"))),
)

const events: Array<string> = []

const configLayer = (config: { readonly path: string }) =>
  Layer.effectDiscard(Effect.sync(() => events.push(`layer built for ${config.path}`)))

const demo = Command.make("demo", { path: Flag.String("path") }, () =>
  Effect.sync(() => events.push("handler ran")),
).pipe(Command.provide(configLayer))

await Effect.runPromise(
  Command.runWith(demo, { version: "1.0.0" })(["--path", "config.json"]).pipe(Effect.provide(CliTestLayer)),
)

console.log(events)
~~~

Prints `[ 'layer built for config.json', 'handler ran' ]` — the layer-build
side effect always precedes the handler's, even though nothing at the call
site suggests an ordering.

## `Flag.File(name, { mustExist: true })` fails at parse time — exit 64, not your infrastructure code

The existence check runs inside the primitive's own parser
(`unstable/cli/Primitive.ts:498`), before any handler sees the value. A
failure there does not reach the handler as a domain error: `Command.runWith`
wraps every parse failure in a `CliError.ShowHelp`, which reports as a usage
error (exit `64`) — wrong for a `--config` whose *absence* is meant to be an
infrastructure error your own code decides how to report.

~~~ts
import { Effect, FileSystem, Layer, Path, Stdio, Terminal } from "effect"
import { CliError, Command, Flag } from "effect/unstable/cli"
import { ChildProcessSpawner } from "effect/unstable/process"

const CliTestLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(() => Effect.die("unused"))),
)

const demo = Command.make("demo", { config: Flag.File("config", { mustExist: true }) }, () => Effect.void)

const error = await Effect.runPromise(
  Command.runWith(demo, { version: "1.0.0", renderErrors: false })(["--config", "/does/not/exist.toml"]).pipe(
    Effect.provide(CliTestLayer),
    Effect.flip,
  ),
)

console.log(CliError.isCliError(error) && error._tag, (error as CliError.ShowHelp).errors[0]?._tag)
~~~

`Command.runWith` always renders the help document for a `ShowHelp`, even with
`renderErrors: false` (that option only controls the *extra* parse-error and
`UserError` detail); the last line this prints is `ShowHelp InvalidValue` — a
usage error, never a value the handler gets a chance to inspect or report
itself.

## Two optional positionals bind in declaration order

With one argument given, the **first** declared positional receives it — the
second stays `Option.none()` regardless of which one the invocation "meant."

~~~ts
import { Effect, FileSystem, Layer, Option, Path, Stdio, Terminal } from "effect"
import { Argument, Command } from "effect/unstable/cli"
import { ChildProcessSpawner } from "effect/unstable/process"

const CliTestLayer = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die("unused"),
      readLine: Effect.die("unused"),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, ChildProcessSpawner.make(() => Effect.die("unused"))),
)

const demo = Command.make(
  "demo",
  {
    first: Argument.String("first").pipe(Argument.optional),
    second: Argument.String("second").pipe(Argument.optional),
  },
  (config) =>
    Effect.sync(() =>
      console.log({ first: Option.getOrNull(config.first), second: Option.getOrNull(config.second) }),
    ),
)

await Effect.runPromise(
  Command.runWith(demo, { version: "1.0.0" })(["only-one"]).pipe(Effect.provide(CliTestLayer)),
)
~~~

Prints `{ first: 'only-one', second: null }`.

## `Schema.decodeUnknownSync` in a handler throws — a defect, not a typed failure

`Schema.decodeUnknownSync` throws a plain JS exception on a bad value. Thrown
synchronously inside `Effect.gen`, that exception becomes a **defect**
(`Die`), invisible to a `catchTag` and carrying none of the exit-code
machinery a typed `CliError` or domain error gets. `Schema.decodeUnknownEffect`
fails the effect instead, as a value a handler can catch and turn into a
usage error.

~~~ts
import { Cause, Effect, Exit, Schema } from "effect"

const Config = Schema.Struct({ port: Schema.Number })

const usingSync = Effect.gen(function* () {
  return Schema.decodeUnknownSync(Config)({ port: "not-a-number" })
})

const usingEffect = Effect.gen(function* () {
  return yield* Schema.decodeUnknownEffect(Config)({ port: "not-a-number" })
})

const [syncExit, effectExit] = await Promise.all([
  Effect.runPromiseExit(usingSync),
  Effect.runPromiseExit(usingEffect),
])

const kind = (exit: Exit.Exit<unknown, unknown>): string =>
  Exit.isSuccess(exit) ? "success" : Cause.hasDies(exit.cause) ? "Die" : "Fail"

console.log("decodeUnknownSync ->", kind(syncExit), "decodeUnknownEffect ->", kind(effectExit))
~~~

Prints `decodeUnknownSync -> Die decodeUnknownEffect -> Fail`.

## `Runtime.getErrorExitCode` cannot tell "chose 1" from "chose nothing"

It answers `1` both for an error explicitly marked `1` and for one that
carries no marker at all — an `exitCode` option that treats `1` as "no
opinion" would silently override a deliberate `1`. Test for the marker's
presence instead of trusting the return value alone.

~~~ts
import { Runtime } from "effect"

const marked = Object.assign(new Error("explicitly 1"), { [Runtime.errorExitCode]: 1 })
const unmarked = new Error("no opinion")

console.log(
  Runtime.getErrorExitCode(marked),
  Runtime.getErrorExitCode(unmarked),
  Runtime.errorExitCode in marked,
  Runtime.errorExitCode in unmarked,
)
~~~

Prints `1 1 true false` — both exit codes read `1`; only the `in` check tells
them apart.

## `Argument.Path` resolves a relative path against the process's own cwd, at parse time

The primitive resolves a non-absolute value with `path.resolve(value)`
(`unstable/cli/Primitive.ts:489`) — Node's own cwd-relative resolution, run
the moment the argument is parsed, not when the handler later reads it. A
handler that expects the raw string it was passed, or that resolves relative
to a directory the user supplied elsewhere, gets a different path than it
asked for.

## The built-in global flags are always inherited

`--help`, `--version`, `--wizard`, `--completions` and `--log-level`
(`unstable/cli/GlobalFlag.ts:156,179,202,222,249`) are registered on every
command tree, not opt-in per command — a subcommand cannot "not have"
`--help`, and a flag or argument named the same as one of these collides with
a global, not a local, definition.
