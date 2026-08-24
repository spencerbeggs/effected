# Service and layer edge cases

Three narrow situations that are dead ends until you have seen them once. None
is day-to-day wiring; each costs a full session the first time.

## Split graphs: two resolved copies of one package are two services

Observed 2026-08-14 during the consumer-unblock release wave.

A `Context.Service` tag's identity is the class itself — the module instance
that declared it. When a dependency graph resolves TWO copies of one
`@effected` package — e.g. a consumer's caret range and a sibling's newer 0.x
minor resolving separately (on the 0.x line every minor is major-like to
semver, so `^0.12.0` and `0.13.0` do not unify) — each copy declares its own
tag. A layer built from one copy cannot satisfy a requirement expressed by
the other, even though the source text is byte-identical.

The failure mode is the trap: it surfaces as **"service not provided" in a
graph that visibly provides it** — never as a version error — so the reader
goes hunting a signature change that never happened. Check the resolution
first: `pnpm why @effected/<pkg>` (or `npm ls @effected/<pkg>`) listing the
package twice IS the diagnosis.

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
