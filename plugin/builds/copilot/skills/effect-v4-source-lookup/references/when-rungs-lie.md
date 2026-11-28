# When a rung lies

Each rung of the ladder fails in a known direction. This reference holds the
documented cases: migration notes that are silent or wrong, `SCHEMA.md`'s
limits, the grep that false-negatives on built-in names, a worked example
where all three rungs disagree, and the claim classes no source tree can
settle.

## Rung 1 is prescriptive, not exhaustive

The migration notes document the *recommended path*, not the surface. They are
excellent for renames and silent about everything else:

- `migration/services.md` migrates `Context.Tag` → `Context.Service` and **never mentions `Context.Key`** — which is the primitive you need for a type-only key, and whose `out Shape` covariance means a `Context.Key` parameter will *not* give you the compile error you expect.
- `migration/forking.md` names `Effect.fork` → `Effect.forkChild`, and never mentions that `Effect.makeSemaphore` is gone and `Semaphore` is a top-level module (`Semaphore.make` / `makeUnsafe`, then `withPermits(1)(effect)`).
- `migration/cause.md` gives `Cause.isFailure` → `Cause.hasFails`, and never mentions `Exit.causeOption` → `Exit.getCause`, which returns `Option<Cause<E>>`.

So: **a removal is never settled by rung 1.** If the docs are silent on a
symbol, that is not evidence the symbol is fine. Go to rung 2.

The notes also make positive claims the tree contradicts. `migration/yieldable.md`
documents the `Yieldable` trait as `asEffect(): Effect<A, E, R>` and states the
runtime calls `.asEffect()` internally; **`asEffect` has zero occurrences in the
entire source tree**, so a design built on it fails at the first call.

## `SCHEMA.md` is a version-exact oracle that still loses to source

The vendored tree ships `packages/effect/SCHEMA.md` **at the pin** — thousands of
lines of upstream Schema documentation, versioned with the source rather than
floating like a website. That makes it far stronger than `migration/`: it
describes the surface you actually have, so it is an excellent **diff oracle**
for checking a claim quickly, and when it disagrees with a skill it is usually
the skill that is wrong.

It is still a document, and it does not outrank `src`. It has been wrong on
`Getter`/`Parser`, the `effect/data` import path, `Schema.brand<T>()`,
`UnknownFromJsonString`, `cause.failures`, `Array$`, `toJsonSchema` and
`ValidDate`. Reach for it early because it is cheap and version-exact, treat a
disagreement with it as a strong signal worth chasing, then settle the answer in
`packages/effect/src`. Call it rung 1.5: better than the migration notes, never a
substitute for reading the declaration.

## A bare existence-grep false-negatives on built-in names

Rung 2 is usually one grep: `grep -n 'export const Foo\|export function Foo'`.
That grep **lies about names that collide with a TS/JS built-in**, and it lies in
the dangerous direction — it reports *absent* for a symbol that exists, which
reads as "removed in v4" and sends you off to invent a replacement.

The mechanism is that a module cannot declare `const Array` beside its own uses
of the global `Array` type, so core defines the symbol under a private name and
renames it in an `export {}` block:

```text
// Schema.ts:4708 — the real definition, under a name you did not grep for
const ArraySchema: ArrayLambda = Struct_.lambda<ArrayLambda>((schema) => …)

// Schema.ts:4711 — the export, in a block your grep pattern never matches
export { /* …tsdoc… */ ArraySchema as Array }   // the rename lands at Schema.ts:4729
```

`Schema.Array` is real, and `grep 'export const Array' Schema.ts` returns
nothing. The confirmed occurrences of this pattern (vendored-tree lines) —
`Schema.ts:4729`, `Equivalence.ts:638`, `Order.ts:597` — are all
`Array`, but treat the *class* of names as suspect, not just that one:
`Array`, `Record`, `Map`, `Set`, `Error`, `Date`, `Number`, `String`, `Object`,
`Symbol`, `Function`, `Boolean`. (Some of them do grep normally —
`Schema.Record` is a plain `export function Record` at `Schema.ts:4044`, and
`Config.Array` a plain `export function Array` at `Config.ts:1181` — which
is exactly why the inconsistency catches people.)

