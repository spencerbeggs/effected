# Service and layer edge cases

Two narrow situations that are dead ends until you have seen them once. Neither
is day-to-day wiring; both cost a full session the first time.

## Sync facades: per-call service values, not layers

When a library exposes a synchronous escape hatch over consumer-supplied ops
(build-tool plugin hooks, config-time contexts), build service **values** and
provide them per call — do not reach for a Layer:

- `FileSystem.makeNoop({ exists, readFileString })` overrides only the ops the
  pipeline uses; every non-overridden member fails **typed `NotFound`** (core
  behavior, `FileSystem.ts:825` — still so at beta.107) — document that
  asymmetry if your hand-rolled counterparts throw defects instead.
- Core `Path` has **no `makeNoop`/`layerNoop` analog** (re-checked at beta.107:
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
