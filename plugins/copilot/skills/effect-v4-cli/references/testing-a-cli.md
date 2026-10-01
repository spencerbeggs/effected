# Testing a CLI

Loaded from `effect-v4-cli`. Covers the two false-green traps specific to testing a CLI, testing presentation in process with the `layerTest` doubles, driving core prompts with `TestTerminal`, driving Ink screens, whole wizards and live views with `CliUiTest` (including its traps and the snapshot serializer), and spawning a built bin with `CliTest`.

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

## Presentation in process: fix the environment, capture `Console`

Every presentation service has a double that needs nothing, and the environment is read through `Config`, so a test never touches `process`:

| Double | Fixes |
| --- | --- |
| `CliEnv.layerTest({ tty?, term?, audience?, columns?, color?, theme? })` | the whole environment in one layer: `TerminalEnv`, `Audience` and a `CliTheme` built from them, with `CliInteractive` set by the real rule. Quiet defaults (a pipe, a human, colour `none`), and the host's `TERM` never decides. No `Terminal`, no prompt gates, no `CliLinks` |
| `Audience.layerTest(kind, source?)` (`@effected/env`) | who the run is for |
| `TerminalEnv.layerTest({ stdinIsTerminal?, stdout?, stderr? })` (`@effected/env`) | terminal facts: `isTerminal`, `color`, `hyperlinks`, `columns` per stream |
| `CurrentRuntimeEnv.layerTest({ agent?, ci?, terminal? })` (`@effected/env`) | the detected agent, CI (`github-actions` turns on workflow-command neutralization) and terminal |
| `CliTheme.layerTest({ color?, stderrColor?, glyphs? })` | the theme at a fixed colour level |
| `CliInteractive.layerTest(value)` | whether the run may prompt |
| `CliLinks.layerTest(mode)` | where file links open |
| `Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({ ... }))` | any variable the real layers read: `FORCE_COLOR`, `NO_COLOR`, `TERM`, an audience override |

Then capture `Console.Console` and assert on **what** was written and **which stream** it went to — the stream is the half a content-only assertion misses:

~~~ts
import { assert, it } from "@effect/vitest"
import { CliEnv, CliMessage } from "@effected/cli"
import { Console, Effect } from "effect"

const TestEnv = CliEnv.layerTest({ audience: "human", color: "none" })

it.effect("a warning goes to stderr, colourless", () =>
  Effect.gen(function* () {
    const out: Array<string> = []
    const err: Array<string> = []
    const capture = {
      ...globalThis.console,
      log: (...args: ReadonlyArray<unknown>) => void out.push(args.join(" ")),
      error: (...args: ReadonlyArray<unknown>) => void err.push(args.join(" ")),
    } as unknown as Console.Console
    yield* CliMessage.warning("2 files skipped").pipe(Effect.provideService(Console.Console, capture))
    assert.deepStrictEqual(out, [])
    assert.include(err[0], "2 files skipped")
    assert.notInclude(err[0], "\u001b[")
  }).pipe(Effect.provide(TestEnv)),
)
~~~

`Doc.print` and `Render.context` also read `CliLinks`: add `CliLinks.layerTest("off")` beside `CliEnv.layerTest`. A renderer needs no Effect at all: `Render.plain(doc, Render.contextOf({ audience: "agent" }))` is a string, and an agent's context stays escape-free even through `Render.ansi`.

## Core prompts: `TestTerminal`

`@effected/cli/testing`'s `TestTerminal.make({ columns?, rows? })` is a `Terminal` a test drives: `type(text)`, `input([{ name: "enter" }])`, `end`, and the captured `output`, plus `pending` and `reads` (`{ keys, lines, subscriptions }`) to prove a non-interactive run never read the terminal. Core's own mock terminal is test-only and unexported; this is the public one.

~~~ts
import { assert, it } from "@effect/vitest"
import { TestTerminal } from "@effected/cli/testing"
import { MemoryFileSystem } from "@effected/memfs"
import { Effect, Layer, Path } from "effect"
import { Prompt } from "effect/cli"