**When a built-in-colliding name greps as absent, do not conclude it was
removed.** Settle it one of these ways instead:

- **Read the module's export list**, `export {}` blocks included — not just
  `export const` / `export function` lines.
- **Grep for the use site, not the declaration**: `grep -rn 'Schema\.Array('`
  across your workspace's `src` trees proves the call compiles today against the
  installed `effect`.
- **Ask the runtime**, from inside a package that depends on `effect@4`:
  `node --input-type=module -e "import * as S from 'effect/Schema'; console.log(typeof S.Array)"`.

The same caution applies to the aliased-import direction: code that writes
`import { Function as Fn } from "effect"` makes `grep 'Function.dual'` miss every
real call site, which all read `Fn.dual`.

## Worked example: the three rungs disagree

`Context.Key` (`Context.ts:69`):

- **Rung 1** — `migration/services.md` never mentions it. Reading harder produces nothing.
- **A runtime check** says it does not exist: `typeof Context.Key` is `undefined` and `"Key" in Context` is `false`, because it is type-only.
- **Rung 2** — `$SRC/packages/effect/src/Context.ts:69` settles it:

  ```text
  export interface Key<out Identifier, out Shape> extends Effect<Shape, never, Identifier>
  ```

  It exists, it is type-only, and `Shape` is **covariant** — so a `Context.Key` parameter accepts a wider shape than declared, and a design that expected a compile error there will not get one.

  `$EFFECT_SRC/Context.ts:69` is the same declaration, and — for this one
  anchor — the same line: `Context.ts` overall carries far more publish-time
  TSDoc in the installed copy than the vendored tag, but the extra lines land
  after this declaration, not before it. Do not generalize that coincidence:
  confirm any other anchor by symbol rather than assuming a line number
  survives the same way.

Three answers, one truth, and the cheap rungs are the ones that lie.

## Third-party `.d.ts` earns the same climb

The *reason* for the ladder — a confident summary of an API nobody read — has
nothing to do with which package it is. A dependency's shipped `.d.ts` (or
`src`, where it ships one) is a rung-2 source in exactly the same sense. A
plausible reading of octokit's docs recommends `RestEndpointMethodTypes` for
typing a REST surface; reading octokit's own types shows the already-typed
`request` surface is the right seam, and the recommendation would have bought a
large generated type map for nothing.

> **Rule: before designing against a third-party type surface, read the surface.**
> Reach for `node_modules/<pkg>/dist/**/*.d.ts` (or its `src`) the same way you
> reach for `$EFFECT_SRC`. "The docs say" is rung 1 for someone else's package
> too — prescriptive, not exhaustive, and silent about removals.

## The registry rung: published artifacts and installed consumers

Two claim classes need the registry and the installed artifacts, because no
tree you are standing in can answer them:

- **Closed upstream ≠ released.** An issue's or PR's closed state proves
  nothing about any published artifact. What actually shipped is settled by
  `npm view <pkg>@<version>` and by reading the INSTALLED `.d.ts`/`.js` under
  `node_modules` — never by the tracker's state.
- **A repo-local grep structurally cannot see downstream consumers.** Before
  calling an API change "breaking in-package only", read the installed
  artifacts of the known consumers — the `node_modules` of a consuming repo.
  That check catches a shape change that would land as a runtime defect in an
  installed consumer, where a repo-local grep confidently reports zero
  consumers.

## When two reads of one file disagree, settle it against the committed blob

A *reasoning* failure rather than a lookup one: you read a file early in a
session, read it again later, and the two reads do not match. The temptation is
to pick the read that supports the conclusion you have already drawn — and it is
always available, because one of them does.

Neither read is evidence. A working tree changes under you: another agent edits
it, an earlier step in your own session wrote to it, a formatter ran. **Settle it
against the committed blob** — `git show HEAD:path/to/file` — and then, if the
working tree differs, treat that as its own finding to explain rather than
noise to discard.

The rule generalizes past files: **when two observations of the same thing
disagree, the tie-break must be a third source, never the one that suits the
conclusion.** Picking is how a stale read gets laundered into a verified fact.
