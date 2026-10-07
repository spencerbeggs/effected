# Providing layers — memoization, `layerNoop`, memfs and faulting one method

Loaded from `effect-v4-testing`. The decision points behind `layer(...)`: what
it memoizes, when a per-test `Effect.provide` is the safer shape, how the
`layerNoop` stub answers unstubbed members, and how a `FileSystem` double is
chosen.

## `layer()` memoizes; plain `Effect.provide` does NOT. That asymmetry is the whole decision

The top-level `layer` builds its layer once per group through a `MemoMap` and an
`Effect.cached` build (`packages/vitest/src/internal/internal.ts:268,270,272`),
keeps the scope open for the group, and closes it in `afterAll`. A per-test
`.pipe(Effect.provide(L))` carries no memo map and rebuilds per test.

**But that is per-TEST, not per-provide: NESTED provides memoize constituent
consts.** Within one running effect, `Effect.provide` memoizes layers by
reference — an inner `Effect.provide(Layer.mergeAll(SharedConst, Variant))`
under an outer provide that already built `SharedConst` serves the **outer**
build of it, even though the `mergeAll` composition is a fresh reference
(nested builds once and the inner read sees the outer
instance; two sequential sibling `runPromise` roots build twice). The bite: a
test helper that provides real layers, wrapping a test that inner-provides a
fault-injected or scripted variant feeding those same constituent consts,
silently exercises the REAL services — the swap never takes effect for
anything already built outside. The tell is a green test with the wrong
duration (a retry policy actually running, a scripted response never
consumed). Restructure so the variant is provided at the outermost level, or
compose the fault into the layer before anything builds it.

**So per-test provide is the SAFE default, and collapsing a suite onto a
suite-boundary `layer()` is the RISKY move** — not the neutral one. Read
build-once as "every stateful resource in that layer is cumulative across the
group": `TestClock.adjust` advances a clock the *next* test inherits, an
in-memory store keeps its rows and subscribers, a TTL that expired in test 3 is
still expired in test 4, and `TestConsole.logLines` keeps accumulating.

The pre-flight before collapsing, in order:

1. **In-memory or on-disk state?** On-disk is safe — filesystem `beforeEach`
   hooks still run. In-memory (a `Ref`, a cache, a counter, a `calls` recorder)
   is not: three tests asserting a stub call count once read **4, 5 and 6
   instead of 1**, green throughout.
2. **Is the layer constant?** Necessary, not sufficient.
3. **Is the service stateful, with that state's lifetime under test?** A shared
   instance then dissolves the boundary under test while staying green. Grep
   candidates: `refresh()`, cache, memoization, "second call returns cached".
4. **Is the layer genuinely stateless** (`Logger.layer([])`)? Then memoization
   is unobservable and collapsing is free.
5. **Does the test drive the clock?** A clock-driving test must NOT live inside
   a `layer()` block — the group shares one `TestClock`.

Worked failures → [migrating-a-repo.md](./migrating-a-repo.md).
Where state must vary per test, keep the per-test provide, or use **distinct
keys per test** and flush explicitly before asserting counts.

Other `layer(...)` mechanics (surface checked against
`packages/vitest/src/index.ts:139-154` and `:288-299`):

- The block hands you an `it` scoped to `R` (a `MethodsNonLive<R>`), and
  **`MethodsNonLive` has no `.live`** — a wall-clock test that also needs the
  group's layer goes **outside** the block as a top-level `it.live(...)` with
  `.pipe(Effect.provide(TheLayer))`.
- Nest extra deps with `it.layer(BarLayer)("nested", (it) => { … })` — the
  nested form takes **`concurrent` and `timeout` only** (no `memoMap`, no
  `excludeTestServices`), forks the parent's memo map and inherits the parent's
  `excludeTestServices` setting (`internal.ts:303-304`).
- `layer(L, { excludeTestServices: true })` runs the group **without** the
  `TestClock`/`TestConsole` overrides — the block-wide alternative when every
  test in the group needs the real clock, rather than pulling one wall-clock
  test outside as its own top-level `it.live`; see
  [false-greens.md](./false-greens.md) for a worked,
  runnable pair.
- A mock service is a `Context.Service` with a test `Layer`, swapped
  `Live` → `Test` at this boundary, never inside test bodies.

**`layerNoop`'s unstubbed members answer in THREE different ways, and each way
is a different bug.** Two half-truths circulate about this and both are wrong:
"every unstubbed member fails typed `NotFound`" and "every unstubbed member
dies". `makeNoop` (`FileSystem.ts:642`) splits them:

