# CLI recipes

Loaded from `effect-v4-cli`. Patterns worth copying rather than depending on, because each one is a per-consumer choice the kit has no single right answer for — the one-line "why a recipe" under each heading says what that choice is.

## The main assembly {#the-main-assembly}

A CLI front end splits across a few small files, each with one job — the
same `bin.ts`/`main.ts`/`index.ts`/`version.ts` split the carrier pattern
uses at its own entry point; see
`design-patterns/references/carrier-entry-contract.md` for that contract's
own version of this layout:

- `bin.ts` — the actual executable; calls `main()` and nothing else.
- `main.ts` — assembles the program with `CliRuntime.main` and calls the
  platform's runner. **Exported from `./main`, never from `.`** — importing
  the package for its command tree or its types must never also pull in
  `CliRuntime`, `NodeRuntime` or a platform layer.
- `index.ts` — the command tree, `Command.make`/`Command.withSubcommands`,
  and anything a consumer might import.
- `version.ts` — the one file allowed to reference `process.env` for its
  bundler-defined version constant (see `#version-constant` — the bundler
  substitutes the value at build time, so this is not a runtime read) and
  `process.argv` for distribution identity (see `#process-confinement`).

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
import { CliColor } from "@effected/cli"
import { CurrentDistribution, distributionSuffix } from "@effected/engine"
import { Effect, FileSystem, Layer, Option, Path, Stdio, Terminal } from "effect"
import { Command } from "effect/unstable/cli"
import { ChildProcessSpawner } from "effect/unstable/process"

const versionLayer = Layer.unwrap(
  Effect.map(CurrentDistribution, (distribution) =>
    CliColor.formatterLayer({
      formatVersion: (name, version) => `${name} ${version}${distributionSuffix(distribution)}`,
    }),
  ),
)

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

const demo = Command.make("mytool", {}, () => Effect.void)

await Effect.runPromise(
  Command.runWith(demo, { version: "1.2.3" })(["--version"]).pipe(
    Effect.provide(versionLayer),
    Effect.provide(CliTestLayer),
    Effect.provideService(CurrentDistribution, Option.some({ name: "carrier", version: "0.4.0" })),
  ),
)
~~~

Prints `mytool 1.2.3 via carrier 0.4.0` — the real `--version` global flag,
not a hand-called formatter: `GlobalFlag`'s built-in version action calls
`formatter.formatVersion(command.name, version)` itself, so wiring
`versionLayer` once at the program boundary (alongside `CliColor`'s own
`formatterLayer`, never a second formatter built by hand) is enough.
`CliColor.formatterLayer`'s `formatVersion` override takes exactly
`(name, version)`, in that order — a replacement with a third required
parameter fails to typecheck (`TS2322`, not assignable to
`(name: string, version: string) => string`), so this cannot silently drift
to the wrong pair.

**Ruling for the reader:** a *consumer* front end may depend on both
`@effected/cli` and `@effected/engine`. The kit's own `cli` package may
depend on `@effected/config-file` (an optional peer, for config-issue
rendering) but never on `@effected/engine` or any other kit package beyond
that.

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
**The gap applies only when the tap sits inside the handler**, as it does
above: a parse error happens before any handler runs at all, so a tap
scoped to one handler's body never sees it — no JSON document reaches
stdout for it, only whatever `Command.runWith` rendered on stderr. Move the
tap to wrap the whole `Command.run`/`Command.runWith` call instead, and it
sees a `CliError.ShowHelp` the same way it sees a handler's own failure —
`Command.run`'s error channel already includes `CliError.CliError`.

Why a recipe: the envelope's own shape and what counts as an "error" field
are a consumer's wire contract; only the tap-then-refail combinator
generalizes.

## Reading stdin {#reading-stdin}

~~~ts
import { Cause, Effect, Schema, Stdio, Stream } from "effect"
import { CliError } from "effect/unstable/cli"

const Payload = Schema.Struct({ name: Schema.String })

const readStdinPayload = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  if (yield* stdio.stdinIsTerminal) {
    return yield* Effect.fail(new CliError.UserError({ cause: "refusing to read from an interactive terminal" }))
  }
  const text = yield* Stream.mkString(Stream.decodeText(stdio.stdin))
  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Payload))(text)
})

const runWith = (stdin: string) =>
  readStdinPayload.pipe(Effect.provide(Stdio.layerTest({ stdin: Stream.make(new TextEncoder().encode(stdin)) })))

console.log(await Effect.runPromise(runWith('{"name":"demo"}')))

const malformed = await Effect.runPromiseExit(runWith("{not json"))
console.log(malformed._tag, Cause.hasDies(malformed._tag === "Failure" ? malformed.cause : Cause.empty))
~~~

Prints `{ name: 'demo' }`, then `Failure false`. Four rules in one recipe:
read through `Stdio`, never `process.stdin`, so it is testable without
stubbing a global; refuse a TTY stdin with a usage-coded error rather than
hanging on a read that will never come; decode with
`Schema.decodeUnknownEffect`, never `decodeUnknownSync` (see `gotchas.md`);
and parse the JSON through `Schema.fromJsonString`, never a bare
`JSON.parse` — `JSON.parse` throws on malformed input, and thrown
synchronously inside `Effect.gen` that becomes an undeclared defect
(`Cause.hasDies` true) instead of the typed parse failure
(`Cause.hasDies` false) a caller can `catchTag` on, exactly the trap
`gotchas.md`'s `decodeUnknownSync` item describes for the decode step.

