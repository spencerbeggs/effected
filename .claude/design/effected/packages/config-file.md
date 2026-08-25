---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 93
related:
  - cli.md
  - ../consumers/reposets.md
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - jsonc.md
  - yaml.md
  - toml.md
  - package-json.md
  - walker.md
  - xdg.md
  - app.md
---

# @effected/config-file design

## Overview

`@effected/config-file` is composable config-file loading — a **boundary-tier** package built around a **codec × resolver × strategy** pipeline. A codec turns bytes into a decoded document and back; a resolver locates candidate source files; a strategy selects or merges the located sources. All three are small seams a consumer composes explicitly, and decorator codecs each wrap a `ConfigCodec` and return one, so encryption, migrations and format compose freely.

The package carries all four codecs — `JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec` — over the independent [jsonc](jsonc.md), [yaml](yaml.md) and [toml](toml.md) format packages. The dependency arrow points one way: **config-file → format packages, never the reverse.** The format packages stay pure and unaware of config-file.

## The load-bearing constraint: free-standing named exports, never a namespace object

The codecs are **distinct named exports**, each its own binding in its own module, each importable in isolation. They are **not** collected into a namespace object, and `ConfigCodec` is exported as an interface only.

This is the whole reason the four codecs can live in one package. A namespace object collecting them would be a **dispatch table**: referencing it at all reaches every codec, every codec reaches its engine, and a consumer importing the type or the JSON codec alone drags the jsonc, yaml and toml engines into its bundle. Tree-shaking would die **silently** — no error, no warning, just a bundle several hundred kilobytes larger than it should be.

A namespace object is the repo's [no-barrel-re-exports](../effect-standards.md#no-barrel-re-exports) rule biting in different syntax, and unlike a re-export barrel it survives tree-shaking analysis as a single live binding. With no object to grow, the rule is **structurally impossible to violate** rather than a convention a contributor could helpfully tidy away. It must not return in any form — not a dotted accessor, not a record, not a map.

The tree-shaking property is **measured, not assumed**: bundling a consumer that names only one codec produces a bundle carrying that engine and no other engine's fingerprint, and bundling all four carries all four. The method — bundle a single-codec consumer with the workspace edges bundled in, then verify the absent engines — is cheap to re-run against a doubt. **The tripwire stands:** if tree-shaking is ever falsified, realistically only by someone collecting the codecs back into a namespace object, this whole consolidation must be revisited.

## Tier and dependencies

**Boundary tier.** All IO goes through core `FileSystem`/`Path`; the package never touches `node:fs`. R2, the only propagation rule, names tier 3 alone, and every dependency here is a pure-tier `@effected` package, so the tier stays boundary. An *external* format parser or crypto library would make it integrated — which is why the codecs wrap the kit's own format packages and the crypto helpers are hand-rolled over WebCrypto.

`effect` plus four `workspace:^` peers (the three format engines and [walker](walker.md)), each mirrored by a plain `workspace:*` devDependency — the two specifiers deliberately differ so a published patch floats. Runtime `dependencies` stays **empty**: the accurate property is **zero external runtime dependencies**.

Two platform facts bite consumers wiring this up: v4's `@effect/platform-node` exports no `NodeContext` aggregate (the aggregate is `NodeServices`), and the filesystem layer alone does not satisfy `FileSystem | Path` — a real wiring merges the filesystem and path layers.

The upward-walk resolvers are expressed over [walker](walker.md#consumer-relationship)'s primitives, so this package has **no walk-up loop of its own**. Walker is boundary tier but does not propagate ([R3](../effect-standards.md#dependency-policy)).

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept); every public name is a file name, every non-entrypoint module imports explicitly — no barrels, no re-export facades, no namespace objects. The concepts are the service, the codec seam, the four codecs, the encryption and migration decorators, the resolver and strategy seams, the event system, the `ConfigProvider` bridge and two internal helpers.

`internal/crypto.ts` is kept deliberately clean and imports **nothing** from the rest of the package — partly because a back-import would close a cycle Biome rejects at error level, and partly because encryption is the strongest future split candidate (WebCrypto is orthogonal to config loading) and isolation keeps that extraction cheap.

