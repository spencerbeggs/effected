---
status: current
module: effected
category: architecture
created: 2026-07-08
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - ../architecture.md
  - ../effect-standards.md
  - ../package-inventory.md
  - package-json.md
  - workspaces.md
  - lockfiles.md
  - semver.md
  - commands.md
  - memfs.md
---

# @effected/npm design

## Overview

`@effected/npm` owns four things:

- The **dependency-resolution contracts** a package.json-document library defines but cannot implement — `CatalogResolver` and `WorkspaceResolver`, resolving pnpm `catalog:` / `workspace:` specifiers to concrete versions.
- The **cross-cutting npm vocabulary** that flows between the manifest, lockfile and workspace packages: `DependencySpecifier`, the dependency-section literals, `IntegrityHash`, `PackageManagerPin`, `PackageManagerCache` and the [`ReleaseAgeGate`](#releaseagegate).
- The **[`Manifest` domain model](#manifest-tolerant-manifest-level-resolution)** — manifest-level resolution built on the per-specifier contracts.
- The **[registry, tarball and publish services](#the-service-half-registry-reads-tarballs-and-publishing)** — `NpmRegistry`, `PackageTarball` and `PackagePublish`, which do their own IO through core contracts in `R`.

Resolution lives here rather than in package-json because it fundamentally requires workspace and catalog context that a manifest library cannot have; the full rationale is [resolution belongs to @effected/npm](package-json.md#resolution-belongs-to-effectednpm). The vocabulary lives here because these scalars are shared by three or more packages, and a single home stops each from prefix-sniffing its own reimplementation.

**Scope discipline.** API ships on evidence: a concept moves here only when a second consumer materializes. `PackageName` stays in [package-json](package-json.md) because it has one consumer. The [vocabulary registry](#vocabulary-registry) records where every npm concept lives so nobody rebuilds an idiom for lack of a map.

**The pure half and the service half stay in one doc deliberately.** They look like two subsystems and would split cleanly on the page, but what binds them is [the tier guardrail](#the-tier-guardrail-and-it-is-enforced): the services may do IO only through core contracts, the vocabulary must not reach them, and the day that breaks the answer is a package split. Splitting the doc first would hide the constraint that decides the package's shape.

## Tier and dependencies

**Boundary tier.** Not by [R2](../effect-standards.md#dependency-policy) — the `@effected/commands` edge is boundary and carries zero runtime dependencies, and boundary does not propagate — but by **[R4](../effect-standards.md#dependency-policy)**: the package performs IO itself, through core-declared contracts (`HttpClient`, `ChildProcessSpawner`, `FileSystem`, `Path`, `Crypto`) required in `R`. That is the walker/xdg/git shape, and it is what boundary means.

`peerDependencies` is `effect` plus one pure-to-pure `@effected/semver` edge, used only so the range case validates through `Range.FromString`. `dependencies` is `@effected/commands` and nothing else — still **zero external runtime dependencies**.

The dependency arrows otherwise point **at** this package: `@effected/package-json`, `@effected/lockfiles` and `@effected/workspaces` all depend on it.

### The tier guardrail, and it is enforced

**Nothing downstream moved when this package became boundary.** `@effected/lockfiles` stays **pure** and `@effected/package-json` stays **boundary**: [R3](../effect-standards.md#dependency-policy) is explicit that a boundary dependency does not propagate, because the IO is discharged by the application's platform layer at the edge.

That holds only while two things stay true, and `__test__/reachability.test.ts` asserts both from the source graph:

1. **The pure vocabulary modules must not reach IO.** `IntegrityHash` and its siblings import neither service nor `@effected/commands`, so a consumer importing vocabulary links no HTTP client and no subprocess runner.
2. **`index.ts` must export individually.** A namespace object is one live binding — a bundler cannot see through it, so importing `IntegrityHash` through one would retain every member's graph. This is the [config-file codec precedent](../effect-standards.md#no-barrel-re-exports) one package over: **never group the services into an `Npm` namespace object**, and never collect the vocabulary and the services behind one const.

The test is proven discriminating — adding a `commands` import to a vocabulary module fails it — and it exists because the guardrail was otherwise only prose. Do not weaken it, and do not "tidy" `index.ts` into a namespace.

**The escalation, if it ever comes.** The moment any service takes a *non-core* runtime dependency — an npm client library, a tarball reader, a registry SDK — this package becomes **integrated**, and then R2 *does* propagate: `lockfiles` (pure) and `package-json` both move with it, and every consumer of those pays. The answer then is not "accept an integrated npm" but **split the services into their own package**, leaving the contracts and vocabulary pure here. That split was considered and rejected for now because the services' densest dependency is this package's own vocabulary, so splitting today buys a package boundary between two halves that talk constantly. **The trigger to revisit is the guardrail above, not taste.**

**The rule has since been tested under pressure and held.** [`PackageTarball`](#packagetarball--reading-a-published-package-back) needs to unpack a `.tgz`, and the obvious implementation takes a tarball-reader dependency — which is the *named* escalation trigger above, verbatim. It extracts by shelling out to `tar` through core's `ChildProcessSpawner` instead, so the tier is unmoved and `lockfiles` stays pure. That is a **tier decision, not a convenience**: the cost is that a consumer off a CI runner image needs both a spawner and the `tar` binary, and paying that cost is cheaper than moving three packages' tiers.

## Module layout

Per the [module-per-concept standard](../effect-standards.md#module-layout-module-per-concept); every concept file imports explicitly, no barrels. See `src/` for the full list. The placements that are decisions rather than mechanics:

- **`WorkspaceResolver.ts` owns `DependencyResolutionError`** (both resolvers raise it), and `CatalogResolver.ts` type-imports it — a one-way edge.
- **`CatalogAssemblyError.ts` and `PublishError.ts` are leaf modules**, not residents of the module that raises them, because two modules must reference each without an import cycle. Same reasoning both times.
- **`index.ts` owns the composite `Default` layer** (both no-op resolver layers merged), because merging them is the cycle-free home.

Every class factory is written **inline**, with the synthesized `_base` heritage symbols suppressed narrowly in `savvy.build.ts`, per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). A `suppressed: 0` in the prod gate means the build did not run properly.

## Resolver contracts

Both contracts are `Context.Service` with the shape inlined structurally, and no-op layers bound to a const so they memoize by reference.

- **`CatalogResolver.rangeOf`** takes a package name and an `Option` catalog name — `None` meaning the default catalog — and answers the configured range, or `None` if unresolvable.
- **`WorkspaceResolver.versionOf`** answers the concrete version without the range modifier, or `None`.
- **`DependencyResolutionError`** is reserved for **mechanism failure**. An unmatched specifier is the `None` convention, not an error.
- **`CatalogAssemblyError`** is the typed failure of catalog *assembly*, and it lives here rather than in the implementing package because **the contract package owns the contract's error vocabulary**. When it lived downstream, `rangeOf` could only name `DependencyResolutionError`, so implementations folded assembly failures into its defect `cause` and every consumer `_tag`-sniffed `unknown` to tell an assembly failure from a resolution failure. With the error beside the contract, `rangeOf`'s channel is the typed union and the sniffing adapter dies in every consumer. `@effected/workspaces` imports it back from here and deliberately does **not** re-export it, so there is exactly one home.
- **`Default`** is the composite layer a consumer provides when it just needs resolution to type-check while resolving nothing.

`@effected/workspaces` implements both contracts directly as layers over its own services ([workspaces.md](workspaces.md#implementing-effectednpms-resolver-contracts)).

## Manifest: tolerant manifest-level resolution

`Manifest` is the manifest-level resolution the per-specifier contracts could not offer alone: a `Schema.Class` domain model of a **tolerant** manifest.

**The wire codec is deliberately tolerant, and the tolerance boundary is precise.** The four dependency fields are typed `string→string` records and **validate** — a malformed dependency field, or a non-record input, fails typed. **Everything else round-trips unvalidated**: the codec partitions the four dependency field names into typed members on decode and lands every other top-level key verbatim in a `rest` catch-all, flattened back to the top level on encode, so no literal `rest` key ever appears on the wire. The rationale: mid-build manifests are arbitrary user records, and forcing them through package-json's strict `Package` decode would fail resolution on fields this module never reads. Consumers wanting the strict model use `Package`.

The surface is a decode static, a pure `needsResolution` getter (the fast-path predicate that lets callers skip catalog assembly entirely), an instance `resolve()` returning a **new** `Manifest` rather than mutating, and an encode back to the wire shape.

**`UnresolvedDependencyError`** is the manifest-level reading of the contracts' `None` convention: the resolution *mechanism* worked, the answer was empty, and a manifest with an unanswerable specifier cannot be projected to concrete ranges. It is distinct from the mechanism errors by design; the per-specifier contracts keep their `None`-is-success convention untouched.

## DependencySpecifier

One specifier grammar spans the kit — lockfiles, workspaces and package-json all classify a specifier the same way. The branded string is the ground truth, with classification statics distinguishing the full protocol set. package-json re-exports the specifier vocabulary from here for surface compatibility, so the home is source-transparent to its consumers.

A `FromString` codec decodes the brand to a **coarse five-case tagged union** — catalog, workspace, semver range, dist-tag and a raw fallback — grouping the protocols the *resolvers* distinguish while the finer classification survives as the statics.

**Exact-string round-trip is structural, not reconstructed.** Every union case stores the original raw string and encoding returns it, so decode∘encode is byte-for-byte identity by construction rather than by re-serializing classified fields. That is what lets brownfield consumers reimplement on the new model without ever losing the raw specifier; a property-based round-trip suite pins it.

**Resolution projections live with the specifier.** Extracting a catalog name and applying pnpm's publish-time workspace projection are both statics here, and the classified instance's own resolve applies the same projection. Each projection has **one** internal implementation shared between the static, the classifier and the instance method, so they can never disagree.

## The vocabulary modules

- **`DependencySection`** — one concept as two literal schemas: the short dependency kinds and the manifest field names, with a single source-of-truth mapping and its inverse derived from it. Replaces the private copies package-json, lockfiles and workspaces each carried.
- **`IntegrityHash`** — an SRI brand covering **three** textual forms, because lockfile integrity is not all-SRI: npm/pnpm record SRI, corepack records its own pin form, and yarn Berry records cache checksums. Dropping the yarn form would silently discard integrity the [lockfiles](lockfiles.md) model treats as load-bearing. `CorepackIntegrityHash` is the corepack-only narrowing shared with package-json's manifest field, so both sides assert against one home, and it is where the [SRI bridge](#sri-to-corepack-conversion) hangs.
- **`PackageManagerPin`** — the corepack pin triple as a first-class class, independent of any package.json field. It shares the strict version ruling with package-json's field model but deliberately diverges on the name grammar: the pin vocabulary is a closed literal set where the field model is permissive.
- **`PackageManagerCache`** — the per-manager default-cache-directory facts table: a pure function of manager, platform and home that a CI action, a workspace tool or a doctor command can all read without a runner, a filesystem or a subprocess. The alternative is shelling a config query per run for a value that on a freshly provisioned machine is always the default. **Every row is cited to the manager's own authority on the member**, because two of the three prior-art rows it replaces were folklore and wrong. yarn is two rows, because the two majors cache differently and nothing about a bare manager name says which is in play.

### SRI-to-corepack conversion

The two integrity spellings the kit already types — npm's SRI `sha512-<base64>` and corepack's `sha512.<hex>` — encode the same digest, and moving between them is a real consumer need: writing a `packageManager` pin from a registry read means converting a value the registry hands over in SRI form. silk-update-action hand-rolled a `corepackHashFromIntegrity` for exactly that, which is the evidence this belongs here (effected#281).

The conversion is a **`Schema` transformation**, `CorepackIntegrityHash.FromSri`, decoding a `string` to the same branded value every other integrity field carries, plus `CorepackIntegrityHash.fromSri` — the `Effect` convenience over it for the imperative call site, failing with a typed `InvalidSriIntegrityHashError` that carries the offending input. Schema-first because the transformation then **composes with `PackageManagerPin`'s decoding**, whose `integrity` field *is* `CorepackIntegrityHash` rather than a copy that agrees with it: a pin assembled from registry data decodes through one pipeline instead of a caller converting by hand and hoping the result parses.

Four rulings carry it:

- **Non-sha512 input fails typed decode** rather than producing garbage. The other algorithms are valid `IntegrityHash` values and a lenient converter would emit a pin corepack rejects at install time, which is the worst place to learn about it. The **digest length is checked too** — sha512 is 64 bytes, and an SRI value carrying anything else cannot be one.
- **The base64 reader is strict and hand-rolled.** `Buffer` is Node-only *and* lenient — it drops invalid characters and truncates — and lenience is exactly what an integrity conversion must not have. A non-canonical spelling (a length no base64 output has, mismatched padding, an interior `=`, non-zero trailing bits) is rejected rather than repaired, because a second spelling of the same bytes is a value npm never emits. Core's `Encoding.decodeBase64` was re-evaluated here at `4.0.0-rc.109` and **kept out for the same reason `Buffer` is**: probed, it decodes `QQ==`, `QR==` and `QV==` to the same byte and strips embedded CRLF, while rejecting the unpadded form this reader accepts — lenient and stricter than us at once, so it is a drop-in in neither direction. This is the [canonical-value mismatch](../effect-standards.md#core-owning-a-primitive-is-not-the-same-as-cores-primitive-fitting) in its purest form, and it is **decode-only**: core's `Encoding.encodeBase64` emits the canonical spelling by construction, which is why [`PackageTarball`](#packagetarball--reading-a-published-package-back) verifies through it with no module-private encoder while this reader stays hand-rolled. One codec, two directions, two different answers.
- **The conversion is one-way from SRI.** An already-corepack-form input does **not** pass through decode; accepting it would let a caller feed pins back in and mask a wiring bug. The codec's *encode* direction is the exact inverse — corepack back to canonical padded SRI, failing typed for the corepack forms SRI cannot carry, such as corepack's own sha224 default pins — which is a codec being a codec, not a second acceptance rule.
- **JSON-quoted registry values are tolerated.** Registry payloads round-trip through JSON in enough consumer paths that one surrounding pair of quotes is a normal input, not a malformed one. One layer only, and encode never re-quotes.

## ReleaseAgeGate

pnpm's publish-time **release-age gate** is shared npm vocabulary, so it is resident here. pnpm refuses to install a version younger than a configured cutoff; a resolver that picks the highest in-range version with no publish-time awareness picks a version pnpm then rejects. Mirroring the gate at resolution time — drop too-young candidates before picking — fixes it.

This is a **schema-first port of the gate vocabulary only**, and three behaviours carry the design:

- **`combine` is variadic and total.** It assembles the effective gate from partial contributions across sources: **strictest age wins**, exclude sets **union** into a deduplicated, sorted, contribution-order-independent wire form, and zero contributions yield the inert zero gate. It never throws — which is why the partial input shape does not clamp; `combine` is the single clamping authority.
- **Exclude matching is flat-string with `@pnpm/matcher` parity, where `*` crosses `/`.** A bare `*` matches a scoped name and a scope pattern matches a whole scope. This is **deliberately not [@effected/glob](glob.md)'s minimatch dialect**, where `*` refuses to cross `/`; pnpm treats the package name as a flat string, and routing through glob would silently change which packages a gate exempts. **Do not "fix" it.**
- **Version filtering is pure with a caller-supplied clock.** It drops versions younger than the cutoff and versions whose timestamp is missing or unparseable — pnpm's strict posture, that an unestablishable age is too young — while a version exactly at the cutoff is kept. It reads no wall clock and has no error channel.

**Consumer-side config readers are deliberately not resident here.** Reading the gate from workspace config keys or replayed hooks is config IO, a boundary concern; [@effected/workspaces](workspaces-catalogs.md#configdependencyhooks--the-opt-in-replay-seam) owns that assembly, and this pure module is the vocabulary those readers combine into.

## The service half: registry reads, tarballs and publishing

Three services replacing a shelled-out `npm` CLI wherever the work can be done structurally.

### NpmRegistry — reads over core HttpClient

Replaces every shelled `npm view`. A 404 is detected **structurally** from the typed HTTP error, not by matching an error code on stderr. Four decisions carry it:

- **The model is keyed by `(registry, package, version)`, and the registry is a per-call argument, never layer-baked.** The publish flow probes two registries for one package inside a single program, which is precisely what a layer-baked registry cannot express. This shape came from two shipped test doubles breaking: one keyed by package alone so it could not serve two versions, the other keyed by name alone so it could not answer for two registries.
- **404 is `Option.none()`, not an error** — extending the resolver contracts' `None`-is-success convention to registry reads, so the whole package answers absence one way.
- **`integrity` is typed as `IntegrityHash`**, not a bare string. The brand already lives here and already covers the form the registry stores, so typing it is free and kills a compare-two-strings-and-hope at the publish call site.
- **One error sized to the reads that exist**, discriminated by a transport/status/decode literal rather than a prose reason consumers match on.

The publish-times read deserves its own note: the registry's time document mixes per-version timestamps with two non-version keys, and every consumer that reads it raw re-derives that exclusion. **Making that split the schema's job** is why the result is a class rather than a bare record, and it feeds the release-age filter without an adapter.

**A per-version read falls back to the packument on a 405.** GitHub Packages answers the per-version endpoint with 405 regardless of credentials — not 404, not 401 — so a perfectly valid read failed as a transport-shaped error. The read now routes through the whole packument for that registry kind up front and **falls back the same way on a 405 from anywhere else**: the routing is by *observed behavior*, not by a vendor list, so a self-hosted registry with the same gap works without a code change. Two smaller facts inside it: the version is selected with `Object.hasOwn`, not a bare index, because the version number is caller input and a lookup for `constructor` must not read the prototype and hand back a "published version" that is a function; and absence stays `None` on both paths.

### PackageTarball — reading a published package back

The **inbound half** of the registry surface. `NpmRegistry` reads *metadata* and `PackagePublish` sends a tarball out; nothing read a published one back. The need is real and not served elsewhere: reading something out of a published package **before any install has run**, which is what a tool reproducing a package manager's config-dependency workflow must do, since its output is the input the install then consumes.

`extract` takes a `PublishedVersion` — the value `NpmRegistry` already answers — and yields the directory the tarball's fixed `package/` root unpacked into. Five decisions carry it:

- **The resource is `Scope`d, not owned by the caller.** The temp directory is a scoped make, so a caller reads what it needs and never owns cleanup. `Scope.Scope` in `R` is the honest signature for "this produces a thing that must be released".
- **Integrity is verified BEFORE extraction**, and before anything reads the contents. A poisoned intermediary — CDN edge, proxy, mirror — serving different bytes than the registry vouched for must never reach `tar` at all. Verification uses core's `Crypto` digest and core's `Encoding.encodeBase64`, so there is no module-private base64 encoder to drift.
- **The compare is padding-insensitive.** SRI permits an unpadded value, and a padding difference is not a byte difference; refusing a valid tarball over one would be the worse of the two failures.
- **An unverifiable integrity says so out loud.** The yarn cache-key form names no algorithm, and a registry may publish none at all — both log rather than silently pass, because a skipped verification and a passed one are otherwise indistinguishable in a log.
- **A non-2xx is caught before anything reaches disk.** Piping a 404 error page into `tar` surfaces as a misleading "could not extract" instead of naming the real failure; a downstream paid for that one.

**Loading the extracted file is deliberately not part of this surface.** A dynamic `import()` of a computed path is compiled into a context module by bundlers, and a kit-level loader would hand every bundling consumer that problem with no seam to fix it. The composition instead pairs this with [`resolveEntryPoint`](package-json.md#resolveentrypoint-exports-encapsulates-the-package) from package-json — pure, IO-free — and leaves the load to the consumer's own bundler-visible code.

**`TarballError` carries a `reason` discriminant** (`notFound | http | integrityMismatch | extractFailed`), and the `notFound` split is load-bearing rather than cosmetic. A consumer that cannot tell "this version legitimately does not exist" from "something went wrong fetching a version that does" must treat both the same way, and the resulting failure is silent: a downstream handled an integrity mismatch as a missing merge base, which downgraded a merge to a lossy algorithm and dropped a user's override **on a run that reported success**. That incident is the standing argument in this package against collapsing a failure set to one sentinel; [`UnresolvedEntryPointError`](package-json.md#resolveentrypoint-exports-encapsulates-the-package) is discriminated for the same reason on the other side of the same composition.

### RegistryCredential — the scheme is chosen once

Authentication is a **closed union**, `{ kind: "token" }` or `{ kind: "basic" }`, and both the read probe (`RegistryTarget`) and the publish (`PackagePublish.setupAuth`) take it. That replaced a bare `token` on both — a breaking change taken deliberately, because a probe and a publish that disagreed about the scheme authenticate differently against the *same* registry, and the observable symptom is the worst kind: a bearer probe against a basic-auth registry answers 401, which reads as "not published", so the publish proceeds on a false premise.

Three facts inside it:

- **The basic arm holds the ALREADY-ENCODED blob**, not a user/password pair. That is what npm itself stores in `_auth` and what registry configuration in the wild already contains; npm assigns the value straight to the `Authorization: Basic …` header with no decode. Splitting it back into a pair to re-encode would decode a secret for no purpose and is lossy in principle for a password containing `:`. `basicCredentialFromPair` exists for the caller who genuinely holds a pair — and it refuses a username containing `:`, because that separator is positional and unescapable, so minting the credential would authenticate as someone else.
- **The credential's kind picks the npmrc key.** npm reads both per registry — `_authToken` first, then `_auth` — so writing the wrong key is not an error, it is an unauthenticated publish. The header scheme follows the same discriminant.
- **The kind is span-annotated; the value never is.** "Which scheme did we use" is exactly the diagnostic a failed auth needs, and it is not a secret.

**`RegistryTarget.token` survives one minor as a deprecated `never` — a tripwire, not an alias.** Dropping the renamed field outright would have been a **silent** break rather than a loud one, which a consumer caught before it shipped: callers pass the field through a conditional spread (`...(token !== null ? { token } : {})`), and a spread of a no-longer-known property is *not* an excess-property error, so the field simply vanishes and an authenticated probe becomes an anonymous one. Against a private registry that answers 401, `NpmRegistry.version` reads that as "not published" — and a publish flow acting on it republishes a version that already exists. Typed `never`, the same spread fails to compile. An alias would have kept the silent path compiling, which is why this is `never` and not `Redacted<string>`; the generalizable rule is **rename a field to `never` when the old spelling can be dropped without a compile error at the call sites that actually have it.**

### NpmExecutor — cache redirection as typed API

`NpmExecutor` carries `withCacheDir` and a generic `withExtraArgs`. The cache redirect is API rather than tribal knowledge for a specific reason: **GitHub's macOS runner images ship a partially root-owned `~/.npm/_cacache`**, and current npm hard-fails with `EACCES` before doing any work when it sees root-owned files in its cache — so every `view` / `pack` / `publish` on such a runner dies until the cache is pointed somewhere the job owns. Setting `npm_config_cache` in the environment works identically and npm honours it in every dispatch form, but it is **invisible at the call site**, which is how the fix gets lost in a port and rediscovered the hard way. Naming it puts the reason in the `.d.ts`.

**The redirect OVERRIDES a deliberately configured cache, and the combinator stays dumb about it.** A `--cache` flag in argv outranks both `npm_config_cache` and any npmrc setting, so an unconditional call also overrides a self-hosted runner pointed at a warmed cache on purpose. The alternative — consult the environment and only redirect when nothing else is set — was rejected: a value transformation that reads ambient state cannot be reasoned about from the call site, and `NpmExecutor` being an inspectable `Schema` class is worth more than the convenience. **The precedence is documented and the caller makes the check**, which is the same division the rest of this package takes between mechanism and policy.

`withExtraArgs` is the generic vent for the flag this package has not named, so a consumer needing one does not wait for new API; it **replaces rather than accumulates**, so a copy is a complete statement of its own flags. Both are copy-returning, matching the rest of the value's shape.

### RegistryKind — one classification, not four predicates

A single exhaustive classification replaces a family of boolean predicates, so a consumer `switch`es rather than composing booleans that can disagree — the prior art had one call site asking two in sequence and another negating a third to mean "everything else". **The domain match is exact-or-subdomain with a leading dot**, because a bare `endsWith` classifies a lookalike domain as the public registry, and that classification decides whether a token is sent. The same classifier decides which read path applies and whether the provenance flag is passed, since npm rejects that flag against non-npm registries and a release publishing to three registries should not lose two of them to one flag.

**The label projections ship, as two projections rather than one canonical name.** A consumer rendering the same registry as "github" in a table row and as "GitHub Packages" in a sentence is not disagreeing about canonicity — it wants both spellings, in different places, which is why withholding a display name on the grounds that no single string serves everybody was the wrong reading. Three functions ship: `registryShortLabel` (`npm`, `github`, `jsr`, else the host), `registryDisplayName` (`npm`, `GitHub Packages`, `JSR`, else the host) and `registryHost`, the shared fallback.

Three rulings inside them are the reason they are worth a note:

- **The host fallback keeps the port**, unlike the hostname the classifier compares: two custom registries differing only by port are different registries, and a label that collapsed them would be actively misleading in a publish report. A value that will not parse as a URL degrades to scheme-and-path stripping, because npm config carries both URLs and bare hosts.
- **They are functions over the registry string, not a `RegistryKind` lookup table.** That is forced rather than chosen — `"custom"` has no fixed label, it renders as its own host — and it is what keeps the leading-dot domain guard applying to the labels too, so a look-alike host cannot borrow the `npm` label in a report.
- **The two differ on nullish input, deliberately.** `registryDisplayName` accepts absent-or-empty and answers `npm` explicitly, because "no registry configured" is a real state where prose is rendered. `registryShortLabel` takes a plain `string`, so a nullish value is a compile error rather than a silently absorbed wiring mistake — its callers always have a registry in hand.

### PackagePublish — the npm CLI through @effected/commands

**The executor dispatch collapses into one value.** A repeated per-method package-manager option whose only job is choosing between an ambient npm and a fetch-and-run launcher becomes a single `NpmExecutor` value (ambient or dlx), because [@effected/commands](commands.md) already models fetch-and-run a package binary. OIDC trusted publishing needs a *fresh* npm rather than the runner's bundled one, so the launcher must be reachable — and `dlx` **fails typed when no launcher is available** rather than degrading to the ambient npm, because degrading reintroduces the exact OIDC failure the pinned spec exists to avoid, invisibly.

Every invocation goes through commands' `Run`, whose JSON form parses **and** schema-decodes so the two failure modes stay distinguishable. A non-zero exit is already a typed command failure; the dry run deliberately catches it and reports a negative result, because **a failed dry run is a valid answer rather than an error**.

**Token masking is hoisted, and the npmrc write is kept.** Auth setup takes a [`RegistryCredential`](#registrycredential--the-scheme-is-chosen-once) carrying `Redacted` values and masks nothing — the caller masks, because an Actions edge inside a publish library is a layering smell. What is **not** dropped is writing the auth token into an npmrc rather than passing it on argv: redaction protects this kit's error messages, not the operating system's process table, so keeping the token off argv stays the security-correct choice. The npmrc path is a **caller-supplied argument**, because resolving a home directory needs a `node:` import a boundary package may not make.

A fused probe-then-publish convenience is deliberately absent. The composition it would replace — pack once, then per target read the published version, compare integrity and publish the tarball — is consumer composition, and the fused form hardcoded one registry and could not recover from a partial multi-registry publish.

### Service conventions

Both services follow the kit's non-negotiables: all-effectful shapes, `static readonly layer` using `this`, named spans on public boundaries carrying package name, registry host and version — **never a token, never argv**. Service `R` is discharged at construction: the commands requirements are resolved in `make` and provided there, so every method's `R` is `never`. The next kit service built over commands will hit this identically.

Two doubles ship, because they are different tools: a `layerTest` taking a partial shape with unstubbed members dying loudly, and a `layerSeeded` working fake registry keyed on the full `(registry, name, version)` axis — the shape the broken call sites were hand-rolling.

## Vocabulary registry

Four packages — npm, package-json, lockfiles, workspaces — operate around overlapping npm concepts. **API ships on evidence, the registry ships the map**: an unmodeled concept stays unmodeled until a consumer materializes, but nobody rebuilds an idiom for not knowing its home.

**Standing assignments.** Versions and ranges → [@effected/semver](semver.md). Manifest shapes → [@effected/package-json](package-json.md). Lockfile shapes → [@effected/lockfiles](lockfiles.md). Workspace and monorepo semantics → [@effected/workspaces](workspaces.md). Cross-cutting scalars that flow between those concerns → here.

Anything not modeled is **preserved verbatim** — package-json rides unmodeled manifest keys in its `rest` catch-all, and the lockfiles parser normalizes into one model rather than mirroring every field. The default answer to "where does field X live" is therefore "preserved by package-json, unmodeled until a consumer asks"; the entries below are the ones where that answer is wrong or non-obvious:

| Concept | Home / note |
| --- | --- |
| `dependencies` and its three siblings | package-json models the maps; the **specifier grammar and section vocabulary are here** |
| `publishConfig` | modeled **twice, deliberately** — package-json's field and workspaces' own, an accepted duplication because `WorkspacePackage` is deliberately tolerant and takes no package-json edge |
| `packageManager` | package-json owns the *field* codec; the field-independent pin grammar is `PackageManagerPin` here, and both integrity halves share `CorepackIntegrityHash` here |
| `workspaces` | workspaces **reads** the globs and bun-style catalog keys without modeling the field; package-json preserves it. Trigger for modeling: a consumer needing to *write* it |
| `devEngines` | package-json models it; workspaces separately reads it as a detection hint |
| `license` | package-json, delegating real validity to [@effected/spdx](spdx.md) |
| legacy v1 `package-lock.json` | **not parsed** — the parser requires the modern packages map, and a v1-only lockfile fails typed |
| lockfile entry `resolved`, tree-membership flags, install-script flags | **discarded** in normalization. Trigger: provenance, install-tree or audit tooling |
| lockfile entry manifest mirrors (`bin`, `license`, `engines`, …) | discarded — package-json is the source of truth |

## Testing

Suites in `__test__/` per concept. The resolver surface is contracts, so those tests are light: the no-op layers answer `None`, a stub implementation proves the contract is implementable, and the resolution error preserves its structured cause.

The vocabulary tests carry the weight — specifier classification across the protocol set, the round-trip property, the resolution projections, the section mapping, integrity across all three forms, and the release-age gate's strictest-wins/union/totality, matcher parity and cutoff boundary cases. The manifest suite drives the tolerance boundary in both directions, plus resolution over stub resolver layers.

Registry reads run against a stubbed `HttpClient` — core-declared, no platform package — and publishing runs against commands' scripted-spawner fixture, which records argv, so **"the token never reached argv" is an assertion, not a hope**.

The tarball suite is where [`@effected/memfs`](memfs.md) enters as a devDependency: verification and extraction are claims about bytes on a volume, and the fault-injectable in-memory volume is what lets a write failure be a *test input* rather than a stub body. Its discriminating claims are the ordering ones — that a mismatched digest fails **before** anything is written, and that a non-2xx never reaches the extractor — both of which pass against a naive implementation until the assertion is about ordering rather than outcome.

Each claim this doc calls load-bearing was proven by deliberate mutation and observed red — the lookalike-domain guard, 404-as-absence, `dlx` refusing to degrade and the reachability test itself among them. A guardrail nobody has watched fail is prose.

## Deferred

**Packument caching.** Several reads fetch the same document, and the per-version read's packument fallback made that redundancy one call site larger. The fix is unchanged — a core `Cache` keyed on registry and name, with the failure and absence TTL rules the commands work established — and the trigger is a consumer's call pattern showing the waste, not the redundancy itself.
