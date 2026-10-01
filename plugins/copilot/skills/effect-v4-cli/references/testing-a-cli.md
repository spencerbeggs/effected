# Testing a CLI

Loaded from `effect-v4-cli`. Covers the two false-green traps specific to testing a CLI, testing presentation in process with the `layerTest` doubles, driving core prompts with `TestTerminal`, driving Ink screens and live views with `CliUiTest`, and spawning a built bin with `CliTest`.

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
| `session(options?)` | a program that runs several screens: provide its `layer`, then `next({ contains? })` for each screen as it mounts; `mounts === 0` is the "nothing mounted" assertion. Its own TSDoc carries the recipe for driving a whole `Command` handler |
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