| members | unstubbed behavior | the trap |
| --- | --- | --- |
| `readFile`, `readFileString`, `readDirectory`, `stat`, `access`, `open`, `realPath`, `readLink`, `copy*`, `link`, `symlink`, `rename`, `truncate`, `utimes`, `glob`, `write*`, `sink`, `stream`, `watch` | typed `NotFound` failure (`FileSystem.ts:580`) | a package reading `NotFound` as domain-level "absent" treats it as a legitimate answer, so the stub silently supplies **empty fixtures** |
| `exists` → `false`, `remove` → `Effect.void` | **silent success** (`:663`, `:702`) | not a failure at all — a delete that never happened reports done |
| `makeDirectory`, `makeTempDirectory{,Scoped}`, `makeTempFile{,Scoped}` | `Effect.die("not implemented")` (`:669`–`:682`) | a **defect**: `Effect.catch` and every typed handler are blind to it |

The consequence the third row buys you: production code that defensively
absorbs a filesystem failure —
`fs.makeDirectory(d).pipe(Effect.catch(() => Effect.void))` — **cannot** absorb
it, so the first pipeline step that creates a directory kills every unrelated
test in the suite at once, and 20 simultaneous failures read as "I broke the
layer wiring", not "one new step calls `makeDirectory`". Reading the *first*
row's members and generalising is how that gets mis-diagnosed: `readDirectory`
is absorbable, `makeDirectory` is not.

**None of this is a reason to stub `layerNoop` better — it is the argument for
`@effected/memfs`.** This repo's standing rule (root `CLAUDE.md`): a test
needing `FileSystem` provides `@effected/memfs`, never a hand-rolled
`layerNoop` double, because `layerNoop` is deny-by-default and a stub encodes
only what its author remembered. `MemoryFileSystem` implements all three rows
honestly — a directory really is created, a removal really removes — so
misbehaviour is injected as a **fault handler**, not as a stub body. The rule
has no carve-out: a `FileSystem` double is `@effected/memfs`, never
`FileSystem.layerNoop`. Same tier:
**`readFileString` strips a leading BOM** (`FileSystem.ts:513` decodes
`impl.readFile` through `TextDecoder` at `:516`, default `ignoreBOM: false`)
→ [false-greens.md](./false-greens.md).

**A `FileSystem` double is `@effected/memfs` — never a `layerNoop` stub, and
never a hand-rolled `node:fs` port stub.**
`MemoryFileSystem.layerWith(seed)` — seed: absolute POSIX path → `string` |
`Uint8Array` | tagged `file`/`directory`/`symlink`, parents auto-created —
provides a real in-memory `FileSystem` whose unseeded reads fail typed
`NotFound`, where a hand stub answering unarranged reads with `""` produces
exactly the silent false green above (a phantom file parsing as empty; that
stub shipped a real dropped-changeset bug, which is why the package exists).
Bind each layer to a `const`.

**Every `Effect.provide` of a memfs layer re-seeds a fresh volume** — even the
same bound `const` — so a `MemoryFileSystem.Volume` read under a second provide
inspects a volume nobody wrote to, and "nothing was written" passes vacuously.
Assert inside the one provide, or build a handle (`MemoryFileSystem.makeHandle`
/ `makeSync`) and provide its pinned `handle.layer`. Pick the form by where the
assertion runs, seed with a `root`, fault the service or an injected port,
build a case-insensitive volume, and the rest of the traps (literal view vs
link-following ports, `..` after links, mtime units) →
**[memfs.md](./memfs.md)**.

A suite-boundary layer cannot vary per test, so several filesystem fixtures need
**one `layer(...)` block per fixture** — the house shape in
`packages/walker/__test__/`.

**Every stub effect goes through `Effect.suspend`.** A recorder that pushes
eagerly logs calls that never executed — `layerNoop({ readFileString: (p) => {
calls.push(p); … } })` records a read that was only *described*. Worked probe →
[false-greens.md](./false-greens.md).

## Faulting ONE method of a real layer

For "behaves like the real service except this one method fails on demand",
`layerNoop` is the wrong tool (it stubs everything) and there is still no
`FileSystem.layerWith` / `Layer.mapService` in the vendored source (no `export const mapService` in `Layer.ts`). The house recipe is
`Layer.effect` + spread the base + `Layer.provide(base)` — with
`Layer.updateService` (`Layer.ts:2109`) as the shorter form when the subject is
itself a layer, and `Layer.mock` (`Layer.ts:2354`) for partial stubs that die
loudly. Full scaffold and the three ways to get the spread wrong →
**[fault-injection.md](./fault-injection.md)**.