it.effect("answers a core prompt", () =>
  Effect.gen(function* () {
    const terminal = yield* TestTerminal.make()
    yield* terminal.type("demo")
    yield* terminal.input([{ name: "enter" }])
    const answer = yield* Prompt.run(Prompt.String({ message: "Name" })).pipe(
      Effect.provide(Layer.mergeAll(terminal.layer, MemoryFileSystem.layer, Path.layer)),
    )
    assert.strictEqual(answer, "demo")
  }),
)
~~~

`Prompt.run` requires `FileSystem | Path` (for the file prompt) whichever prompt you run; `@effected/memfs` satisfies it without touching disk. To drive a whole command's fallback prompts, provide the terminal through `CliPrompt.gateTerminal.pipe(Layer.provide(terminal.layer))` beside the platform, with `CliInteractive.layerTest(true)` and an `Audience.layerTest("human")`.

## Ink screens and live views: `CliUiTest`

`@effected/cli/ui/testing`'s `CliUiTest` mounts on in-memory streams under a marker-palette theme (`columns`, `rows`, `color`, `glyphs`, `interactive` options):

| `CliUiTest` | Use |
| --- | --- |
| `render(screen, options?)` | one screen: a handle with `press`, `type`, `chunk`, `resize`, `frame`/`rawFrame`/`plainFrame`/`frames`, `rerender` and `result` |
| `view(element, options?)` | a display-only element (no `result`): a crash surfaces on the next read instead of a silent empty frame |
| `session(options?)` | a program that runs several screens (a wizard): provide its `layer`, fork the program, then `next({ contains? })` for each screen as it mounts; `stdout`/`stderr` are what the program wrote through `Console`, and `mounts === 0` is the "nothing mounted" assertion. Worked through below |
| `live(options)` | a live view on the **production** render path, with `publish(event)`, `end`, `advance(duration)`, `transcript` (what the terminal shows, scrollback included) and `written` (every raw byte, e.g. to assert no scrollback-wiping `ESC[3J`) |
| `cancelReason(exitOrCause)` | `Option<"escape" \| "interrupt">` from an `Exit` or `Cause`, so a test never walks the cause |
| `styled(ansi)`, `serializer` | ANSI decoded back to token markup, and a Vitest snapshot serializer printing it |

~~~ts
import { assert, it } from "@effect/vitest"
import { Select } from "@effected/cli/ui"
import { CliUiTest } from "@effected/cli/ui/testing"
import { Effect, Option } from "effect"

const template = Select.screen({
  message: "Template",
  choices: [
    { label: "Library", value: "lib" },
    { label: "CLI", value: "cli" },
  ],
})

it.effect("picks the second template", () =>
  Effect.gen(function* () {
    const handle = yield* CliUiTest.render(template)
    assert.include(yield* handle.plainFrame, "Template")
    yield* handle.press("down", "enter")
    assert.strictEqual(yield* handle.result, "cli")
  }),
)

it.effect("Esc cancels", () =>
  Effect.gen(function* () {
    const handle = yield* CliUiTest.render(template)
    yield* handle.press("escape")
    assert.deepStrictEqual(CliUiTest.cancelReason(yield* Effect.exit(handle.result)), Option.some("escape"))
  }),
)
~~~

- **`press` sends one key per stdin read; `chunk` sends them all in one read.** Ink hands every key of one read to the handler before React re-renders, so only `chunk` catches a handler reading stale render-closure state.
- **A live test is `it.effect`.** The run's tick runs on the `TestClock`, so `advance("160 millis")` moves it frame by frame; under `it.live` `advance` dies. A plain-Vitest consumer provides `TestClock.layer()` (from `effect/testing`) itself.
- **`frames` are best-effort; `transcript` and `written` are authoritative.** With `interactive: false`, the printed frame shows only there.
- **A crash is never swallowed**: a component that throws makes `result` (or the next read, key or resize) die with it.

Traps a first screen test trips over:

