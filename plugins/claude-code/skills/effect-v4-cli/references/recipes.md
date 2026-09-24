# CLI recipes

Loaded from `effect-v4-cli`. Patterns worth copying rather than depending on, because each one is a per-consumer choice the kit has no single right answer for — the one-line "why a recipe" under each heading says what that choice is.

## The main assembly {#the-main-assembly}

A CLI front end splits across a few small files, each with one job:

- `bin.ts` — the actual executable; calls `main()` and nothing else.
- `main.ts` — assembles the program with `CliRuntime.main` and calls the
  platform's runner. **Exported from `./main`, never from `.`** — importing
  the package for its command tree or its types must never also pull in
  `CliRuntime`, `NodeRuntime` or a platform layer.
- `index.ts` — the command tree, `Command.make`/`Command.withSubcommands`,
  and anything a consumer might import.
- `version.ts` — the one file allowed to read `process.env`/`argv` for
  version and distribution identity (see `#process-confinement`).

~~~ts
import { CliColor, CliRuntime } from "@effected/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Layer } from "effect"
import { Command } from "effect/unstable/cli"

declare const rootCommand: Command.Command<"demo", Record<string, never>>

export const main = (): void => {
  const platform = CliColor.formatterLayer().pipe(Layer.provideMerge(NodeServices.layer))
  NodeRuntime.runMain(CliRuntime.main(Command.run(rootCommand, { version: "1.0.0" }), { platform }))
}
~~~

Why a recipe: every consumer's command tree, flag set and platform choice
differ; there is nothing left to extract beyond `CliRuntime.main` itself,
which the kit already ships.

## The version constant {#version-constant}

~~~ts
export const CLI_VERSION: string = process.env.__PACKAGE_VERSION__ ?? "0.0.0"

console.log(CLI_VERSION)
~~~

The bundler substitutes `__PACKAGE_VERSION__` at build time; reading
`package.json` at runtime instead reports the *wrong* package once the code
that reads it moves into a shared engine.

Why a recipe: the substitution is a build-time define wired into one
package's own bundler config — the kit cannot perform a consumer's own
package substitution for it.

## The version formatter {#version-formatter}

~~~ts
import { CurrentDistribution, distributionSuffix } from "@effected/engine"
import { Effect, Option } from "effect"

const formatVersion = (
  name: string,
  version: string,
  distribution: Option.Option<{ readonly name: string; readonly version: string }>,
): string => `${name} ${version}${distributionSuffix(distribution)}`

const program = Effect.gen(function* () {
  const distribution = yield* CurrentDistribution
  return formatVersion("mytool", "1.2.3", distribution)
}).pipe(Effect.provideService(CurrentDistribution, Option.some({ name: "carrier", version: "0.4.0" })))

console.log(await Effect.runPromise(program))
~~~

Prints `mytool 1.2.3 via carrier 0.4.0`. `CliColor.formatterLayer`'s
`formatVersion` override takes `(name, version)`, in that order — pass
anything else and the override silently formats the wrong pair.

**Ruling for the reader:** a *consumer* front end may depend on both
`@effected/cli` and `@effected/engine`. The kit's own `cli` package may
depend on neither `@effected/engine` nor any other kit package that isn't
`effect` itself — the two sit at the same layer.

Why a recipe: combining `distributionSuffix` into a formatter is only
possible for a package willing to take the `@effected/engine` dependency,
which the kit's own `cli` package is specifically forbidden from taking.

## The JSON failure tap {#json-failure-tap}

~~~ts
import { Console, Effect } from "effect"

interface Envelope {
  readonly ok: false
  readonly error: string
}

const envelope = (error: unknown): Envelope => ({ ok: false, error: String(error) })

class DomainError extends Error {}

const body = Effect.fail(new DomainError("could not reach the registry"))

const withJsonFailureTap = body.pipe(Effect.tapError((error) => Console.log(JSON.stringify(envelope(error)))))

await Effect.runPromiseExit(withJsonFailureTap)
~~~

Under `--format json`, a handler's own failures print a JSON document instead
of a human sentence, by tapping the error and printing before re-failing.
**The gap:** a parse error happens before any handler runs at all, so an
invocation that fails to parse never reaches this tap — no JSON document
reaches stdout for it, only whatever `Command.runWith` rendered on stderr.

Why a recipe: the envelope's own shape and what counts as an "error" field
are a consumer's wire contract; only the tap-then-refail combinator
generalizes.

## Reading stdin {#reading-stdin}

~~~ts
import { Effect, Schema, Stdio, Stream } from "effect"
import { CliError } from "effect/unstable/cli"

const Payload = Schema.Struct({ name: Schema.String })

const readStdinPayload = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  if (yield* stdio.stdinIsTerminal) {
    return yield* Effect.fail(new CliError.UserError({ cause: "refusing to read from an interactive terminal" }))
  }
  const text = yield* Stream.mkString(Stream.decodeText(stdio.stdin))
  return yield* Schema.decodeUnknownEffect(Payload)(JSON.parse(text))
})

const program = readStdinPayload.pipe(
  Effect.provide(Stdio.layerTest({ stdin: Stream.make(new TextEncoder().encode('{"name":"demo"}')) })),
)

console.log(await Effect.runPromise(program))
~~~

Prints `{ name: 'demo' }`. Three rules in one recipe: read through `Stdio`,
never `process.stdin`, so it is testable without stubbing a global; refuse a
TTY stdin with a usage-coded error rather than hanging on a read that will
never come; decode with `Schema.decodeUnknownEffect`, never
`decodeUnknownSync` (see `gotchas.md`).

Why a recipe: the payload's schema and what a TTY refusal should say are
per-command; only the `Stdio`-not-`process.stdin` discipline generalizes.

## Process confinement {#process-confinement}

Every `process` read — `env`, `argv`, `cwd`, `execPath`, `isTTY` — lives in
`bin.ts`, `main.ts` or `version.ts` and is passed down into the rest of the
program as a plain value. Nothing below those three files reads `process`
directly. Pin the allowlist with `SourceBoundary.scan` from
`@effected/workspaces/testing`, reusing the already-gated example in the
`effected-packages` skill's `workspaces.md` reference rather than writing a
new scanner:

~~~ts
import { SourceBoundary } from "@effected/workspaces/testing";

const offences = SourceBoundary.check("src/a.ts", "const argv = process.argv;", ["process"]);
console.log(offences.length);
// => 1
~~~

Why a recipe: `SourceBoundary` is the kit's own check (`@effected/workspaces/testing`
already ships it); which files a given CLI allowlists is per-repo, not
something the kit can decide for a consumer.

## An injectable "now" {#injectable-now}

~~~ts
import { Context, Effect, Layer } from "effect"

class Now extends Context.Service<Now, { readonly current: () => number }>()("recipes/Now") {
  static readonly layer = (override: string | undefined) =>
    Layer.succeed(Now, { current: () => (override !== undefined ? Number(override) : Date.now()) })
}

const program = Effect.gen(function* () {
  const now = yield* Now
  return now.current()
})

console.log(await Effect.runPromise(program.pipe(Effect.provide(Now.layer(process.env.MYTOOL_NOW)))))
~~~

Read the override env var once, in `main`, and provide a `Now` service from
it rather than calling `Date.now()` wherever the time is needed — an e2e test
that spawns the built bin can then pin the clock through the child's
environment instead of racing the real one.

Why a recipe: the override variable's name and what "now" means to a given
tool are consumer choices; only the read-once-in-`main` discipline
generalizes.
