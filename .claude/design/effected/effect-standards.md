---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-07-25
last-synced: 2026-07-25
completeness: 95
related:
  - architecture.md
  - package-inventory.md
  - migration-playbook.md
  - package-setup.md
  - releases.md
  - plugin.md
---

# Effect library design standards

## Overview

Design standards every `@effected/*` library must follow. These are enforced at design time — each package's design doc (written per [migration-playbook.md](migration-playbook.md)) states its target API and tier against these rules before porting begins. The schema, layer, error-handling, observability and testing standards derive from the Effect team's guides (see [References](#references)).

## DX north star

The developer-experience exemplar is [`@effected/semver`](../../../packages/semver) for its class-based API: static and instance methods on domain classes, no floating functions. In Effect v4 the domain model class and the schema are the same artifact (`Schema.Class`), so the class-based DX is the ecosystem norm, not a house deviation. The kind-based folder layout its v3 source used (`errors/`, `schemas/`, `services/`, `layers/`, `utils/`) is superseded by the module-per-concept layout below.

The second half of the same standard is the **sync-primitive policy**, which applies to every pure boundary in the kit and not only to format packages: a public boundary whose `Effect` wrapper carries nothing but a span exposes the sync `Result` form as the primitive (`X.parseResult`) and derives the `Effect` form from it. It is stated in full, with the naming ratification and the scope test, in [formatter-convention.md's decision 6](formatter-convention.md#decision-6--the-sync-primitive-policy) — pointed at from here because designers outside the format packages were not finding it there.

## Module layout (module-per-concept)

Replaces kind-based folders. Structure per package:

- `src/index.ts` — public surface, re-exports only (see [No barrel re-exports](#no-barrel-re-exports)).
- `src/<Concept>.ts` — one PascalCase file per public concept (e.g. `SemVer.ts`, `Range.ts`, `VersionCache.ts`). Each file owns: its `Schema.Class` domain model(s) with static/instance methods, the errors that concept raises (`Schema.TaggedErrorClass`) and — if the concept is a service — the `Context.Service` class plus its layer(s).
- `src/internal/` — private implementation helpers (Effect core convention); never exported from `index.ts`.

Rationale: file names ARE the API names, eliminating verbose disambiguation suffixes — no more `SemVerParserLive.ts`, no one-class `InvalidVersionError.ts` files, no `utils/` floating-function files (those become statics/methods on the schema classes). This follows "define errors near their domain or module boundary" (error-handling guide) and "service identifier and shape live in one place" (layers guide).

### No barrel re-exports

Only entrypoint files — `src/index.ts` and any published subpath entrypoints — may re-export. Every other module imports the values and types it uses explicitly from their defining module: no intermediate barrel files, no blanket `export * from` facades and no re-exporting a dependency's surface. This was a repeated footgun in the source repos (concrete evidence in the reviews in `.claude/reviews/`): xdg-effect's blanket re-export facade of json-schema-effect created a phantom dependency used by nothing in `src/`, and index.ts-based static wiring in semver-effect and workspaces-effect coupled module load order to the entrypoint, forcing `sideEffects` declarations and deep imports.

**A namespace object is a barrel in different syntax, and a worse one.** `export const Codecs = { json, jsonc, yaml, toml }` collects independent implementations behind one binding exactly as `export *` collects independent modules behind one module. It is worse because a bundler can see through a re-export barrel — the named exports stay individually reachable — but a namespace object is a **single live binding**: reference it at all and every member is reachable, so every member's whole module graph is retained. The failure is **silent**. No error, no warning, just a bundle carrying engines the consumer never named.

`@effected/config-file`'s [four codecs](package-inventory.md#the-four-codecs-live-in-config-file) are where this was found and where it is measured: with the codecs as free-standing named exports, a consumer importing only `JsonCodec` bundles a few hundred bytes; collected into a namespace object it would pull the JSONC, YAML and TOML engines too, into six figures of bytes. The rule that follows: **a set of alternative implementations that each reach a different dependency belongs in one module each, exported by name — never gathered into an object.**

Grouped statics are not banned outright — `MergeStrategy.firstMatch` / `.layeredMerge` and `ConfigResolver`'s six resolvers stay grouped, because they are variants of one concept, live in one module and reach nothing heavier than each other. The hazard is proportional to **what sits behind each member**: group siblings that share a module, never siblings that each drag in a distinct engine. When in doubt, split — the cost of a separate module is a line in `index.ts`, and the cost of getting it wrong is invisible until someone measures a bundle.

## Three-tier library taxonomy

The three tiers classify **libraries by dependency surface**: they answer the one question a consumer asks before taking an edge — *what does depending on this cost me?* Tier is a property of a package's own **runtime** surface — what it imports and whether it does IO. devDependencies never count toward tier: `@effect/vitest` and `@savvy-web/bundler` are test and build tooling, irrelevant to the classification.

- **Pure** — imports `effect` (as a peer) and `@effected/*` packages only. Performs no IO.
- **Boundary** — the same dependency surface as pure, but performs IO through `effect`-core platform abstractions (`FileSystem`, `Path`, `PlatformError`). The consumer provides the platform layer at the edge.
- **Integrated** — imports at least one runtime package outside `effect` **core**. Effect-org packages (`@effect/sql-sqlite-node`, `@effect/cli`, `@effect/platform-node`) count exactly the same as third-party ones (`spdx-expression-parse`, `@pnpm/catalogs.*`): the line is `effect` core versus everything else. It is drawn there because it is checkable from `package.json` alone, and because this repo's peer-closure pain (documented in the root CLAUDE.md) comes precisely from non-core `@effect/*` packages dragging v3-wanting closures into consumers.

Tier assignments per package are provisional until confirmed at migration time; see [package-inventory.md](package-inventory.md). Not every published package is a library, and the packages that are not carry **no tier at all** — see [Companion packages](#companion-packages-published-but-not-a-library).

### Companion packages: published, but not a library

A **companion** package is published and installable but is **not a library**: it exposes no API, there is nothing to import and nothing to call. It ships with the kit in the coordinated `0.1.0` release ([releases.md](releases.md#versioning)), and installing it is optional for the consumer.

**Companion is a category, not a fourth tier.** The three tiers above sit on one axis — dependency surface — and answer "what does depending on this cost you?". That question is *meaningless* for a package nothing can depend on, so a companion is not ranked against pure, boundary and integrated; it sits off the axis entirely. The three tiers continue to classify **libraries only**, and a companion has no tier rather than a fourth one.

`@effected/pnpm-plugin-effect` is the only companion today: it ships two pnpm catalogs and a pnpmfile — configuration, not code — and installing it pins a consumer's `effect` versions and peer floors to the values the kit was built and tested against. See [packages/pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md).

**Why `companion` and not `infrastructure`.** "Infrastructure" names the package's relationship to *this repo* and reads as internal-only tooling, which invites the inference that it is not a real shipped package — but it is one, a public package consumers install and rely on. `companion` names the relationship to the consumer instead — ships alongside the kit, optional, no API — and makes that wrong reading harder.

### Dependency policy

Four rules govern how tier and dependencies relate. The framing default is to stay as Effect-native as possible — a program built only from Effect primitives composes and typechecks as one thing — but that default is tier-scoped, not global.

**R1 — tiers 1 and 2 take no external runtime dependencies.** Pure and boundary packages peer-depend on `effect` and may take `@effected/*` edges (`workspace:~`, regardless of whether the edge is a peer or a regular dependency), nothing else. Moving a package to tier 3 (integrated) is a decision recorded in that package's design doc, never a default.

R1 **replaces** the old inference chain "parsing has no IO, so a format package is pure, so it may not take a runtime dependency." That chain is broken by the three-tier scheme: tier 3 is now defined by *dependencies alone*, so a package that does no IO can still legally be tier 3. `@effected/toml` and `@effected/glob` vendor their engines **because of R1**, not because they happen to lack IO. The supporting economics are unchanged: `smol-toml` is BSD-3-Clause and zero-dependency, and `@effected/jsonc` and `@effected/yaml` already vendor ported-with-attribution engines into `src/internal/` the same way — so vendoring *is* the wrapper, hardened per the input-hardening standards below. R1 is the reason; the low cost is why R1 rarely bites. The rule bites only where the third-party code is large, encumbered or itself dependency-laden, and in that case a tier-1/2 shape was wrong to begin with.

**R2 — tier 3 propagates.** Depending on a tier-3 `@effected` package makes you tier 3, whatever your own imports say, because that package's external code lands in your consumer's tree transitively.

**R3 — tier 2 does not propagate.** A boundary package's IO is discharged by the app's platform layer, provided once at the edge, so a consumer of a tier-2 package pays no external install for it. Live example: `@effected/config-file` (boundary) depends on `@effected/walker` (boundary) and stays boundary rather than being pushed up a tier. R3 is the justification the old doc lacked when it asserted that tier follows a package's own surface.

**R4 — tier follows a package's own surface** (plus R2 for propagation), never its consumers'. A package that wraps `parse`/`stringify` and never touches `FileSystem` is pure even when its only consumer is a boundary library — `@effected/lockfiles` is pure for exactly this reason: every entrypoint takes `content: string`, and the file reading lives in `@effected/workspaces`. Conversely a package is boundary the moment it performs IO itself, however thin.

R3 and R4 together are what keep `@effected/config-file` at boundary even though it absorbs the four codecs and peers on the pure `jsonc`, `yaml` and `toml` format packages ([package-inventory.md](package-inventory.md#the-four-codecs-live-in-config-file)): `@effected/*` edges do not propagate tier, only [R2](#dependency-policy) tier-3 does.

The scheme buys two things worth stating. First, it explains the runtimes CLI split ([packages/runtimes.md](packages/runtimes.md#tier-and-dependencies)): `@effect/platform-node` is tier 3, the resolver core is tier 2, and a tier-2 package's consumers should not have to pay a tier-3 install — so the split is what R1 requires, not an ad-hoc fix. Second, without the scheme `@effected/config-file` had to state in prose that it carries zero external runtime dependencies, because "boundary" alone could not distinguish it from `@effected/workspaces`; the tier label now carries that information directly.

## The consolidated core, and the require-in-R default

Effect v4 consolidated what were separate packages into core: functionality that lived in `@effect/platform`, `@effect/rpc`, `@effect/cluster` and others now lives directly inside `effect` — including the service **contracts** for platform concerns (`FileSystem`, `Path`, `Terminal`, `Stdio`, and `effect/unstable/process`'s `ChildProcess` + `ChildProcessSpawner`). The packages that remain separate are platform-specific, provider-specific, or technology-specific **implementations**: `@effect/platform-*` (e.g. platform-node's `NodeServices.layer` provides `ChildProcessSpawner | Crypto | FileSystem | Path | Stdio | Terminal` in one layer), `@effect/sql-*`, `@effect/ai-*`, `@effect/opentelemetry`, `@effect/atom-*`, `@effect/vitest`.

The consequence for this kit is a standing rule: **we are in the business of business logic — schemas for data, services for behaviour, layers that compose. We never re-implement platform specifics.** A library that needs a platform capability requires the core-declared service in its `R` channel and the application provides the platform layer once at the edge. This is free under [R3](#dependency-policy) — it is how `walker`, `xdg` and `config-file` consume `FileSystem` — and it is categorically different from taking `@effect/platform-*` as a dependency edge (which is what R2 taxes). Do not conflate the two.

Three operating rules fall out:

1. **Before designing any seam or contract, grep `.repos/effect` for the core contract first.** If core declares the service, require it in `R`; the seam already exists.
2. **A direct `node:` import in library code is a code smell, most of the time.** The sanctioned exceptions are documented Node-only overlays — a default layer or a sync escape hatch (`WorkspacesSync`) — never a contract or a business-logic path.
3. **Platform packages are legitimate devDependencies for integration tests** (the `workspaces` `self.int.test.ts` precedent) and legitimate dependencies only in applications and app-edge packages (the runtimes CLI split).

Learned the expensive way, over two attempts, and the lesson is **two separate failure modes: re-declaring a core concept, and implementing one.** Clearing the first does not clear the second. The first `@effected/commands` design invented a `Command`/`CommandRunner` vocabulary for what core already declares, and it survived several review gates because reviewers checked the code against the brief instead of the brief against core. The second imported core's vocabulary faithfully and deleted every invented type — it passed the re-declaration check outright — and was still removed, because it shipped a **backend** for a contract core already implements. A reviewer holding a single "don't reinvent core" rule would have approved it, which is why both modes are named here rather than compressed into one.

The general form, and the invariant `@effected/commands` ships under: **every subprocess concept is core's, and no implementation of one is.** `@effected/git` is the same invariant from the consuming end — it simply requires the core `ChildProcessSpawner` in `R`. See [roadmap.md's commands entry](roadmap.md#effectedcommands).

### The vendored source is the style oracle, not just the API authority

`.repos/effect` settles more than existence and signatures: **it is the paradigm reference.** The core source is written with unusual care — one concept per module with a `@since`-annotated public surface, contracts as `Context.Service` classes with a `make` that derives the rich surface from one primitive (`ChildProcessSpawner.make(spawn)`), branded scalars for domain numbers (`ExitCode`, `ProcessId`), `dual` data-first/data-last combinators, values that are themselves `Effect`s where yielding is the natural verb, and doc comments whose examples compile. When designing a kit module, read how core writes the *analogous* module and match its paradigms — naming, factoring, where options objects go, how errors are shaped. The more the kit's constructs read like core's, the cheaper every consumer's mental model gets, and the easier our pieces compose with the ecosystem's. Divergence is allowed but must be a recorded decision with a reason, not a habit.

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
- **A swappable contract gets no ambient default inside a composite layer** — the requirement surfaces in the consuming operation's `R` instead, and the composer provides it. That is the safe choice (a default baked into a composite reverts to policy nobody chose the moment merge order changes, silently) and the ergonomic one (consumers that never reach the operation never supply the policy). `@effected/workspaces`' `PublishabilityDetector` is the exemplar: the composites neither provide nor require a detector (their `R` is unchanged — nothing inside them consumes one), and the requirement surfaces only in the consuming operation's `R` (`VersioningStrategy.detect`), so a program names `PublishabilityDetector.layerNpm` or its own exactly where its `R` says so — and a program that never asks a publishability question never supplies a policy.
- **Every shipped implementation of a swappable contract is exported as a value as well as a layer.** A consumer composing *around* the default cannot use a layer at all without re-entering the tag it is replacing, so the implementation has to be callable directly — `PublishabilityDetector.npm` beside `PublishabilityDetector.layerNpm`.
- **A layer-family static belongs to the module owning the dependency it needs, not the module declaring the service.** This is the bundle-confinement corollary of [no barrel re-exports](#no-barrel-re-exports): a layer variant homed on the service's module makes that variant's dependency reachable from every importer of the service. Precedents: `GitHubApp.clientLayer` (the app-authenticated `GitHubClient` layer, homed with the JWT engine) and `Workspaces.localExecLayer` (implementing `@effected/commands`' `LocalExec`, homed with the discovery graph).
- **Resolve a dependency once at construction when it is stable; read it per call when varying it is the point.** The wrong choice is silent in both directions, and the per-call side is the one that bites: construction-time resolution left a scoped `Repo.provide` override compiling and doing nothing in the `github` port, caught by a test rather than by the compiler.

## Error handling standards

- Preference order: `Schema.TaggedErrorClass` (default — schema-backed, `_tag` routing, serializable, yieldable) → `Schema.ErrorClass` (schema-backed, no tag matching; infrastructure errors) → `Data.TaggedError` (fallback for truly local in-memory-only failures with non-serializable payloads).
- Errors are defined in the module file of the concept that raises them (see [Module layout](#module-layout-module-per-concept)), not in a central `errors/` directory.
- Three failure modes stay distinct: Failure (typed `E` channel — expected, recoverable), Defect (`Cause.Die` — invariant violations, programmer error), Interrupt (cooperative cancellation). Never model expected business failures as defects; `orDie` only when failure is validated unrecoverable; never `orDie` to silence type errors.
- Wrap foreign (third-party/runtime) errors in a typed schema-backed error with a `cause: Schema.Defect` (or `Schema.DefectWithStack`) field; never leak raw `Error` as public contract.
- Normalize `SchemaError` to domain errors at the boundary via `Effect.catchTag("SchemaError", ...)`; never leak `SchemaError` deep into application logic.
- Recovery operators: `catchTag`/`catchTags` for tagged recovery, `catchIf` for predicates, `match` to fold, `sandbox`/`catchCause`/`matchCause` to distinguish failure vs defect vs interrupt, `onInterrupt` for cleanup.
- Keep `_tag` names stable and descriptive; never collapse errors to `string`/`unknown` early.
- **Every declared error channel is demonstrated fireable by a test, or deleted from the signature.** A channel that cannot fire forces every caller to handle a case that does not exist, and makes the type lie in the one direction the compiler cannot check. Ported code is where they accumulate: three can't-fire channels turned up in one source package during the github-split port, each one a residue of something the port changed underneath it — a validated construction that made formatting total, and an owned emitter that removed the library whose failures the channel modelled.

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

**Recursive surfaces on the output/serialization side count too, and depth is not the only DoS vector.** Two failure modes in `@effected/yaml` make the point: (1) `stringify` recursion — the plain-value emitter and the AST-node emitter — overflows the stack on deep acyclic input exactly like the parser does, so both are capped at `MAX_NESTING_DEPTH` and surface a typed `NestingDepthExceeded` (an internal depth-exceeded throw caught at the facade and materialized into the surface's typed error); (2) an **alias/reference-expansion "billion laughs" bomb** stays under a per-node count guard yet exhausts the heap during value materialization — an amplification vector orthogonal to nesting depth, bounded by a **materialized-node budget** derived from the count limit and failing typed (`AliasCountExceeded`) rather than dying as an OOM defect. When an engine expands references (aliases, includes, `$ref`) during materialization, budget the materialization, not just the input's static depth.

## Testing standards

- `@effect/vitest`: `it.effect` is the default test mode (provides `TestClock`, `TestConsole`); `it.live` only when real `Clock`/runtime behavior is required. Never plain `it()` + `Effect.runPromise` for routine Effect code.
- Shared setup via top-level `layer(ServiceLayer)((it) => {...})` — built once, memoized, scoped to the group; `it.layer(...)` for nested isolation. Anti-pattern: repeating `Effect.provide(Layer)` inside each test body — provisioning belongs at the boundary.
- `TestClock.adjust` for time control with forked fibers.
- Property-based tests: `it.effect.prop` with FastCheck arbitraries; Schema inputs via `Schema.toArbitrary` (top-level `it.prop` does NOT support Schema inputs).
- `assert.*` for uniform explicit checks; `flakyTest` only for genuinely flaky integration conditions.
- Tests live in `__test__/` per repo convention (unit `*.test.ts`, `e2e/`, `integration/`).

### The oracle for a ported algorithm is external

When an implementation and a remembered constant disagree, **neither one is the oracle.** Climb to the published intermediates instead: AWS documents the canonical-request hash and the signing-key derivation for its SigV4 examples, so the port exports those internal steps and pins them against the published values. The remembered end-to-end signature turned out to belong to a different example, and pinning it would have shipped a signer whose only symptom was a rejection at the far end. Where the artifact has a published schema, the schema is the oracle — `@effected/sbom` validates its emitted CycloneDX 1.6 against the published JSON schema vendored as a test fixture, which is what makes owning the emitter instead of taking the library a defensible trade rather than a hopeful one.

**Never pin your own output as the fixture.** A snapshot of what the code currently emits asserts only that it has not changed, which is the one property that was never in doubt. This is the correctness counterpart of the fidelity rules in [formatter-convention.md](formatter-convention.md#decision-5--the-fidelity-obligation): those constrain what a round trip must preserve, this constrains what a fixture is allowed to be evidence of.

## Peer-dependency discipline

Hard-won lesson from savvy-web/systems#228 and spencerbeggs/vitest-agent#127: every package must declare its complete peer closure. A declared `@effect/*` dependency whose own non-optional peers are left undeclared is a defect — unfulfilled transitive peers escape to the consumer's importer, where pnpm `autoInstallPeers` can bind an incompatible effect version (e.g. a v4 beta into v3 packages).

- Libraries keep `effect` as a peer dependency.
- Tools and apps consuming libraries declare the full stack as regular dependencies.

### Verified workspace configuration

The consumer-side configuration that lets the effect v4 beta and the v3 build toolchain share one `node_modules` tree. The live settings are in `pnpm-workspace.yaml` and the root `package.json` — read those for exact values — and [package-setup.md](package-setup.md) has the per-package file manifest.

- Every published tool in the dependency chain declares its complete `@effect/*` peer closure as regular dependencies, so no transitive peer escapes to a consumer's importer where `autoInstallPeers` could bind an incompatible `effect`. The one library that still does not is rspress-plugin-api-extractor, tracked upstream at [issue #69](https://github.com/spencerbeggs/rspress-plugin-api-extractor/issues/69).
- `pnpm-workspace.yaml` sets `autoInstallPeers: true`, so the tool peers of `@savvy-web/silk` and `@vitest-agent/plugin` are auto-installed rather than declared explicitly. It pins neither `dedupeDirectDeps` nor `dedupePeerDependents` — pnpm's defaults apply — and there is no `.npmrc`.
- Every package typechecks with `tsc --noEmit` against `typescript: catalog:silk`; `@effect/tsgo` is not a package dependency (see [the typechecker](package-setup.md#the-typechecker-tsc-not-tsgo)).
- The root `package.json` `devDependencies` are just `@savvy-web/silk` and `@vitest-agent/plugin`; everything else is an auto-installed peer. `@savvy-web/bundler` is a `devDependency` of every package that builds (it is what `savvy.build.ts` imports) and must never be a `dependency`, or the publishable manifest ships a build tool at runtime.

The pnpm resolver bug that once forced workarounds here — a v4 `effect` peer binding into v3-wanting importers — is fixed upstream in pnpm ≥ 11.12.0; the mechanics are in [architecture.md](architecture.md#dependency-resolution).

### Open defect: one peers-check issue

**Resolved 2026-07-18**: the defect this section recorded — `rolldown-pnpm-config`'s Effect **v3** satellites (`@effect/platform`, `@effect/rpc`, `@effect/sql`, `@effect/cluster`) wanting `^3.21.x` inside `packages/pnpm-plugin-effect`'s context, a consequence of the bundler 2.0 upgrade whose binding mechanics and 347ca229 devDependency fix are recorded in [pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md) — cleared with the 2026-07-18 `@savvy-web` toolchain update, with no change needed in this repo. The known-issue slot's occupant now rotates with the release cadence: the current class is a registry-published `@effected` artifact peering on the exact previous beta after a catalog advance (as of the 2026-07-19 beta.99 advance, `@effected/jsonc@0.2.0` wanting `4.0.0-beta.98`), tracked live in the root `CLAUDE.md` Dependencies paragraph and addressed structurally by the generated `peerDependencyRules.allowedVersions` table proposed in [pnpm-plugin-effect.md](packages/pnpm-plugin-effect.md). Do not silence the current occupant, and do not treat its presence as license to tolerate a second: there is no expected-residual set beyond it, so any other warning is a genuine closure defect to fix upstream.

The previous residual recorded here — `@savvy-web/bundler@1.1.14` peering on `typescript@^7` against an installed TypeScript 6 — was **resolved** by the same silk 2.5 / bundler 2.0 upgrade: `catalog:silk` now installs TypeScript 7.0.2 and the whole workspace typechecks green under TS7.

## Cross-@effected dependencies

Every internal `@effected/*` edge — peer and regular dependency alike — uses `workspace:~`. That is patch-floating: a sibling patch flows into an existing release without forcing a coordinated re-release ([issue #133](https://github.com/spencerbeggs/effected/issues/133)), while a minor bump still needs a coordinated release because `~` holds the minor. Whether an edge is a peer or a regular dependency is still decided per edge at design time — that choice is about the shared-instance contract, not the version range. Floating the regular edges too, not only the peers, lets a consumer's paths dedupe onto one sibling copy, which matters where an integrated package surfaces a sibling's types across its API.

The graph must stay **acyclic**. Every package releases together (see [releases.md](releases.md)), so a cycle is not caught by a publish order that fails — it simply becomes permanent. The kit can carry as many small packages as the seams justify; what it cannot carry is a back-edge. In practice every edge runs from boundary toward pure, or from pure toward more-pure, and an edge that wants to run the other way is a sign the shared thing belongs in a third package. When `@effected/config-file` hit this during its port, the fix was not a new package but relocating the error classes it was reaching backwards for.

### One resolved copy is a correctness requirement, not hygiene

The dedupe-onto-one-copy concern above is not confined to this repo's internal edges — it binds every consumer, and it is sharper than a duplication-bloat argument. A `Context.Service` tag is an **identity**. Two resolved copies of the same `@effected` package are two distinct tags, so a layer built from one copy does not satisfy a requirement expressed by the other. The type system is right to reject it; the diagnostic just does not say so.

Reported from the savvy-web-systems dogfood loop after `@effected/workspaces@0.7.0` (2026-07-25). Four packages in that repo declared `^0.6.2`; only the one consuming the changed API was bumped. Because a caret on a `0.x` version locks the minor (`^0.6.2` is `>=0.6.2 <0.7.0-0`), the others stayed behind, and the install produced 0.7.0 and 0.6.2 side by side. What surfaced was not a version error:

```text
Layer<… , never, ChildProcessSpawner | … | WorkspaceSnapshots>
  is not assignable to
Layer<McpServices, never, ChildProcessSpawner | FileSystem | Path>
```

`WorkspaceSnapshots` read as an unmet requirement in a graph whose own `layerWithGit` provides it — the provided tag came from 0.6.2, the required one from 0.7.0. The reporter checked the `.d.ts` diff first and confirmed **no `Layer` declaration changed between the two versions**, which is what pointed at duplicate identity rather than a signature change.

Two consequences worth holding onto:

- **Upgrading is per-repo, not per-package.** Bump *every* package declaring an `@effected` dependency, not only the one consuming the changed API, and confirm a single resolved copy afterward. While the kit is pre-`1.0`, every minor is this trap, because caret ranges on `0.x` do not carry across it.
- **Read this diagnostic as a resolution question first.** A service that appears unprovided while a layer visibly provides it is duplicate identity until proven otherwise. Chasing it as a signature change costs a `.d.ts` diff that will come back clean.

This is the consumer-side half of why internal edges float on `workspace:~`: the same one-copy property the kit maintains for itself has to hold in the consumer's tree, and there the only lever is the declared range.

## Toolchain constraints

### API Extractor × Effect class factories

Effect class factories (`Schema.Class`, `Schema.TaggedClass`, `Schema.TaggedErrorClass`, `Schema.Opaque`, `Context.Service`) produce an anonymous heritage type that API Extractor reports as `ae-forgotten-export` on the synthesized `X_base` symbol (CI-fatal under the silk bundler). House policy: write the class factory **inline** (`export class X extends Schema.Class<X>("X")({...}) {}` — no split-out base const, no hand-written annotation) and suppress the synthesized-base warning narrowly in the package's `savvy.build.ts` via `meta.tsdoc.suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }]`. The emitted `.d.ts` names the base as a module-local, non-exported `declare const X_base` whose full shape is inlined into the exported class, so it is genuinely un-nameable and un-needed by consumers; the suppression is narrow, still logged (it lands in the `issues.json` `suppressed` bucket, not silenced), and hides nothing a consumer needs. The suppression is scoped to `_base` ONLY: an internal type named on a `@public` method/return signature is a different symbol that still forgotten-exports and must be inlined structurally or made `@public` (it is genuine surface, so it stays un-masked). Field-schema consts that are genuinely reusable public API (e.g. package-json's `DependencyMapField`/`BinField`) stay `@public` on their own merit; only the synthesized `*_base` heritage symbols are suppressed. Every package follows this policy. Idiom, worked example and the `_base`-vs-method-signature boundary: `plugin/skills/effect-api-extractor-bases/SKILL.md`.

## References

Standards above derive from the Effect team's guides:

- [guide-schema.md](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/references/guide-schema.md)
- [guide-layers.md](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/references/guide-layers.md)
- [guide-error-handling.md](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/references/guide-error-handling.md)
- [guide-observability.md](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/references/guide-observability.md)
- [guide-testing.md](https://github.com/Effect-TS/skills/blob/main/skills/effect-ts/references/guide-testing.md)