- **`press` takes a `KeyName` or `{ char }`, never a letter.** `press("y")` is a type error for a literal and, for a `string` variable, a defect (`"y" is not a key name; send text with type("y") or press({ char: "y" })`). Send a letter as `type("y")` or `press({ char: "y" }, "enter")`.
- **The harness waits on real time**, through native timers a `TestClock` cannot hold, so `render`, `session` and `next` work under `it.effect` and `it.live` alike. A screen test that itself sleeps, times out or retries on a schedule needs `it.live`: under `it.effect` those run on a `TestClock` that nothing advances while the screen waits on real time. Only `live`'s tick is on the `TestClock`.
- **One screen at a time, process-wide.** A `render` whose scope is still open holds the mount, so a second `render` in the same test waits forever. Give each screen its own `Effect.scoped`; closing the scope is what unmounts it.
- **A screen thunk that throws is a defect on the next read**, a classic-JSX `React is not defined` included: set `jsx: "react-jsx"` (see `prompts-and-screens.md`, "Setup").
- **Test colour at `truecolor`, the default.** Only truecolor keeps tokens apart: below it every marker colour collapses to one, so a snapshot taken at `"256"` or `"basic"` cannot tell `accent` from `muted`.

### Snapshotting frames: register the serializer

`CliUiTest.serializer` prints a frame as token markup (`[accent]→ a[/accent]`) with trailing spaces trimmed, so a snapshot reads without escapes and does not churn with the palette. Register it once for the project, in the vitest config, from a module whose default export is the serializer:

~~~ts
// serializer.ts
import { CliUiTest } from "@effected/cli/ui/testing"

export default CliUiTest.serializer
~~~

~~~ts
// vitest.config.ts
import { defineConfig } from "vitest/config"

export default defineConfig({ test: { snapshotSerializers: ["./serializer.ts"] } })
~~~

The equivalent in a setup file is `expect.addSnapshotSerializer(CliUiTest.serializer)`. A snapshot is the one assertion `assert` has no form of, so it goes through Vitest's `expect`:

~~~ts
const handle = yield* CliUiTest.render(template)
expect(yield* handle.rawFrame).toMatchInlineSnapshot(`
  [emphasis]Template[/emphasis]
  [accent]→ Library[/accent]
    CLI
  [muted]↑/↓ move · enter choose · q/esc cancel[/muted]
`)
~~~

Snapshot `rawFrame` (or `frame`, already decoded); the serializer claims a string carrying escapes or token tags and leaves any other string alone.

## A whole wizard: `CliUiTest.session`

`render` drives one screen. A handler that asks several questions in sequence is tested with `session`: provide its `layer` around the program, run the program **forked**, take each screen with `next` as it mounts, drive it, and join the fiber for the result. `next({ contains })` waits (at most 2 s) for the next screen to mount and show that text, so a test reads in the order the user sees it.

~~~ts
import { NodeServices } from "@effect/platform-node"
import { assert, it } from "@effect/vitest"
import { CliUi, Select, TextInput } from "@effected/cli/ui"
import { CliUiTest } from "@effected/cli/ui/testing"
import type { CliUiTestSession } from "@effected/cli/ui/testing"
import { Console, Effect, Fiber, Option } from "effect"
import { Command } from "effect/cli"

const init = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const template = yield* CliUi.prompt(
      Select.screen({
        message: "Template",
        choices: [
          { label: "Library", value: "lib" },
          { label: "CLI", value: "cli" },
        ],
      }),
      { otherwise: "lib" },
    )
    const name = yield* CliUi.prompt(TextInput.screen({ message: "Name", initial: "demo" }), { otherwise: "demo" })
    yield* Console.log(JSON.stringify({ template, name }))
  }),
)

const run = (session: CliUiTestSession) =>
  Command.runWith(init, { version: "1.0.0" })([]).pipe(
    Effect.provide(session.layer),
    Effect.provide(NodeServices.layer),
  )

