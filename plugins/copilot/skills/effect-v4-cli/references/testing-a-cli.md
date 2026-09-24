# Testing a CLI

Loaded from `effect-v4-cli`. Covers the two false-green traps specific to testing a CLI.

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