The statics containers are static classes with a private constructor rather than `as const` objects, because an `as const` object's member types are inferred in the built `.d.ts` and lose their TSDoc entirely. Two of them are recorded **holdouts**: each shares a name with a same-file generic interface or type alias declared without a default type parameter, and merging a class into either is a compile error — confirmed against the installed TypeScript, not assumed. A third stays `as const` because its one member is a data value with no member TSDoc to preserve.

## Error model

The error surface is a small `Schema.TaggedError` ladder, each error defined in the module of the concept that raises it, and each carrying **structure rather than prose** — causes and schema issues ride `Schema.Defect()`, never a stringified message. See `src/` for the current set.

Granularity is restrained: each tag maps to a distinct recovery a caller would actually make, and "no config was found" gets its own tag precisely so it is routable. **Per-method error unions narrow accordingly**, which is the point and what the tests assert — the default-taking loader cannot fail with not-found because it handles that branch, the explicit-path write cannot either, and validation fails only one way.

The codec seam is **generic in its error channel**, so decorator codecs *widen* rather than flatten it with no variance friction. `SchemaError` is normalized to the validation error at the decode boundary via `Effect.catchTag`, never leaked or stringified.

Saving without a configured default path is a **typed runtime error, not a compile error**. The compile-time version is unsound: `Context.Key` is covariant in its shape, so a type encoding "no save" would typecheck while the runtime object still carried the method — strictly worse than a typed error, because it lies about the shape. The error carries an empty field record rather than a fabricated path.

**Callback error semantics.** A caller-supplied callback that declares an `Effect` error channel owns its contract, and a `throw` from one is a programmer bug that stays a defect; `Effect.suspend` normalizes construction-time throws so every throw shape behaves identically. The distinguishing rule is: **does the callback's result participate in the operation's result?** A validation hook's does, so a throw there is a defect. The event emit hook's does not — its result is discarded — so a throw there is caught and logged, keeping the "events never break the pipeline" contract.

## Service API and per-schema identity

Each config schema gets a uniquely-keyed service so multiple typed config services coexist in one layer graph. The form is a generic class factory the consumer extends, putting identity and shape in one consumer-owned artifact:

```ts
class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}
class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

const layer = ConfigFile.layer(AppConfig, {
  schema: AppShape,
  codec: JsonCodec,
  resolvers: [ConfigResolver.upwardWalk(".apprc"), ConfigResolver.systemEtc("app")],
  strategy: MergeStrategy.firstMatch,
});
```

Options are supplied to the layer, **not baked into the factory**, for two reasons: resolver requirements must flow into the layer's `R`, and the scoped test layer needs to vary options freely against the same service identity.

`ConfigFile.layer` is a layer-*returning function* — bind its result to a const and provide that const, or you mint two independent service instances. The test layer seeds files into a temp directory and runs the **real** implementation over them rather than a mock; it has no default path, so save and update honestly fail under it.

The service keeps a deliberate **save versus write** distinction — default path with directory creation, versus explicit path with none — and update is load-transform-save. The default-taking loader returns its default **as-is**, applying neither the schema nor a configured validation hook to it. Discovery **aborts** on a found-but-corrupt low-priority source rather than skipping it: silently continuing would run the pipeline on a different, wrong configuration than the one closest to the caller's intent.

### Decode options, and why `validate` cannot substitute

`ConfigFileOptions` and `ConfigReadOptions` both take `parseOptions`, threaded into **every** schema decode either performs. Absent, core's defaults apply and nothing changes.

The field that motivates it is `onExcessProperty`, which core defaults to `"ignore"`. For a *loader* that default means a user's unknown keys are dropped in silence, so the package can report neither a typo'd section nor a field the schema deliberately removed — the two config-file diagnostics a user most needs. **It cannot be expressed with the `validate` hook**, and that is the load-bearing part: `validate` runs on the *decoded* value, by which point the excess keys are already gone. Without the option a consumer writes a bespoke filter per removed field.

Two properties keep `"error"` safe to adopt. Keys covered by a `Schema.StructWithRest` rest are **not** excess, so a schema admitting a deliberate pass-through section keeps working under it. And it pairs with `errors: "all"`: core defaults to `"first"`, which for a loader means a file with three typos surfaces one per run — fix, re-run, discover the next — while the extra work only ever happens on a document that is already failing.

