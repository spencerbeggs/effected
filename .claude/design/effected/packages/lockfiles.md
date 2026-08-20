---
status: current
module: effected
category: architecture
created: 2026-07-10
updated: 2026-08-20
last-synced: 2026-08-20
completeness: 96
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../package-setup.md
  - jsonc.md
  - yaml.md
  - semver.md
  - npm.md
  - workspaces.md
---

# @effected/lockfiles design

## Overview

`@effected/lockfiles` is lockfile parsing as pure string→model decoding. It holds the four package-manager lockfile parsers — bun's JSONC, npm's JSON, pnpm's YAML and yarn Berry's YAML — the unified `Lockfile` model they all normalize into, and pure integrity checking of that model against workspace manifests.

Its consumer is [`@effected/workspaces`](workspaces.md), whose `LockfileReader` service does the root find, package-manager detection and file read, then calls into this package. It is on the [release gate](../releases.md#the-gate) because workspaces reads lockfiles and downstream tooling consumes workspaces transitively.

## Tier and dependencies

**Pure tier.** No services, no layers, no IO, no `R` anywhere. A lockfile parser that reached for the filesystem would be boundary tier, so the IO stays out **by construction**: every entrypoint takes content as a string, and integrity checking takes manifests as input rather than reading them.

Peers are `effect` plus four pure-to-pure `workspace:^` edges — [jsonc](jsonc.md) for bun, [yaml](yaml.md) for pnpm and yarn Berry, [semver](semver.md) for integrity's range satisfaction, and [npm](npm.md) for the shared specifier, dependency-field and integrity-hash vocabulary. Each is mirrored by a plain `workspace:*` devDependency; the two specifiers deliberately differ so a published patch floats.

Zero external runtime dependencies — the text-parsing engines arrive through the sibling packages, so unlike glob and toml **there is nothing to vendor here**.

## The two seam properties

Two responsibilities that a naive extraction would split across parser and reader are structural properties of this API instead.

### pnpm importer-path→name resolution is an explicit second stage

pnpm lockfiles name workspace packages by importer *path*, with a placeholder version; the real names live in the `package.json` files. Both stages of the resolution are pure and explicit:

- `Lockfile.parse` emits the honest importer-path-keyed model for pnpm, and the already-name-resolved model for the other three, whose lockfiles carry real names.
- `withImporterNames(names)` — a total, pure instance method — rewrites workspace package names **and both ends** of workspace dependency edges from an importer-path→name map. Entries not in the map keep their path name, and non-pnpm lockfiles are unaffected.

The manifest IO that builds the map is the consumer's job, not this package's.

### Integrity checking is total and pure

`LockfileIntegrity.compare(lockfile, manifests)` takes the manifests as values and returns the report **infallibly** — a plain function, no `Effect`, no error channel. Unparseable ranges and versions, and the `workspace:`/`link:`/`file:` specifiers, are skipped, because constraint checking is best-effort by design; totality therefore costs no behavior.

It is named `compare`, not `check`, because every v4 `Schema.Class` already carries a reserved `static check(...)` for attaching schema checks — a naming constraint every domain static in the kit must dodge.

The manifest input is a **minimal structural schema** of its own, deliberately *not* [package-json](package-json.md)'s types: those live in a heavier boundary-tier package this pure one stays decoupled from, and structural typing lets a consumer pass values derived from either.

Integrity keeps **every** resolved version per name, so a constraint is satisfied when *any* parseable resolved version matches — never dependent on lockfile entry order — and an unsatisfied row reports all candidates.

## Module layout

Module-per-concept, with the value classes as leaf modules so the parser internals and the `Lockfile` dispatcher can both import them without closing a cycle. The format literal set lives in its own module alongside the filename functions in both directions, since filename knowledge is lockfile domain.

The per-format **raw schemas stay private** under `internal/`: they are permissive validation scaffolding, not API. Each internal transform returns a raw failure record, and the public parse error — with the format attached — is materialized by the dispatcher, which keeps the error class in the public module without an import cycle back into the internals.

## The supported input domain

The package parses **pnpm `lockfileVersion` 9+ and npm `lockfileVersion` 3+**;
an older format fails typed. This is a **deliberate narrowing of the supported
input domain**, recorded as contract rather than implementation detail: a
consumer parsing some other repository's older lockfile now receives a typed
failure by design, not by accident. Pre-v9 pnpm and pre-v3 npm record
resolution in shapes this model does not describe, and parsing them would hand
a consumer rows that silently cannot answer a resolution question — the exact
failure class the rest of this document exists to remove.

Three properties make the gate honest:

- **It is on the lockfile *format* version, and the docs say so.** A lockfile
  records no package-manager version, and the mapping is many-to-one — pnpm 9,
  10 and 11 all write format `9.0`, and npm wrote format `3` long before npm
  11. A "requires pnpm 11+" claim is therefore unenforceable by any means, so
  the contract is stated in format terms and the manager versions are listed
  separately as *what the suite is tested against*. A support claim the gate
  cannot back up is the same docs-disagree-with-behavior defect as a stale
  one, merely pointing the other way.
- **It reads the version and nothing else.** Not whether `snapshots:` exists,
  not whether it has entries: a dependency-free v9 workspace legitimately
  records zero snapshots, and an emptiness guard would reject that valid
  lockfile. Both directions are mutation-checked — replacing the version gate
  with an emptiness guard turns the suite red.
- **The cause is a public type, narrowed by a public predicate.**
  `LockfileParseError.cause` is `Schema.Defect` because it must carry whatever
  the delegated engines throw; that channel is genuinely open and widening it
  to a union would misrepresent it as exhaustive. So the *record* is exported
  as a type with an `isUnsupportedLockfileVersion` predicate beside it, which
  is what makes "discriminate on the tag, never parse the message" a claim a
  consumer can actually typecheck rather than an instruction they satisfy with
  a cast. The predicate reads the discriminant as an **own** property, so a
  foreign throwable that inherits one is not reported as a too-old lockfile.
  It is deliberately **a plain tagged record, not a `TaggedError`**: extending
  `Error` makes `message` non-enumerable, so a consumer round-tripping the cause
  through `JSON.stringify` — which is how a cause reaches a log line or a CI
  annotation — would silently lose the one field explaining the failure. The
  cause is data being carried, not a throwable being raised, and it is shaped as
  data.
- **It fails through validation, not framing.** The document was located
  perfectly well, so this is a shape judgement about a located document. The
  failure is a `LockfileParseError` at `stage: "validation"` carrying a
  structured `UnsupportedLockfileVersion` cause, so a consumer can distinguish
  "too old" from "malformed" without parsing prose. No `FramingReason` literal
  was added; that public union stays closed at three.

bun and yarn are ungated, recording no comparable format-version line.

## The model

`Lockfile` is a `Schema.Class` carrying the format, the lockfile version, the resolved packages, the workspace dependency edges, the importers and an optional per-format extension. See `src/Lockfile.ts` for the full shape.

`Lockfile.parse` is the package's **only fallible boundary**. Everything else is total: the importer-name rewrite, name and importer lookup (both backed by lazily built private indexes outside the schema — the array fields stay for serialization and iteration), the workspace-packages getter and integrity comparison.

Three vocabulary decisions point outward rather than re-declaring shapes: a resolved package's integrity is [npm](npm.md#the-vocabulary-modules)'s branded hash — an unparseable checksum is dropped rather than thrown, and the brand's yarn cache-key form is what keeps yarn Berry's checksums from silently vanishing; the dependency-type fields use npm's shared field literal; and the pnpm extension exports its catalog record type so workspaces types against it instead of re-declaring the shape.

### A row is an instance, not a package

`ResolvedPackage` rows are package **instances**. npm and bun always were —
one row per lockfile key — but pnpm's rows were per *declaration*, and that
inconsistency was the bug behind the model's inability to answer any
resolution question. The model is now coherent across all four formats, which
is what lets one format-agnostic algorithm live downstream.

Two fields carry it. **`instanceId`** is the format's own canonical identity,
verbatim and **opaque**: pnpm's snapshot key, npm's full entry key, bun's
`packages` key, yarn's locator. No scheme is synthesized, because every format
already has one and the only thing discarding it bought was ambiguity. It is
required, not optional — 0.x, and the one kit dependent never constructs a
`ResolvedPackage`. **`resolved`** maps a dependency (and, where the format
records it, peer) name to the `instanceId` that name resolved to *in this
instance's context*.

### `publishConfig.linkDirectory`: the target is a directory, the identity is the package

pnpm's `publishConfig.linkDirectory` records a workspace link against the
package's **publish directory** rather than its root:
`link:../bundler/dist/dev/pkg`, where `packages/bundler` is the importer. That
target is a build output, so it is no importer and never will be. Normalizing
against the linking importer's path — the rule that made a bare `link:../lib`
work — cannot reach it, and neither can renaming importers: the target is not an
importer path at all.

Left alone, every workspace edge in such a repository lands in
`unresolvedEdges`, which one layer up makes `PeerCheck` report
`unverified: ["unresolvedEdge"]` **permanently**, on a workspace `pnpm peers
check` calls clean. That is not a gap a consumer can work around by trying
harder; it is the whole report declining, forever, for a documented pnpm
feature. Found by a live consumer run, not by a fixture — no fixture contained a
`linkDirectory` workspace.

So a `link:` target that is no instance id resolves to the **longest ancestor of
the target that is an importer path**, and the rule is fenced on both sides:

- **Only under a `workspace:` specifier.** The specifier is the evidence, not
  the path shape. Under `workspace:*` pnpm resolved the edge through the
  workspace, so the target directory is known to belong to a workspace package.
  A hand-written `link:../lib/vendor/stub` names a directory pnpm never claimed
  was a workspace package — it may hold a vendored stub with its own identity —
  and attributing it to whatever importer encloses it would answer with the
  wrong package's peers. A wrong edge, which this layer never emits, in place of
  an honest gap.
- **Never the root importer.** `"."` is an ancestor of every path in the
  workspace, so admitting it would resolve every stray link to the root.

The snapshot path deliberately does not do this. A snapshot body records
`name: link:<path>` with no specifier beside it, so the evidence the rule turns
on is not available there — and the reproduction's edges were all importer edges
under `workspace:*`, checked before the cut was chosen.

### A gap is safer than a lie — but only in this layer

`resolved` omits an edge it cannot name, and that rule is right *here*: no
consumer is ever handed a wrong edge. It does **not compose upward**, and that
is worth stating as a rule rather than as an anecdote.

A consumer that treats an absent edge as evidence of *absence* converts this
package's gap into its own lie. `@effected/workspaces`' peer check did exactly
that: a `link:`-satisfied peer whose identity this package could not compose
produced no edge, and one layer up "no recorded provider" read as "unsatisfied
peer" — a false positive reported against a peer that was satisfied. The
verified-only guarantee held perfectly and the answer was still wrong.

**The transferable rule: a package that omits data on uncertainty owes its
consumers a way to tell "absent because nothing is there" from "absent because
I could not name it."** Widening what legitimately matches — as the `link:`
normalization does — shrinks the second category but does not remove it: a
`link:` into a build-output directory names no instance at all, and no
normalization can invent one.

That obligation is discharged by **`unresolvedEdges`**, a sibling field naming
the dependencies whose edge the lockfile records and this model could not name.
`resolved` deliberately stays a clean name→instanceId lookup with no union to
handle, and the uncertainty lives where a consumer must opt in to reading it.
The population rule is the whole point and is easy to get backwards: only a
**recorded** edge that compose-then-verify declines belongs there. A dependency
the lockfile does not record is an absence — npm and bun therefore contribute
nothing, since their sections are declarations resolved positionally. A
fail-closed signal that fires constantly is a signal nobody reads.

This is the second instance of the same inversion, after the importer-join
ambiguity skip, and both were found by someone else asking what happened on a
path the author had not pictured.

The invariant that makes `resolved` trustworthy: **every edge is verified
against the lockfile's own id set before it is emitted, and an edge that
cannot be named honestly is omitted.** A composed pnpm id that matches no
snapshot, a `link:` target outside the workspace, an npm dependency npm never
recorded — all absent rather than plausible. An absent edge is a visible gap a
consumer can handle; a wrong one is exactly the silent-wrong-answer class that
[the npm defects](#known-limitations) were.

How each format is read:

- **pnpm** splits per-version metadata (`packages:`) from per-instance
  resolution (`snapshots:`) at lockfile v9. Rows follow `snapshots:`, joining
  peer declarations back on from the matching `packages:` entry, so two
  peer-resolved variants of one `name@version` are two rows — correctly, since
  they genuinely are two instances. A `packages:` entry no snapshot covers is
  emitted as an orphan carrying no resolution rather than dropped. Importer
  rows resolve registry versions by composition and `link:` targets by
  normalizing against the importer's own path — and, when the normalized target
  is no importer, by the `linkDirectory` rule below.

- **npm and bun** resolve positionally: both encode install position in the
  key, so resolution is replayed by walking outward from the depending
  package's own position, **deepest-first, first hit wins**. Direction is the
  whole algorithm — outermost-first returns the hoisted copy and silently
  mis-reports every shadowed dependency, which is why the suite mutation-checks
  it. bun's parent chain is read off the key space rather than split on `/`,
  since scoped package names contain slashes.
- **yarn** resolves through the lockfile's own descriptor→locator index: every
  key enumerates the descriptors that resolve to that entry, so the lookup is a
  read, not a reconstruction. Peer edges are deliberately **not** emitted —
  yarn resolves peers virtually and the lockfile does not record which virtual
  instance satisfied which peer.

### Peer declarations

Every format records peer declarations, and the model carries them: a
`peerDependencies` range map plus a `peerDependenciesMeta` flag map, both
defaulting to `{}` at construction and on decode. **An absent section is an
empty record, never `undefined`** — "declares no peers" is a fact, not a gap,
and a consumer that has to null-check before every read will eventually forget.

The fields hold **declarations only** — what a package *asks for*. What
actually resolved is the separate question [`resolved`](#a-row-is-an-instance-not-a-package)
answers, per instance and verified-only; the two are deliberately different
fields because a declaration is always a fact while a resolution can be one the
model cannot name.

The one normalization worth naming: the optional flag has two upstream
spellings. pnpm, npm and yarn Berry write a `peerDependenciesMeta` object;
bun writes an `optionalPeers` **array of names**, on package tuples and
workspace entries alike. Both collapse into `{ optional: boolean }` per peer in
one shared internal helper, so a single consumer algorithm serves every
manager. A peer with no meta entry is required.

Two per-format facts are contract, not incident, both probed against the live
tools rather than inferred:

- **pnpm records no peer declarations for workspace projects.** Its importer
  sections carry resolved dependencies only, with or without
  `autoInstallPeers`; `pnpm peers check` correspondingly never reports a
  workspace project's own unmet peers. pnpm workspace rows therefore keep the
  empty defaults, and a consumer wanting them must read the manifests.
- **yarn is populated but not consumed by the downstream peer check.** Yarn is
  out of scope for [silk-update-action](../consumers/silk-update-action.md)'s
  feature, but populating it is nearly free and a normalized model that
  silently drops one format's data is a trap for the next consumer.

bun's tuple index 2 is read *out of band* — decoded through a permissive schema
whose failure is a skip, not a parse error — because the tuple shape is
under-documented upstream and an unexpected info object must not cost a
consumer their whole lockfile.

The filename functions distinguish **detection vocabulary from parse routing**: one format can be written under several filenames (a shrinkwrap, a binary variant), so the plural form lists them primary-first while the reverse lookup answers for the primary names only. Workspace-config extras are a consumer's cache policy and stay out.

### The parse error

One error class, carrying the format, a `stage` literal distinguishing a text-level parse failure from a schema-shape failure, and a structured cause preserving the underlying engine error. Malformed input is a recoverable typed failure, **never a defect**.

It carries **no path field** — parse takes content, not a path, and the caller that did the IO owns the path context. The read error lives in workspaces with the reader service.

## Document framing: a lockfile is a YAML *stream*

A lockfile is not always one YAML document. pnpm writes its lockfile as **two YAML documents** when the workspace uses config dependencies: an "env" preamble, then the lockfile. This repo's own lockfile is that shape.

Both documents declare the same top-level keys, so the preamble **validates cleanly** against the pnpm schema — a single-document parse *succeeds* and returns a `Lockfile` with one package and no workspace importers, reporting an apparently empty workspace. That silent success is the defect this rule closes.

**The framing rule is deterministic, not a heuristic.** pnpm's own writer composes the file as env-prefix followed by the main document, so the preamble is always a *prefix*, never a suffix: **the lockfile is the LAST document, by the writer's contract.** No structural rule would work — both documents carry the same keys, so "the document with importers wins" picks the preamble just as happily. Position is the only sound discriminator. `src/internal/documents.ts` owns this, selecting over the parsed stream by position, which additionally keeps readable a normalized single-document lockfile carrying a leading marker that a byte-sniffing rule would misread as env-only.

The other three parsers were **checked, not assumed**. yarn shares the YAML shape but defines no document framing, so a multi-document yarn lockfile fails typed rather than being silently truncated to its first document — where the format states no rule, this package refuses to guess. npm and bun never share the hazard, because a second top-level value is a syntax error in both engines; the suite pins that rather than assuming it.

The framing error carries the format, the document count and a reason, and **no cause** — the text parsed fine, so there is no foreign throwable to wrap.

The invariant: **an unlocatable lockfile fails typed; it can never return an empty `Lockfile`.** The transferable lesson, mutation-checked in the suite: a parser that succeeds on the wrong input is worse than one that fails, and "empty result" is the most dangerous success shape because it is indistinguishable from a legitimate empty answer.

## Importers

The importers field records each workspace importer's *declared* dependencies — the data a before/after lockfile diff needs, which is what its driving consumer ([silk-update-action](../consumers/silk-update-action.md)) parses two texts through the pure boundary to compare. Two leaf value classes back it.

**`ImporterDependency`** holds one declared dependency. Its specifier is [npm](npm.md#dependencyspecifier)'s branded specifier via that package's string codec, so a decoded value is tag-matchable while **encoding round-trips the exact original string** — the brownfield guarantee. Its version is **pnpm-only**, because pnpm records a specifier-and-version pair per importer dependency while bun and npm record resolved versions on package entries, so consumers there join by name against the packages array.

That version is always the **plain** version: pnpm's peer-disambiguation context is split off into a separate optional `peerSuffix` field holding the raw parenthesized chain — which is what lets a consumer recompose an importer dependency's instance identity rather than guess at it, and `link:`/`file:` resolutions pass through verbatim. The split has **one implementation** in `internal/shared.ts`, shared with the pnpm package-key parser, so the two cannot disagree about where a version ends.

**`LockfileImporter`** holds the root-relative importer path — the same keys the consumer's own importer map uses — plus the dependencies.

Three behaviors are contract, not incident: pnpm, bun and npm populate importers off a shared dependency-sections table; **yarn always yields an empty array**, documented behavior since yarn records no importers; and the importer-name rewrite deliberately **does not touch importers**, because they stay keyed by path, which is the join key. Construction uses conditional spreads for the optional fields, since v4's validating constructors throw on an explicit `undefined` for an optional key.

The specifier taxonomy comes from npm rather than package-json because npm is the pure vocabulary package built to be shared. See the [npm vocabulary registry](npm.md#vocabulary-registry) for what this package keeps and discards from each lockfile format.

## Hardening

The [input-hardening standards](../effect-standards.md#input-hardening-standards) apply, and this package's position is unusually good: **it adds no new text-parsing engine and no new recursion surface.** Text parsing is delegated to already-hardened siblings, with npm's native parse wrapped so its throw on hostile input lands in the typed channel. The transforms are single-pass iterations over flat records.

What the transforms still owe:

- **Prototype-pollution discipline.** Lockfile keys are attacker-adjacent strings. Key-bearing intermediates stay `Map`s and `Set`s, records are built with own-property semantics rather than manual assignment, and the hostility suite proves a dunder key neither pollutes nor crashes.
- **Total string surgery.** The `name@version` splitters, yarn's descriptor extractors and the dependency cleaners stay total — malformed keys are *skipped* or fail validation, never throw. Rows that would construct a non-empty string from an empty one are skipped, since v4's validating construction would otherwise turn malformed input into a defect at construction time.
- **Scope honesty.** Yarn support is **Berry only**. Classic v1 content is not YAML; whether it happens to parse or not, it must exit through the typed parse error and never mis-normalize. A fixture pins this.

## Observability

Pure-tier house rule: a named `Effect.fn` span on the single public fallible boundary and nothing else. The total methods are span-free. Operational logging belongs to the consumer's reader, which owns the IO story. No metrics, telemetry-agnostic.

## Testing

`@effect/vitest`, `it.effect`, `assert.*` — never `expect`. No platform packages, no mock layers, no `TestClock`. Four families:

1. **Per-format fixture tests** across each manager's lockfile versions, asserted against the unified model — package identification, integrity, workspace dependency edges and extension payloads.
2. **Seam-property tests** — the importer-name rewrite renames pnpm workspace packages and rewrites both edge ends while leaving unmapped entries, non-pnpm lockfiles and importers untouched; integrity comparison covers the valid, missing, extra, unsatisfied and skipped cases, fed by in-memory manifests, so **there is no IO anywhere in the suite**.
3. **A hostility suite** — malformed text and wrong shape each landing on their own stage, yarn classic content, dunder and hostile `name@version` keys, plus nesting bombs proving the delegated engines' typed failures surface through this package's error. The document-framing tests are **mutation-checked**: reverting the framing rule or disabling a guard turns them red.
4. **Codec round-trips** via `it.effect.prop` over derived arbitraries, asserting encode-decode identity, since the model is API for serialization consumers.

## Build and scaffold

Per [package-setup.md](../package-setup.md): scaffolded from a pure sibling, model paths under `website/lib/models/lockfiles`. The model and error classes are class factories, so `savvy.build.ts` carries the narrow `_base` suppression per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories). Because it has workspace peers, the package needs a `prepare` script so turbo's upstream-build ordering applies.

## Consumer contract

[`@effected/workspaces`](workspaces.md)' `LockfileReader` finds the root, detects the package manager, reads the file — its read error stays there — and calls `Lockfile.parse` **directly**, because document framing is this package's job, not the reader's. For pnpm it then reads the workspace manifests and applies the importer-name rewrite; integrity is manifest IO plus the comparison; resolved-version lookup is the name index.

Workspaces defines its **own** package-manager literal rather than aliasing this package's format literal. The two are structurally identical and assign freely, but they are different concepts — which manager drives this workspace, versus which lockfile grammar to parse — and a separate name avoids colliding with [package-json](package-json.md)'s package-manager class in a consumer's imports.

## Known limitations

- **The importer-name map carries names only.** pnpm workspace packages keep their placeholder version after the rewrite. If a consumer needs real versions in the model, the map value can widen to carry one.
- **Bun's package-tuple shape is under-documented upstream**, so integrity is read from an assumed tuple position. The permissive reading is kept, pinned by a fixture from a current bun release.
- **Two npm defects are fixed, and both were live in published 0.5.1** — both
  silent-wrong-answer class, and neither was reachable by any test the package
  had, which is why they survived a release. A
  nested entry (`node_modules/express/node_modules/debug`) used to be *named*
  `"express/node_modules/debug"`, because name derivation stripped the first
  `node_modules/` prefix rather than the last; and an entry nested under a
  workspace directory (`packages/lib/node_modules/react`) used to be dropped
  entirely, because the branch condition tested for a `node_modules/` *prefix*
  that such a key does not have. The second is the worse one: the model
  reported a workspace's shadowed dependency as absent, which a peer check
  would read as an unmet peer that is in fact satisfied. Both reproduce against
  generated fixtures, both are now pinned, and no fixture previously exercised
  either shape.
- **The pnpm root importer (`.`) is not a package row.** Only non-root
  importers become workspace rows, so the root importer's own resolution is
  not represented in `packages`. This is load-bearing for a consumer that
  reports per importer — the root is one — and is called out here so a
  downstream designs around it rather than discovering it.
- **yarn carries no peer edges** (see above) and its `resolved` is dependency
  edges only. Documented gap, not an approximation.
