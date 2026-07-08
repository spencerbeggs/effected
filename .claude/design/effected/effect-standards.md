---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-08
last-synced: 2026-07-08
completeness: 92
related:
  - architecture.md
  - package-inventory.md
  - migration-playbook.md
  - package-setup.md
  - plugin.md
---

# Effect library design standards

## Overview

Design standards every `@effected/*` library must follow. These are enforced at design time — each package's design doc (written per [migration-playbook.md](migration-playbook.md)) states its target API and tier against these rules before porting begins. The schema, layer, error-handling, observability and testing standards derive from the Effect team's guides (see [References](#references)).

## DX north star

The developer-experience exemplar is semver-effect (`/Users/spencer/workspaces/spencerbeggs/semver-effect`) for its class-based API: static and instance methods on domain classes, no floating functions. In Effect v4 the domain model class and the schema are the same artifact (`Schema.Class`), so the class-based DX is the ecosystem norm, not a house deviation. However, semver-effect's kind-based folder layout (`errors/`, `schemas/`, `services/`, `layers/`, `utils/`) is explicitly superseded by the module-per-concept layout below.

## Module layout (module-per-concept)

Replaces kind-based folders. Structure per package:

- `src/index.ts` — public surface, re-exports only (see [No barrel re-exports](#no-barrel-re-exports)).
- `src/<Concept>.ts` — one PascalCase file per public concept (e.g. `SemVer.ts`, `Range.ts`, `VersionCache.ts`). Each file owns: its `Schema.Class` domain model(s) with static/instance methods, the errors that concept raises (`Schema.TaggedErrorClass`) and — if the concept is a service — the `Context.Service` class plus its layer(s).
- `src/internal/` — private implementation helpers (Effect core convention); never exported from `index.ts`.

Rationale: file names ARE the API names, eliminating verbose disambiguation suffixes — no more `SemVerParserLive.ts`, no one-class `InvalidVersionError.ts` files, no `utils/` floating-function files (those become statics/methods on the schema classes). This follows "define errors near their domain or module boundary" (error-handling guide) and "service identifier and shape live in one place" (layers guide).

### No barrel re-exports

Only entrypoint files — `src/index.ts` and any published subpath entrypoints — may re-export. Every other module imports the values and types it uses explicitly from their defining module: no intermediate barrel files, no blanket `export * from` facades and no re-exporting a dependency's surface. This was a repeated footgun in the source repos (concrete evidence in the reviews in `.claude/reviews/`): xdg-effect's blanket re-export facade of json-schema-effect created a phantom dependency used by nothing in `src/`, and index.ts-based static wiring in semver-effect and workspaces-effect coupled module load order to the entrypoint, forcing `sideEffects` declarations and deep imports.

## Two-tier library taxonomy

- **Pure** libraries peer-depend on `effect` only: schemas, data types, domain logic. No IO.
- **Boundary** libraries perform IO at package boundaries. They program against platform abstractions — in v4 these largely live in `effect` core (the v4 catalog carries `@effect/platform-node` but no plain `@effect/platform`) — and the consumer provides the platform implementation (platform-node/bun) at the edge.

Tier assignments per package are provisional until confirmed at migration time; see [package-inventory.md](package-inventory.md).

## Schema standards

- Named domain models are `Schema.Class` / `Schema.TaggedClass`; the schema IS the class with methods. `Schema.Struct` only for small anonymous local shapes.
- Construct with `X.make(...)`, never `new X(...)`.
- Never define parallel schemas for one logical entity when only encoding differs — use field-level transformations (`Schema.decodeTo`/`encodeTo`), or derive variants with `pick`/`omit`/`partial`/`mutable`. Duplication only for genuinely different models (creation payload vs persisted entity, public API vs internal domain).
- `Schema.optionalKey` for omissible object fields (`optional` produces `T | undefined`).
- `Schema.brand` for validated scalar identifiers; `Schema.Opaque` for schema-backed nominal types.
- Intrinsic constraints attach in-schema via `.check(...)` (`isMinLength`, `isPattern`, `isUUID`, ...); business-rule validation that depends on service state stays outside the schema.
- String-codec field models must be canonical — exactly one type-level value per encoded string — or decode/encode round-trips fail; and `isPattern` regexes must avoid lookahead if `toArbitrary` derivation is wanted (fast-check's `stringMatching` cannot synthesize lookahead).
- `Schema.suspend` for recursive schemas.
- In Effect code prefer `Schema.decodeUnknownEffect` / `encodeUnknownEffect`; `Sync` variants only at explicit sync boundaries.
- Use `.annotate(...)` metadata; derived tooling (`toJsonSchemaDocument`, `toArbitrary`, `toEquivalence`) is how docs/tests derive from the single schema source of truth.

## Services and layers standards

- Services are classes extending `Context.Service` — identifier and shape in one place, `yield* ServiceName` works naturally. Interfaces small and focused.
- Layers exported alongside their service in the same module file. `Layer.succeed` for pure prebuilt implementations; `Layer.effect` for effectful/scoped construction; never hide effectful init inside `Layer.succeed`.
- Compose subsystem wiring locally, application wiring at the edge: `Layer.mergeAll` (side by side), `Layer.provide` (plug in deps, expose target), `Layer.provideMerge` (expose both).
- Provide layers at boundaries only (app entry, subsystem entry, test boundary) — business logic requires services, never calls `Effect.provide` locally.
- Layers are memoized BY REFERENCE: bind layers to constants; avoid layer-producing functions unless genuinely parameterized.
- No redundant accessor wrapper functions per service method.
- Libraries in this repo export services + layers; consumers (apps) compose them and provide platform implementations at the edge.

## Error handling standards

- Preference order: `Schema.TaggedErrorClass` (default — schema-backed, `_tag` routing, serializable, yieldable) → `Schema.ErrorClass` (schema-backed, no tag matching; infrastructure errors) → `Data.TaggedError` (fallback for truly local in-memory-only failures with non-serializable payloads).
- Errors are defined in the module file of the concept that raises them (see [Module layout](#module-layout-module-per-concept)), not in a central `errors/` directory.
- Three failure modes stay distinct: Failure (typed `E` channel — expected, recoverable), Defect (`Cause.Die` — invariant violations, programmer error), Interrupt (cooperative cancellation). Never model expected business failures as defects; `orDie` only when failure is validated unrecoverable; never `orDie` to silence type errors.
- Wrap foreign (third-party/runtime) errors in a typed schema-backed error with a `cause: Schema.Defect` (or `Schema.DefectWithStack`) field; never leak raw `Error` as public contract.
- Normalize `SchemaError` to domain errors at the boundary via `Effect.catchTag("SchemaError", ...)`; never leak `SchemaError` deep into application logic.
- Recovery operators: `catchTag`/`catchTags` for tagged recovery, `catchIf` for predicates, `match` to fold, `sandbox`/`catchCause`/`matchCause` to distinguish failure vs defect vs interrupt, `onInterrupt` for cleanup.
- Keep `_tag` names stable and descriptive; never collapse errors to `string`/`unknown` early.

## Observability standards

- Business/library operations are defined with `Effect.fn("operationName")(function*(){...})` — named spans, stack frames, tracing structure by default. Anonymous `Effect.gen` everywhere loses tracing structure. Meaningful names (`loadUser`, `parseRange`), never `helper`/`run`/`process`.
- `Effect.withSpan` for nested sub-operations inside a larger operation; `Effect.annotateCurrentSpan({ domainId })` for stable identifiers — no large payloads or secrets.
- Log with `Effect.log`/`logInfo`/`logDebug`/`logWarning`/`logError` at operation boundaries with structured values, not interpolated strings; not in every helper.
- `Effect.fnUntraced` only with measured overhead justification (rare, low-level).
- Division of responsibility: LIBRARIES (this repo) instrument with `Effect.fn`/`withSpan`/log/metrics and stay telemetry-agnostic; APPLICATIONS compose `@effect/opentelemetry` layers (`NodeSdk.layer` etc.) once at the top level. `@effected` libraries never construct or configure OTel SDK objects.
- Metrics at meaningful boundaries (requests, jobs, retries, external calls), not per-helper.

## Input-hardening standards

Parsers and any recursive walk over untrusted input must fail through the typed `E` channel, never as a `Cause.Die` defect. Deeply-nested hostile input that overflows the call stack is a denial-of-service vector, and `RangeError: Maximum call stack size exceeded` is an unhandled defect that violates the invariant "malformed input fails typed" — this is the Failure-vs-Defect boundary of the [error-handling standards](#error-handling-standards) applied to input. Cap collection-nesting depth at a shared `MAX_NESTING_DEPTH = 256` (the cross-package parity constant, proven in `@effected/yaml` and `@effected/jsonc`) and surface the overflow as that surface's typed failure mode — a domain parse-error code (`NestingDepthExceeded`), an in-band visitor error event or a bounded placeholder.

Apply the guard at **every independent recursive surface**, not just the main parse entry — enumerate them during the port, because the topology differs per engine. yaml has a two-stage CST-parser/composer shape (two caps, the CST cap set above the composer's so the composer's user-facing diagnostic fires first); jsonc spreads recursion across five independent surfaces (parser value+tree modes, the AST value-extractor, the semantic-equality walker, the SAX visitor and the navigator), each needing its own guard. Hold the cap in a shared zero-dependency leaf `internal/limits.ts` so every surface imports one constant without an import cycle.

**Recursive surfaces on the output/serialization side count too, and depth is not the only DoS vector.** The `chore/realignment` yaml pass proved both: (1) `stringify` recursion — the plain-value emitter and the AST-node emitter — overflowed the stack on deep acyclic input exactly like the parser did, so both were capped at `MAX_NESTING_DEPTH` and surface a typed `NestingDepthExceeded` (an internal depth-exceeded throw caught at the facade and materialized into the surface's typed error); (2) an **alias/reference-expansion "billion laughs" bomb** stayed under a per-node count guard yet exhausted the heap during value materialization — an amplification vector orthogonal to nesting depth, bounded by a **materialized-node budget** derived from the count limit and failing typed (`AliasCountExceeded`) rather than dying as an OOM defect. When an engine expands references (aliases, includes, `$ref`) during materialization, budget the materialization, not just the input's static depth.

## Testing standards

- `@effect/vitest`: `it.effect` is the default test mode (provides `TestClock`, `TestConsole`); `it.live` only when real `Clock`/runtime behavior is required. Never plain `it()` + `Effect.runPromise` for routine Effect code.
- Shared setup via top-level `layer(ServiceLayer)((it) => {...})` — built once, memoized, scoped to the group; `it.layer(...)` for nested isolation. Anti-pattern: repeating `Effect.provide(Layer)` inside each test body — provisioning belongs at the boundary.
- `TestClock.adjust` for time control with forked fibers.
- Property-based tests: `it.effect.prop` with FastCheck arbitraries; Schema inputs via `Schema.toArbitrary` (top-level `it.prop` does NOT support Schema inputs).
- `assert.*` for uniform explicit checks; `flakyTest` only for genuinely flaky integration conditions.
- Tests live in `__test__/` per repo convention (unit `*.test.ts`, `e2e/`, `integration/`).

## Peer-dependency discipline

Hard-won lesson from savvy-web/systems#228 and spencerbeggs/vitest-agent#127: every package must declare its complete peer closure. A declared `@effect/*` dependency whose own non-optional peers are left undeclared is a defect — unfulfilled transitive peers escape to the consumer's importer, where pnpm `autoInstallPeers` can bind an incompatible effect version (e.g. a v4 beta into v3 packages).

- Libraries keep `effect` as a peer dependency.
- Tools and apps consuming libraries declare the full stack as regular dependencies.

### Verified workspace configuration

The consumer-side configuration that keeps the effect v4 beta from poisoning the v3 build toolchain. The live settings are in `pnpm-workspace.yaml` and the root `package.json`; this records why each exists and how a package plugs in (see [package-setup.md](package-setup.md) for the per-package file manifest).

1. Every published tool in the dependency chain declares its complete `@effect/*` peer closure as regular dependencies. Fixed in `@savvy-web/tsdown-plugins@1.1.6`, `@savvy-web/bundler@1.1.7`, `@savvy-web/silk@2.1.2`, `@savvy-web/cli@1.5.2`, `@savvy-web/mcp@1.6.7`, `rolldown-pnpm-config@0.2.1` and the July 2026 `@vitest-agent/*` releases. Outstanding: rspress-plugin-api-extractor ([spencerbeggs/rspress-plugin-api-extractor#69](https://github.com/spencerbeggs/rspress-plugin-api-extractor/issues/69)).
2. `pnpm-workspace.yaml` sets `autoInstallPeers: true`. The tool peers of `@savvy-web/silk` (biome, changesets, commitlint, husky, lint-staged, markdownlint, turbo, typescript, etc.) and `@vitest-agent/plugin` (vitest, coverage providers, cli, mcp) are auto-installed rather than declared explicitly.
3. Each package uses `@effect/tsgo: catalog:effect` for the `tsgo` typechecker instead of `@typescript/native-preview: catalog:silk`. This is the change that keeps the v4 beta from poisoning the v3 toolchain under `autoInstallPeers: true` — the typechecker rides the `effect` (v4) catalog rather than the `silk` (v3-tooling) catalog, so auto-installed `effect` peers in the tooling chain no longer resolve the workspace-preferred v4 into v3-wanting importers.
4. `pnpm-workspace.yaml` keeps `dedupePeerDependents: false` — with dedupe on, pnpm unifies peer subgraphs across importers, bleeding v4 into other importers' v3 chains (nondeterministically across installs).
5. The root `package.json` `devDependencies` collapsed to just `@savvy-web/bundler`, `@savvy-web/silk` and `@vitest-agent/plugin`; everything else that item 2 used to enumerate is now an auto-installed peer. `@savvy-web/bundler` stays in root `devDependencies` only — packages resolve it via Node's upward walk.

IMPORTANT: this configuration leans on current pnpm resolver behavior and is explicitly TEMPORARY. The permanent fix is a pnpm patch submitted upstream as [pnpm/pnpm#12847](https://github.com/pnpm/pnpm/pull/12847); until it lands, `pnpm peers check` still reports residual unmet `effect` peer warnings from transitive v3-wanting deps (e.g. `@effect/platform-node`, `@effect/sql-sqlite-node`). Those residual warnings are expected under this interim setup, not closure defects to chase — but a genuinely new peer warning outside that known set is still a closure defect to fix upstream.

## Cross-@effected dependencies

Internal dependencies between `@effected` packages use `workspace:*`. Whether an edge is a peer or regular dependency is decided per edge at design time.

## Toolchain constraints

### API Extractor × Effect class factories

Effect class factories (`Schema.Class`, `Schema.TaggedClass`, `Schema.TaggedErrorClass`, `Schema.Opaque`, `Context.Service`) produce an anonymous heritage type that API Extractor reports as `ae-forgotten-export` on the synthesized `X_base` symbol (CI-fatal under the silk bundler). House policy, **revised 2026-07-08** (superseding the ratified-2026-07-07 `@public X_base` idiom): write the class factory **inline** (`export class X extends Schema.Class<X>("X")({...}) {}` — no split-out base const, no hand-written annotation) and suppress the synthesized-base warning narrowly in the package's `savvy.build.ts` via `meta.tsdoc.suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }]`. The emitted `.d.ts` names the base as a module-local, non-exported `declare const X_base` whose full shape is inlined into the exported class, so it is genuinely un-nameable and un-needed by consumers; the suppression is narrow, still logged (it lands in the `issues.json` `suppressed` bucket, not silenced), and hides nothing a consumer needs. Validated 2026-07-08 across `Schema.Opaque`, `asClass`, recursive `Schema.Class`+`suspend` (no TS2506, none of the old `Schema.Schema<Self>` annotation gymnastics) and `Context.Service`, and named field-schema consts inline into the base too — so the former mandatory-annotation, re-export-every-base and field-const-`@public` rules all retire. The suppression is scoped to `_base` ONLY: an internal type named on a `@public` method/return signature is a different symbol that still forgotten-exports and must be inlined structurally or made `@public` (it is genuine surface, so it stays un-masked). This supersedes both the `@internal`-tagged idiom (residual `ae-incompatible-release-tags`) and the `@public X_base` idiom (extra public surface, distinguished at the time from v3's banned `*ErrorBase` ceremony only by doc comments). **Realized across every package (`chore/realignment`, 2026-07-08):** all five migrated packages (semver, jsonc, yaml, package-json, npm) were converted from the transitional `@public X_base` form to the inline factory form, each wiring the narrow `_base` suppression into its `savvy.build.ts` — so the `@public X_base` backlog is fully cleared, every `*_base` symbol lands in the `issues.json` `suppressed` bucket, and this is now the single ratified API-Extractor policy with no residual transitional surface. Field-schema consts that are genuinely reusable public API (e.g. package-json's `DependencyMapField`/`BinField`) stay `@public` on their own merit; only the synthesized `*_base` heritage symbols were removed. Idiom, worked example and the `_base`-vs-method-signature boundary: `plugin/skills/effect-api-extractor-bases/SKILL.md`.

## References

Standards above derive from the Effect team's guides:

- [guide-schema.md](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/references/guide-schema.md)
- [guide-layers.md](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/references/guide-layers.md)
- [guide-error-handling.md](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/references/guide-error-handling.md)
- [guide-observability.md](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/references/guide-observability.md)
- [guide-testing.md](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/references/guide-testing.md)