Rendering the resulting issue tree into a sentence a user can act on is [`@effected/cli`](cli.md)'s job, not this package's, which is why the dependency points that way.

### ConfigFile.read — the one-shot form

`ConfigFile.read(path, { schema, codec })` reads, decodes and validates one explicit path with **no service class, no layer and no tag**, requiring only `FileSystem` in `R`.

The service binds schema and codec at *layer construction*, which is right for a config file an application **has** — several candidate locations, saving, migrations, events — and heavy for a call site decoding one known path once, where it costs a service subclass, a layer bound to a const and a provide at the boundary. `read` takes its schema **per call**, so one call site can read several unrelated files without a service class each; that is the difference the layer-bound loader cannot express.

Three properties keep it from growing into a second pipeline:

- **Read-only and discovery-free.** No resolver chain, no write path. Wanting either means reaching for `ConfigFile.layer`, not extending this.
- **The codec is an explicit argument**, never inferred from a file extension and never defaulted. Naming it at the call site is what preserves the [free-standing-codec guarantee](#the-load-bearing-constraint-free-standing-named-exports-never-a-namespace-object): a consumer that only ever passes the JSON codec never references the other three modules, so their engines stay out of the bundle. **Never add extension-based inference** — a convenience that picked a codec by extension would reach all four and silently undo the constraint the whole package is organized around.
- **The error channel is exactly the layer-bound loader's**, with the schema issue tree held structurally. A validation failure records the path, because a one-shot read always knows where it read from — unlike in-memory validation, which has none.

## R-channel type safety

Resolver and default-path requirements **flow into the layer's `R` type** rather than being cast away. The resolver seam is generic in its requirements and the layer unions them, so a consumer supplying a resolver that needs a custom service gets that requirement surfaced on the layer rather than as a runtime surprise. `Path` is a boundary requirement alongside `FileSystem` — every resolver requires it and the consumer's platform layer satisfies it once, which is the proof the layer type carries.

Two type-level details keep the ergonomics honest: the resolver-requirements parameter defaults to `never`, so an empty resolver list with no default path does not infer `unknown` and surface a misdirected assignability error; and the strategy seam takes a **non-empty** source list, so both strategies collapse their error channel to `never` — emptiness is the pipeline's concern, raised before a strategy is invoked.

## ConfigProvider integration

The provider bridge exposes the loaded, merged document as a v4 `ConfigProvider`, so consumers read it through standard `Config` accessors and layer it beneath env-var providers, with the first-match strategy mapping onto provider fallback and the layered one onto provider merge.

This is strictly **additive**, exported from its own concept file so it never becomes a required import. The schema-validated whole-document load stays the primary API, because v4's `Config` has no schema-validated document story.

Two shape facts govern it. `ConfigProvider.fromUnknown` does not flatten nested objects, so nested keys are read through the nesting combinator and the bridge needs no flattening step. And it exposes **decoded leaves**, accepting only primitive leaf types — so a present `Date`-typed field and a genuinely missing key produce byte-identical diagnostics. Encoding through the schema first was rejected because it would reintroduce exactly the coupling this module exists to avoid; the caveat is documented on the member rather than fixed.

## The four codecs

Each codec is a thin implementation over one format package. The JSON one is the zero-dependency built-in over the platform's own parser.

**The JSONC codec cannot preserve comments across a round trip.** Its encode direction is plain JSON emission, so comments never survive decode-then-encode, and its output is byte-identical to the JSON codec's. The edit-based surfaces cannot help, because they need the *original* source text while the codec seam is stateless — value in, string out. A comment-preserving write would require the seam itself to accept the prior raw text, which is an open question recorded rather than resolved.

**The TOML codec is the one with a cheap genuine stringify failure**, since TOML has no null, so it is where the tests pin a structural stringify cause. Its hostile-input coverage trips the format package's parse-side nesting cap and asserts a typed *failure*, not a defect. TOML datetimes and large integers decode to their domain classes and `bigint`; the seam is `unknown`, so the consumer's schema decides.

The YAML codec has a real stringify and carries no comment-loss caveat.

## Merge and hardening properties

The deep merge behind the layered strategy runs over the **decoded** source values, which makes two properties load-bearing:

- **Value identity is preserved.** The merge builds its result on the target's prototype, so a decoded `Schema.Class` document survives as a real instance with its getters intact and still encodes through the schema. Recursion is gated on a true plain-object test — prototype `Object.prototype` or `null` — so nested `Date`, `Map`, `Set`, `RegExp` and class instances are **atomic**: the highest-priority source that defines one wins it whole. A `toString`-tag test cannot discriminate here, since `Schema.Class`, `DateTime` and `Option` all report the same; only the prototype test is safe. Because each source decodes individually before the strategy sees it, the layered strategy overrides values across tiers but cannot fill a field missing from a source — that source would fail its own decode first.
- **Prototype-pollution safe, and the two properties interact.** Preserving the prototype means the result inherits `Object.prototype`'s `__proto__` accessor, so any write through `[[Set]]` semantics can move the prototype. The merge therefore filters the dunder keys from **both** sides and copies every key with `Object.defineProperty` — an own data property that never consults the prototype chain — never plain assignment and never `Object.assign`. Neither half of that guard is optional.

Three more properties of the current pipeline:

- **Update serializes its read-modify-write** with a one-permit semaphore per service instance, so two concurrent calls do not silently drop one's change. It guards one service instance in one process; it is **not** a file lock. (`Semaphore` is a top-level v4 module — there is no `Effect.makeSemaphore`.)
- **One unreadable ancestor never aborts a walk.** The walker absorbs each probe individually, so a permission error on an ancestor is skipped and the walk continues — the resolver-absorption contract is a property of the walk rather than of a wrapper.
- **A parse throw inside a root-detection predicate must be caught locally.** The walker's absorption catches *failures*, not defects, and the predicate's declared error channel is a platform error rather than `never` — so without the local guard a malformed manifest would leak a defect straight through. Removing it is a regression, not a simplification.

**PBKDF2 runs at OWASP's current guidance for iterations**, the one deliberate divergence from a verbatim crypto port. Key derivation is memoized per codec instance with invalidation on exit, so a failed or interrupted derivation is retried rather than replayed — plain caching would brick the instance by replaying an interrupt forever.

## Observability

Per the [observability standard](../effect-standards.md#observability-standards): named `Effect.fn` spans on every public fallible service method, plus spans around the codec-parse and resolver-probe sub-steps that dominate latency.

The PubSub event system is a consumer-facing hook, opt-in via an optional tag and honestly zero-cost when absent — omit it and emission never even looks the service up. **An event variant is emittable iff the step it reports has a non-`never` error channel**, which is why a stringify-failure event exists (the codec is consumer-implemented and can fail) while a discovery-failure one does not (resolution is `never` under the absorption contract).

The library stays telemetry-agnostic — applications compose `@effect/opentelemetry` at the edge.

## No watching

The package deliberately offers no file-watching capability. Watching is not a translation of what is here — it needs its own design: change detection should be `Equal`- or schema-derived equivalence rather than a serialized comparison; a config file that becomes **corrupt** must be distinguishable from one that was **deleted**, a typed error versus an absence; fiber interruption replaces an un-Effect-ish abort signal; and it should offer core's filesystem watch alongside polling. None of that belongs bolted onto this pipeline.

## Testing

`@effect/vitest` with `it.effect` as the default mode, shared wiring via top-level `layer(...)` groups; tests in `__test__/` split per concept, integration under `__test__/integration/`.

- **Error-path tests via `Exit`/`Cause` inspection** are the centerpiece: each tag is reached by a distinct failure, the cause is preserved structurally, the validation error carries the schema issue rather than a string, and type-level assertions confirm the narrowed per-method unions. The cause predicates are what distinguish a failure from a defect, since the exit's cause is an `Option`.
- **Pipeline-composition tests** — the decorator stack round-trips, and each decorator's widened error channel surfaces the right tag.
- **Resolver tests** treat the error-absorbing policy as a contract: a permission denial on one tier yields absence and never aborts the chain.
- **Merge-strategy, test-layer and provider tests**, including source reporting under the layered strategy, the prototype-preservation and pollution-guard probes and composition with an environment provider.

Integration tests are the only ones that provide a platform layer — the boundary discipline made explicit. Note that `it.effect` **always** installs a virtual `TestClock`, so any real sleep or timeout hangs silently until the vitest timeout.
