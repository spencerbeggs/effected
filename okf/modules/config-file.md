---
type: Module
title: config-file
description: Composable config-file loading built around a codec × resolver × strategy pipeline, carrying all four config codecs.
status: stable
kind: package
resource: ../../packages/config-file
tags:
  - dx
  - bundle
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 5094b333d4702f16
---

# config-file

## Purpose

`@effected/config-file` is composable config-file loading built around a **codec × resolver × strategy** pipeline. A codec turns bytes into a decoded document and back; a resolver locates candidate source files; a strategy selects or merges the located sources. All three are small seams a consumer composes explicitly, and decorator codecs each wrap a `ConfigCodec` and return one, so encryption, migrations and format compose freely. `@effected/config-file` holds every config **codec** — the `jsonc`, `yaml` and `toml` **format** packages stay independent, pure, and unaware of it. The four codecs (`JsonCodec`, `JsoncCodec`, `YamlCodec`, `TomlCodec`) are **free-standing named exports**, one module each, with `ConfigCodec` the interface only — see [the load-bearing constraint](#the-load-bearing-constraint-free-standing-named-exports-never-a-namespace-object).

## Tier and dependency posture

[Boundary tier](../glossary/library-tier.md). All IO goes through core `FileSystem`/`Path`; the package never touches `node:fs`. `effect` plus four `workspace:^` peers (the three format engines and `walker`), each mirrored by a plain `workspace:*` devDependency — the two specifiers deliberately differ so a published patch floats. Runtime `dependencies` stays **empty**: the accurate property is **zero external runtime dependencies**. An *external* format parser or crypto library would make the package integrated, which is why the codecs wrap the kit's own format packages and the crypto helpers are hand-rolled over WebCrypto (`globalThis.crypto.subtle` for PBKDF2 derivation and AES-GCM, `globalThis.crypto.getRandomValues` for salts and nonces) rather than `node:crypto` — the platform global keeps the module runtime-agnostic as well as dependency-free. `@effected/*` peers do not change the tier, since tier does not propagate ([R3](../glossary/library-tier.md)).

The upward-walk resolvers are expressed over `walker`'s primitives, so this package has no walk-up loop of its own.

## The load-bearing constraint: free-standing named exports, never a namespace object

The codecs are distinct named exports, each its own binding in its own module, each importable in isolation — never collected into a namespace object, and `ConfigCodec` is exported as an interface only. This is the whole reason four codecs can live in one package: a namespace object collecting them would be a dispatch table — referencing it at all reaches every codec, every codec reaches its engine, and a consumer importing the type or the JSON codec alone drags the jsonc, yaml and toml engines into its bundle. Tree-shaking would die silently, with no error and no warning, just a bundle several hundred kilobytes larger than it should be. See [the codecs are free-standing named exports](../decisions/codecs-are-free-standing-named-exports.md) for the alternatives rejected and how the tree-shaking property is measured, not assumed. This is the [no-barrel-re-exports](../conventions/no-barrel-re-exports.md) rule in different syntax.

## Module layout

Module-per-concept; every public name is a file name, every non-entrypoint module imports explicitly — no barrels, no re-export facades, no namespace objects. The concepts are the service, the codec seam, the four codecs, the encryption and migration decorators, the resolver and strategy seams, the event system, the `ConfigProvider` bridge, and two internal helpers. `internal/crypto.ts` imports nothing from the rest of the package, partly because a back-import would close a cycle Biome rejects at error level, and partly because encryption is the strongest future split candidate (WebCrypto is orthogonal to config loading) and isolation keeps that extraction cheap.

## Error model

A small `Schema.TaggedError` ladder, each error defined in the module of the concept that raises it, carrying structure rather than prose — causes and schema issues ride `Schema.Defect()`, never a stringified message. Granularity is restrained: each tag maps to a distinct recovery a caller would actually make, and "no config was found" gets its own tag precisely so it is routable. Per-method error unions narrow accordingly — the default-taking loader cannot fail with not-found because it handles that branch, the explicit-path write cannot either, and validation fails only one way. The codec seam is generic in its error channel, so decorator codecs *widen* rather than flatten it. `SchemaError` is normalized to the validation error at the decode boundary via `Effect.catchTag`, never leaked or stringified.

Saving without a configured default path is a **typed runtime error, not a compile error**: the compile-time version is unsound, since `Context.Key` is covariant in its shape, so a type encoding "no save" would typecheck while the runtime object still carried the method — strictly worse, because it lies about the shape. The error carries an empty field record rather than a fabricated path.

Callback error semantics distinguish by whether a callback's result participates in the operation's result: a validation hook's does, so a throw there stays a defect; the event emit hook's does not, so a throw there is caught and logged, keeping the "events never break the pipeline" contract.

## Service API and per-schema identity

Each config schema gets a uniquely-keyed service so multiple typed config services coexist in one layer graph — a generic class factory the consumer extends, putting identity and shape in one consumer-owned artifact (`class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}`). Options are supplied to the layer, not baked into the factory, because resolver requirements must flow into the layer's `R` and the scoped test layer needs to vary options freely against the same service identity. `ConfigFile.layer` is a layer-*returning function* — bind its result to a const and provide that const, or two independent service instances get minted. The test layer seeds files into a temp directory and runs the **real** implementation over them rather than a mock; it has no default path, so save and update honestly fail under it.

The service keeps a deliberate save-versus-write distinction — default path with directory creation, versus explicit path with none — and update is load-transform-save. The default-taking loader returns its default **as-is**, applying neither the schema nor a configured validation hook. Discovery **aborts** on a found-but-corrupt low-priority source rather than skipping it: silently continuing would run the pipeline on a different, wrong configuration than the one closest to the caller's intent.

`encode(value, options?)` yields the serialized text — byte-for-byte what `write` would put on disk — without touching the filesystem; internally the old encode-and-write step is split into `encodeTo` plus the write, so `encode`, `write` and `save` share one encoding path. Because nothing was written, `encode` emits no event and its errors carry no path. `encode` and `write` take `ConfigEncodeOptions { header?: string }`; the header is prepended **verbatim** by the service, separated from the document by exactly one newline, and is never threaded through `ConfigCodec.stringify` — the caller owns the header's validity in the target format (`#` for TOML and YAML, `//` for JSONC, and JSON has no comment syntax at all, so a header on the JSON codec is an unparseable file by construction).

`ConfigFileOptions` and `ConfigReadOptions` both take `parseOptions`, threaded into every schema decode either performs. The motivating field is `onExcessProperty`, which core defaults to `"ignore"` — for a loader that default means a user's unknown keys are dropped in silence, so the package can report neither a typo'd section nor a deliberately-removed field. This cannot be expressed with the `validate` hook, since `validate` runs on the already-decoded value, by which point excess keys are already gone. Two properties keep `"error"` safe to adopt: keys covered by a `Schema.StructWithRest` rest are not excess, so a deliberate pass-through section keeps working under it; and it pairs naturally with `errors: "all"` (core defaults to `"first"`, which for a loader means a file with three typos surfaces one per run).

`ConfigFile.read(path, { schema, codec })` is the one-shot form: reads, decodes and validates one explicit path with no service class, no layer and no tag, requiring only `FileSystem` in `R`. The service binds schema and codec at layer construction, right for a config file an application **has** (several candidate locations, saving, migrations, events); `read` takes its schema per call, so one call site can read several unrelated files without a service class each. It stays read-only and discovery-free, and the codec is an explicit argument, never inferred from a file extension — naming it at the call site is what preserves the free-standing-codec guarantee, since a consumer that only ever passes the JSON codec never references the other three modules. **Never add extension-based inference.**

## R-channel type safety

Resolver and default-path requirements flow into the layer's `R` type rather than being cast away — a consumer supplying a resolver that needs a custom service gets that requirement surfaced on the layer rather than as a runtime surprise. `Path` is a boundary requirement alongside `FileSystem`. The resolver-requirements parameter defaults to `never`, so an empty resolver list with no default path does not infer `unknown`; the strategy seam takes a non-empty source list, so both strategies collapse their error channel to `never`.

## ConfigProvider integration

The provider bridge exposes the loaded, merged document as a v4 `ConfigProvider`, so consumers read it through standard `Config` accessors and layer it beneath env-var providers, with the first-match strategy mapping onto provider fallback and the layered one onto provider merge. This is strictly additive, exported from its own concept file so it never becomes a required import; the schema-validated whole-document load stays the primary API. `ConfigProvider.fromUnknown` does not flatten nested objects, so nested keys are read through the nesting combinator, and the bridge exposes **decoded leaves**, accepting only primitive leaf types, so a present `Date`-typed field and a genuinely missing key produce byte-identical diagnostics.

## The four codecs

Each codec is a thin implementation over one format package. The JSON one is the zero-dependency built-in over the platform's own parser. **The JSONC codec cannot preserve comments across a round trip** — its encode direction is plain JSON emission, so comments never survive decode-then-encode, and its output is byte-identical to the JSON codec's; the codec seam is stateless (value in, string out), so a comment-preserving write would require the seam itself to accept the prior raw text, an open question recorded rather than resolved. The one comment the service *does* write, the `header` option, is prepended above the codec rather than passed through it, which is why the seam stayed stateless. **The TOML codec** is the one with a cheap genuine stringify failure, since TOML has no null; its hostile-input coverage trips the format package's parse-side nesting cap and asserts a typed failure, not a defect — TOML datetimes and large integers decode to their domain classes and `bigint`, and the seam is `unknown` so the consumer's schema decides. The YAML codec has a real stringify and carries no comment-loss caveat.

## Merge and hardening properties

The deep merge behind the layered strategy runs over the **decoded** source values. **Value identity is preserved**: the merge builds its result on the target's prototype, so a decoded `Schema.Class` document survives as a real instance with its getters intact and still encodes through the schema; recursion is gated on a true plain-object test (prototype `Object.prototype` or `null`), so nested `Date`, `Map`, `Set`, `RegExp` and class instances are atomic — the highest-priority source that defines one wins it whole. Because each source decodes individually before the strategy sees it, the layered strategy overrides values across tiers but cannot fill a field missing from a source, since that source would fail its own decode first. **Prototype-pollution safe**: preserving the prototype means the result inherits `Object.prototype`'s `__proto__` accessor, so the merge filters dunder keys from both sides and copies every key with `Object.defineProperty` — an own data property that never consults the prototype chain — never plain assignment and never `Object.assign`.

Three more properties: **Update serializes its read-modify-write** with a one-permit semaphore per service instance, so two concurrent calls do not silently drop one's change — it guards one service instance in one process, not a file lock. **One unreadable ancestor never aborts a walk**, since the walker absorbs each probe individually. **A parse throw inside a root-detection predicate must be caught locally**, because the walker's absorption catches *failures*, not defects, and a malformed manifest would otherwise leak a defect straight through. PBKDF2 runs at OWASP's current guidance for iterations, the one deliberate divergence from a verbatim crypto port; key derivation is memoized per codec instance with invalidation on exit, so a failed or interrupted derivation is retried rather than replayed.

## Observability

Named `Effect.fn` spans on every public fallible service method, plus spans around the codec-parse and resolver-probe sub-steps that dominate latency. The PubSub event system is a consumer-facing hook, opt-in via an optional tag and honestly zero-cost when absent — omit it and emission never even looks the service up. An event variant is emittable iff the step it reports has a non-`never` error channel, which is why a stringify-failure event exists (the codec is consumer-implemented and can fail) while a discovery-failure one does not (resolution is `never` under the absorption contract). The library stays telemetry-agnostic.

## No watching

See [config-file has no file-watching capability](../limitations/config-file-no-watching.md) for what watching would need and why it does not belong bolted onto this pipeline.

## Testing

`@effect/vitest` with `it.effect` as the default mode, shared wiring via top-level `layer(...)` groups; tests in `__test__/` split per concept, integration under `__test__/integration/`. Error-path tests via `Exit`/`Cause` inspection are the centerpiece: each tag is reached by a distinct failure, the cause is preserved structurally, the validation error carries the schema issue rather than a string, and type-level assertions confirm the narrowed per-method unions. Pipeline-composition tests round-trip the decorator stack; resolver tests treat the error-absorbing policy as a contract; merge-strategy, test-layer and provider tests cover source reporting, prototype preservation and pollution guards. Integration tests are the only ones that provide a platform layer. `it.effect` **always** installs a virtual `TestClock`, so any real sleep or timeout hangs silently until the vitest timeout.

## Sync-primitive policy exemption

`ConfigCodec`'s `Effect`-returning members do **not** carry `Result` twins — see [config-file's codecs are exempt from the sync primitive policy](../decisions/codecs-exempt-from-sync-primitive-policy.md) for why the `Effect` here is polymorphism over an interface rather than a wrapped span, and the [sync primitive policy](../conventions/sync-primitive-policy.md) it is an exemption from.
