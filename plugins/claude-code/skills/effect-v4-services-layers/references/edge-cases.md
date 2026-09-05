# Service and layer edge cases

Three narrow situations that are dead ends until you have seen them once. None
is day-to-day wiring; each costs a full session the first time.

## Split graphs: two resolved copies of one package are two services

Observed 2026-08-14 during the consumer-unblock release wave.

**At the type level** a `Context.Service` tag's identity is the class itself —
the module instance that declared it. When a dependency graph resolves TWO
copies of one `@effected` package — e.g. a consumer's caret range and a
sibling's newer 0.x minor resolving separately (on the 0.x line every minor is
major-like to semver, so `^0.12.0` and `0.13.0` do not unify) — each copy
declares its own tag. A layer built from one copy cannot satisfy a requirement
expressed by the other, even though the source text is byte-identical.

The failure mode is the trap: it surfaces as **"service not provided" in a
graph that visibly provides it** — never as a version error — so the reader
goes hunting a signature change that never happened. Check the resolution
first: `pnpm why @effected/<pkg>` (or `npm ls @effected/<pkg>`) listing the
package twice IS the diagnosis.

**At runtime, identity is the id string, not the class** — `Context` is a map
keyed by `key.key`, and `Context.Service` stores the id you passed verbatim
(`self.key = key`, `Context.ts:253`; lookups go through `lookup(self,
key.key)`, `Context.ts:915`). Two copies therefore carry the *same* runtime id
and do interoperate if a value ever crosses between them. That is why the split
graph is a compile-time failure and a duplicated bundle can be silently
benign — and it is what makes the bundle probe below work.

### Counting copies in a bundle: grep the tag id, never the class name

`pnpm why` answers what *resolves*; this answers what actually got *inlined*. A
duplicate that resolves does not necessarily reach `dist`, so both checks earn
their place.

Because the id is a string literal the runtime keys on, a minifier cannot mangle
or drop it, and it appears **exactly once per class declaration**. The class
name is an ordinary identifier that also matches method names, log strings and
re-exports. Measured over `@effected/workspaces`' emitted JS:

| service | bare class name | `@effected/workspaces/<Name>` |
| --- | --- | --- |
| `WorkspaceCatalogs` | 58 | **1** |
| `WorkspaceDiscovery` | 71 | **1** |
| `WorkspaceRoot` | 43 | **1** |

All three genuinely have one copy. Read naively the bare column reports three
duplicates that do not exist — and the danger is not the confusing number: a
bare count that happens to *agree* with the truth validates the wrong method,
which then outlives the measurement.

```bash
# One hit per copy. Two hits = two copies inlined.
grep -o "@effected/<pkg>/<Service>" dist/main.js | wc -l
```

**Pair it with a control, or it proves nothing** — a probe returning 1 for
everything is indistinguishable from a broken grep. Use a service you know is
single-copy (`@effected/npm/NpmRegistry`, `@effected/github/GitBranch`), and
confirm the probe can report 2 at all before believing a 1.

Mitigation:

- **Keep ranges converged across the graph** — one resolvable version of each
  `@effected` package per consumer tree.
- **When releasing a breaking 0.x minor, coordinate the dependents' range
  widening in the same wave**, so no window exists in which two copies
  resolve side by side.

## Sync facades: per-call service values, not layers

When a library exposes a synchronous escape hatch over consumer-supplied ops
(build-tool plugin hooks, config-time contexts), build service **values** and
provide them per call — do not reach for a Layer:

- `FileSystem.makeNoop({ exists, readFileString })` overrides only the ops the
  pipeline uses; every non-overridden member fails **typed `NotFound`** (core
  behavior, `FileSystem.ts:825` — still so at rc.109) — document that
  asymmetry if your hand-rolled counterparts throw defects instead.
- Core `Path` has **no `makeNoop`/`layerNoop` analog** (re-checked at rc.109:
  `Path.ts` exports `layer` at `:867` and nothing noop-shaped) — hand-roll a
  `Path.Path` value (`Path.Path.of` with `[Path.TypeId]`, `Path.ts:32`), back
  the members you use with the consumer's ops, and throw an informative defect
  from the rest.
- Wire with `Effect.provideService` per call. No Layer means no
  memoize-by-reference trap when consecutive calls carry different ops.
- Run with `Effect.runSyncExit` and unwrap the Exit honestly:
  `Cause.findErrorOption` → throw the typed error as itself;
  `Cause.findDefect` (returns a `Result`) → rethrow the defect. Never leak a
  fiber-failure wrapper to a sync caller.

Worked example: `@effected/tsconfig-json`'s `TsconfigLoaderSync` (probed
beta.98). The async pipeline stays the single implementation; the facade only
adapts ops and unwraps.

## Heterogeneous requirement unions: annotate the collection up front

When a wrapper collects several values that are generic in a requirements
union — an array of resolvers, a list of layers feeding one generic
parameter — TypeScript pins the type parameter from the **first** element and
rejects the later, wider elements instead of widening the union:

```ts
declare const takeChain: <RR>(rs: ReadonlyArray<ConfigResolver<RR>>) => RR;
takeChain([
  XdgConfig.resolver({ filename }),       // RR pinned: AppDirs | FileSystem | Path
  XdgConfig.nativeResolver({ ... }),      // ERROR — Xdg not assignable; the union never widens
]);

// Fix: state the full union where the collection is BUILT:
const chain: ReadonlyArray<ConfigResolver<AppDirs | Xdg | FileSystem.FileSystem | Path.Path>> = [ ... ];
takeChain(chain);                         // compiles
```

The annotation looks redundant — each element is individually assignable to
it — but deleting it re-breaks inference at the call site; leave a comment
saying so. Probed 2026-07-12 from inside `packages/app` against
`effect@4.0.0-beta.97` (control `Effect.catchAll` failed to compile; the bare
two-element chain failed on its second element; the annotated chain compiled
clean). Surfaced by `AppConfig.layer` wrapping `ConfigFile.layer` in the
`@effected/app` port.