it.effect("keys in, answers out", () =>
  Effect.gen(function* () {
    const session = yield* CliUiTest.session()
    const fiber = yield* Effect.forkScoped(run(session))
    const template = yield* session.next({ contains: "Template" })
    yield* template.press("down", "enter")
    const name = yield* session.next({ contains: "Name" })
    yield* name.type("-x")
    yield* name.press("enter")
    yield* Fiber.join(fiber)
    assert.strictEqual(yield* session.stdout, `${JSON.stringify({ template: "cli", name: "demo-x" })}\n`)
    assert.strictEqual(yield* session.mounts, 2)
  }).pipe(Effect.scoped),
)

it.effect("not interactive: the defaults, and nothing mounted", () =>
  Effect.gen(function* () {
    const session = yield* CliUiTest.session({ interactive: false })
    yield* run(session)
    assert.strictEqual(yield* session.stdout, `${JSON.stringify({ template: "lib", name: "demo" })}\n`)
    assert.strictEqual(yield* session.mounts, 0)
  }).pipe(Effect.scoped),
)

it.effect("Esc on the first screen cancels, and the second never mounts", () =>
  Effect.gen(function* () {
    const session = yield* CliUiTest.session()
    const fiber = yield* Effect.forkScoped(run(session))
    yield* (yield* session.next({ contains: "Template" })).press("escape")
    const exit = yield* Fiber.await(fiber)
    assert.deepStrictEqual(CliUiTest.cancelReason(exit), Option.some("escape"))
    assert.strictEqual(yield* session.mounts, 1)
  }).pipe(Effect.scoped),
)
~~~

- **`Effect.forkScoped` plus `Fiber.join`** is the whole pattern: `next` and `press` settle as they do on a rendered screen, and joining the fiber gives the program's result (or fails with its failure; `Fiber.await` hands back the `Exit`, which `CliUiTest.cancelReason` reads).
- **`mounts` counts every screen that began mounting.** Assert it after the program finished: `0` proves a non-interactive run or a flag that skips a prompt mounted nothing, and `1` after an Esc proves the next screen never appeared.
- **`stdout` and `stderr`** are what the program wrote through `Console` (`log`, `info` and `debug` to stdout; `error`, `warn` and `trace` to stderr), one line per call.
- **Under `Command.runWith`, a cancel is the handler's typed `Cancelled`.** Through `CliRuntime.main` it becomes the one rendered line and exit `130`: provide the platform with `CliPrompt.gateTerminal.pipe(Layer.provide(terminal.layer))` beside `NodeServices.layer` (a `TestTerminal`'s layer), and map the exit with `Runtime.getErrorExitCode(Cause.squash(exit.cause))`.
- **A handler that records a code** under `Command.runWith` also needs a fresh `CliExit.layer` provided around it (`CliRuntime.main` provides its own).

**Under `CliRuntime.main` with `env`, `CliEnv` decides interactivity and the theme, not the session's options.** `main`'s environment is provided closer to the screens than the session's layer, so `session({ interactive: false })` does not stop a screen from mounting there: what decides is the `Stdio` terminal facts and the `ConfigProvider`. The session keeps only the streams, the frame capture and the console. To test the production wiring, give the platform a terminal (or a pipe) and an empty config:

~~~ts
import { CliRuntime } from "@effected/cli"
import { ConfigProvider, Layer, Stdio, Terminal } from "effect"

const platform = (tty: boolean) =>
  Layer.mergeAll(
    NodeServices.layer,
    Stdio.layerTest({ stdinIsTerminal: Effect.succeed(tty), stdoutIsTerminal: Effect.succeed(tty) }),
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
  )

const production = (session: CliUiTestSession, tty: boolean) =>
  CliRuntime.main(Command.runWith(init, { version: "1.0.0" })([]), { platform: platform(tty), env: {} }).pipe(
    Effect.provide(session.layer),
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
  )
~~~

`production(session, true)` mounts the screens even from `session({ interactive: false })`; `production(session, false)` mounts nothing (`mounts === 0`) even from a default, interactive session.

### Testing a command's live view