Why a recipe: the payload's schema and what a TTY refusal should say are
per-command; only the `Stdio`-not-`process.stdin` discipline generalizes.

## Process confinement {#process-confinement}

Every `process` read — `env`, `argv`, `cwd`, `execPath`, `isTTY` — lives in
`bin.ts`, `main.ts` or `version.ts` and is passed down into the rest of the
program as a plain value. Nothing below those three files reads `process`
directly. Pin the allowlist with `SourceBoundary.scan` from
`@effected/workspaces/testing`, modeled on the already-gated example in the
`effected-packages` skill's `workspaces.md` reference rather than writing a
new scanner:

~~~ts
import { NodeServices } from "@effect/platform-node"
import { assert, describe, layer } from "@effect/vitest"
import { SourceBoundary } from "@effected/workspaces/testing"
import { Effect, FileSystem, Path } from "effect"

describe("process reads stay in the three entry files", () => {
  layer(NodeServices.layer)((it) => {
    it.effect("bin.ts, main.ts and version.ts are allowed; index.ts is flagged", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = yield* fs.makeTempDirectoryScoped()
        yield* fs.writeFileString(path.join(root, "bin.ts"), "process.argv;")
        yield* fs.writeFileString(path.join(root, "main.ts"), "process.env.HOME;")
        yield* fs.writeFileString(path.join(root, "version.ts"), "process.env.__PACKAGE_VERSION__;")
        yield* fs.writeFileString(path.join(root, "index.ts"), "const argv = process.argv;")

        assert.deepStrictEqual(SourceBoundary.verifyFixtures(), [])

        const scan = yield* SourceBoundary.scan({
          root,
          rules: ["process"],
          allow: ["bin.ts", "main.ts", "version.ts"],
        })

        assert.deepStrictEqual(scan.violations, ["index.ts:1:14 process process"])
      }).pipe(Effect.scoped),
    )
  })
})
~~~

`verifyFixtures()` asserts the scanner's own shipped fixtures still pass
before trusting a scan built on it; `scan`'s `allow` globs exempt the three
entry files entirely (not merely lower their severity), so this is the
allowlist itself, runnable against real files rather than a one-line string.

Why a recipe: `SourceBoundary` is the kit's own check (`@effected/workspaces/testing`
already ships it); which files a given CLI allowlists is per-repo, not
something the kit can decide for a consumer.

## An injectable "now" {#injectable-now}

Pin core's own `Clock.Clock`, not a hand-rolled `Now` service — `DateTime.now`
and everything else that reads the time already resolves through it. Building
the override with `{ ...live, currentTimeMillis: ... }` looks right and is
not: `sleep` and the three `*Unsafe` readers are methods on the live clock's
prototype, not its own enumerable properties, so an object spread drops them
silently and the very next `Effect.sleep` in the program hangs on
`undefined is not a function`. Delegate every member you are not overriding
explicitly instead:

~~~ts
import { Clock, Config, ConfigProvider, DateTime, Effect } from "effect"

const pinnedClock = (live: Clock.Clock, epochMillis: number): Clock.Clock => ({
  currentTimeMillisUnsafe: () => epochMillis,
  currentTimeMillis: Effect.succeed(epochMillis),
  currentTimeNanosUnsafe: live.currentTimeNanosUnsafe,
  currentTimeNanos: live.currentTimeNanos,
  monotonicTimeNanosUnsafe: live.monotonicTimeNanosUnsafe,
  monotonicTimeNanos: live.monotonicTimeNanos,
  sleep: (duration) => live.sleep(duration),
})

const pinFromEnv = Effect.gen(function* () {
  const override = yield* Config.option(Config.Number("MYTOOL_NOW_MS"))
  const live = yield* Clock.Clock
  return override._tag === "Some" ? pinnedClock(live, override.value) : live
})

const program = Effect.gen(function* () {
  const clock = yield* pinFromEnv
  return yield* DateTime.now.pipe(Effect.provideService(Clock.Clock, clock))
})

const withEnv = (MYTOOL_NOW_MS: string) =>
  program.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ MYTOOL_NOW_MS }))))

console.log(DateTime.formatIso(await Effect.runPromise(withEnv("1700000000000"))))
console.log((await Effect.runPromiseExit(withEnv("not-a-number")))._tag)
~~~

Prints `2023-11-14T22:13:20.000Z`, then `Failure`. `Config.Number` validates
through `Schema.Number`, so a malformed override fails typed — through the
same `ConfigError` channel `Config.option` already threads — instead of
`Number(override)`'s silent `NaN`, which `DateTime.now` would have accepted
as a valid, un-catchable "Invalid Date". `DateTime.now` needs no change to
see the pin: it already reads `Clock.currentTimeMillis`, the one member this
recipe actually overrides.

Read the override once, in `main`, and provide the pinned `Clock` from
there rather than reading `MYTOOL_NOW_MS` wherever the time is needed — an
e2e test that spawns the built bin can then pin the clock through the
child's environment instead of racing the real one.

Why a recipe: the override variable's name and what "now" means to a given
tool are consumer choices; only the read-once-in-`main`, delegate-the-rest
discipline generalizes.