`CliUiTest.live` takes exactly `Omit<LiveOptions, "events">` plus the terminal options, so define the view as one exported value of that type, spread it into `CliUi.live({ ...verifyView, events })` in the handler, and pass the same value to the test. A test that rebuilds the options exercises a copy, which can drift from what ships:

~~~tsx
// verify-view.tsx
import type { LiveOptions } from "@effected/cli/ui"

export const verifyView: Omit<LiveOptions<Event, State>, "events"> = {
  initial: { done: 0, failed: 0 },
  reduce,
  render: (state) => <Summary state={state} />,
  isStart: (event) => event._tag === "Start",
  isTerminal: (event) => event._tag === "End",
}
~~~

~~~ts
it.effect("counts passed and failed", () =>
  Effect.gen(function* () {
    const view = yield* CliUiTest.live(verifyView)
    yield* view.publish({ _tag: "Start" })
    yield* view.publish({ _tag: "Done", ok: true })
    yield* view.publish({ _tag: "Done", ok: false })
    yield* view.publish({ _tag: "End" })
    yield* view.end
    assert.include(yield* view.transcript, "1/2 passed, 1 failed")
  }).pipe(Effect.scoped),
)
~~~

## Unit-test in process, spawn the built bin for the exit-code contract

A renderer or a handler is an ordinary Effect: unit-test it in process,
against a captured `Console`, the way anything else in the kit is tested. The
exit code and the exact bytes on each stream are a different claim — they are
a property of the **built artifact**, wired through the real platform layer —
and the only thing that proves it is spawning the bin that ships.

`@effected/cli/testing`'s `CliTest` does that hermetically. `CliTest.sandbox({
path })` mints a scoped temp directory with a fresh `HOME` and
`XDG_{CONFIG,DATA,STATE,CACHE}_HOME`, `NO_COLOR: "1"`, and the `path` you
pass — **nothing** from the host environment is inherited unless you pass it
in `path`. `CliTest.run(bin, args, { sandbox, execPath, cwd?, env?, stdin? })`
spawns `execPath` with `[bin, ...args]` and reads back `{ exitCode, stdout,
stderr }` as plain data: **a non-zero exit is a result, not a failure** — no
`try`/`catch`, no `Effect.catchTag` needed to read it. `execPath` always
comes from the test file itself (`process.execPath`), never a `PATH` lookup,
so the binary running the test and the binary running the child are
guaranteed to be the same. Omitted or empty `stdin` hands the child an
already-ended stream, so a stdin-reading bin exits instead of hanging on an
open pipe.

Three traps this replaces:

- A hand-rolled `child_process.execFileSync` that throws on a non-zero exit,
  forcing every "the CLI should reject this" test into a `try`/`catch`.
- A sandbox that leaks the host's `HOME` (or a `XDG_*` variable), so a test
  passes locally by reading the developer's real config and fails — or
  silently passes for the wrong reason — in CI.
- Resolving the child's `node` off `PATH`, which can silently run a different
  Node than the one running the test.

~~~ts
import * as NodeServices from "@effect/platform-node/NodeServices"
import { assert, describe, layer } from "@effect/vitest"
import { CliTest } from "@effected/cli/testing"
import { Effect, FileSystem, Path } from "effect"

describe("a spawned bin's exit code and streams are data", () => {
  layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    it.effect("captures a non-zero exit and both streams", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const sandbox = yield* CliTest.sandbox({ path: process.env.PATH ?? "" })
        const bin = path.join(sandbox.root, "bin.mjs")
        yield* fs.writeFileString(
          bin,
          'process.stdout.write("out"); process.stderr.write("err"); process.exit(3);',
        )
        const result = yield* CliTest.run(bin, [], { sandbox, execPath: process.execPath })
        assert.strictEqual(result.exitCode, 3)
        assert.strictEqual(result.stdout, "out")
        assert.strictEqual(result.stderr, "err")
      }).pipe(Effect.timeout("3 seconds")),
    )
  })
})
~~~
