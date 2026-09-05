---
status: current
module: effected
category: architecture
created: 2026-07-28
updated: 2026-09-05
last-synced: 2026-09-05
completeness: 95
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - ../releases.md
  - ../roadmap.md
  - config-file.md
  - semver.md
---

# @effected/schemastore design

## Overview

`@effected/schemastore` builds, validates, versions and publishes JSON Schema documents generated from Effect Schema sources, in the shape SchemaStore and its consuming toolchain — vscode-json-languageservice, redhat's yaml-language-server, taplo, tombi, IntelliJ — expect, plus the catalog-entry and editor-association artifacts around them.

The division of labour with core is the package's organizing idea: **core owns the generation pipeline, this package owns the SchemaStore shape around it.** Core's `Schema.toJsonSchemaDocument` produces Draft 2020-12 and `JsonSchema.toDocumentDraft07` lowers it; everything this package does is assembly, annotation admission, versioning, lint, validation and IO on top of that.

The package's context files are authoritative for the as-built surface of each module (`packages/schemastore/CLAUDE.modules.md`, reached from the package `CLAUDE.md`); this doc records the design decisions and their rationale.

## Scope fence

`@effected/json-schema` is **off the roadmap entirely** — core's `JsonSchema` module made it redundant. This package must stay the narrow publication, catalog, versioning and lint layer and **must not grow into a general JSON Schema package**. Anything that smells like schema construction, ref resolution beyond the document's own `$defs` pool, or dialect conversion belongs to core's `JsonSchema`, not here. This is an explicit non-goal, not a deferral, and the ajv dependency does not widen it: ajv is the validation gate, not a construction or conversion surface.

Also out of scope: generating positive and negative test fixtures, submitting PRs to SchemaStore (the package produces artifacts, humans submit), and presentation formatting beyond canonical JSON.

## Tier and dependencies

**Integrated tier.** `effect` is the only peer. `@effected/semver` is a **regular dependency, not a peer** — no `SemVer` type surfaces in the public API — backing both version ordering and label validation. `ajv` is a regular dependency backing the shipped validator.

**ajv is the only third-party runtime dependency and the sole reason the package is integrated** — which is also the guardrail: a second one is a fresh decision, not a free ride on this one. All IO lives in `SchemaFile` over core `FileSystem`/`Path` required in `R`, and every other module is pure; the tier reflects the engine in the graph, not leaked IO.

There is deliberately **no `@effected/glob` edge**: the fileMatch hygiene lint is pattern-*shape* analysis and never matches a pattern against a path, so structural checks suffice.

## What SchemaStore's contract requires

The constraints the emitted artifacts must satisfy, which is why several decisions below look arbitrary in isolation:

- **Draft-07 is the dialect.** Later drafts are explicitly not recommended by the store until language-server support improves, which is what makes the 2020-12 → Draft-07 lowering the correct pipeline rather than a legacy accident.
- **ajv strict mode is the gate.** Non-strict is a per-schema opt-out in the store's own validation config, so a package owning the SchemaStore shape has to have a story for real-engine validation.
- **Versioned schemas are separate files** suffixed with the version, plus a version map in the catalog entry whose top-level URL points at the latest. Unversioned schemas are a single plain-named file.
- **`fileMatch` patterns must avoid generic names** and use simple glob constructs, with alternations expanded into multiple simple patterns.
- **Language servers consume non-standard keyword families** — the vscode set by exact name, plus the taplo, tombi and IntelliJ prefixes. These must be able to ride from Effect Schema annotations into emitted documents, and they interact with the ajv gate, because unknown keywords fail strict mode. Since Effect rc.112 the riding is core's own behaviour (see [annotation carrying](#annotation-carrying-core-carries-the-keywords-the-package-owns-admission)); what stays this package's problem is *which* families it will admit and emit. **The declared registry is no longer entirely derived from the store.** It splits into two groups: the upstream language-server families above, mirrored from SchemaStore's own CONTRIBUTING, and a second group this package owns outright — the house `x-ai-` machine-annotation namespace, a family with no upstream sanction at all. No tool submits `x-ai-*` documents to schemastore.org today; the family is intended for self-hosted publication, and a document carrying it that is later submitted upstream needs a corresponding entry added to that repo's own validation config. The rejected alternative was threading the caller's own `includeAnnotationKey` predicate through `StoreDocument`, the then-existing `AnnotationCarriers`, `DocumentLint` and `SchemaValidator` so each consumer decided admission for itself; that would have needed one new option surface per module in the call chain and ended the one-owner invariant `KeywordFamilies` exists to hold — the four modules could then disagree about what counts as declared, exactly the drift `isDeclared` was built to prevent.

## Module surface

Module-per-concept per the [module layout standard](../effect-standards.md#module-layout-module-per-concept); no barrel re-exports below the entrypoint. See `src/` and the package's modules context file for each module's as-built shape. The load-bearing division:

- **`StoreDocument`** — the assembly. Owns the `#/definitions` → `#/$defs` `$ref` rewrite the Draft-07 lowering makes necessary (the lowering emits canonical `definitions` refs while the publication shape keeps its pool under `$defs`, a Draft-07-valid alias), the annotation-key admission gate (`UndeclaredAnnotationKeyError`) and the publication shape itself. **The package owns assembly, not a JSON Schema engine.**
- **`SchemaTarget`** — the target manifest vocabulary: schema, identity, destination path and optional name and version.
- **`SchemaVersioning`** — both catalog modes and the version grammar, plus `isPinned` (a label with no prerelease — the one predicate shared by the pipeline's contract guard and `next`) and `next` (the version label a change classification calls for; see [versioning](#versioning-schemastores-file-convention-semvers-label-grammar)).
- **`CatalogEntry`** — the catalog entry shape plus the fileMatch hygiene lint.
- **`DocumentLint`** — owned structural checks: `$ref` resolution against the `$defs` pool, unknown keywords outside the declared families, best-practice advisories, and a depth cap that degrades to a finding rather than throwing.
- **`CanonicalJson`** — the owned deterministic serializer. It exists because the extraction source this package generalizes shelled out to a formatter binary for serialization, and **a library must own canonical JSON rather than shelling to a formatter**. It fails typed on values `JSON.stringify` would silently drop or rewrite.
- **`KeywordFamilies`** — the one owner of the declared non-standard keyword registry, in two groups: the upstream language-server families and the house `x-ai-` machine-annotation namespace. The assembly, the lint and the validator all consume its single predicate, so they cannot drift on what counts as declared.
- **There is no annotation-carrier module.** `AnnotationCarriers` existed to re-graft declared keys after the Draft-07 lowering dropped them; core stopped dropping them and the module was deleted, along with its `CarrierDepthExceededError`. Admission is now `StoreDocument`'s own gate; see [annotation carrying](#annotation-carrying-core-carries-the-keywords-the-package-owns-admission).
- **`SchemaValidator`** — real-engine validation; see [the validation gate](#the-validation-gate-ajv-ships-closed).
- **`DocumentDiff`** — pure change classification; see [change classification](#change-classification-annotations-versus-contract).
- **`SchemaFile`** — the one IO module; see [write-if-changed](#write-if-changed-compares-content-not-bytes).
- **`SchemaPipeline`** — the emit verb, now carrying the contract policy (`ContractChangePolicy`, `SchemaContractChangeError`); see [the pipeline](#the-pipeline-orchestration-as-a-shipped-surface).

## Annotation carrying: core carries the keywords, the package owns admission

**Core carries declared-family keywords through the lowering on its own, and this package no longer re-grafts anything.** Effect rc.112 ([PR #7420](https://github.com/Effect-TS/effect/pull/7420), "Make JSON Schema dialect conversions preserve custom keywords") made `JsonSchema.toDocumentDraft07` copy unknown and custom keywords through as opaque values, **in place**, including across the coordinate moves the lowering performs — 2020-12 `prefixItems[i]` → Draft-07 `items[i]`, and a trailing `items` schema → `additionalItems`.

That falsified the constraint the design was built on. The predecessor design read "core's Draft-07 lowering drops every keyword outside its fixed copy-list", and it was true of the prereleases it was probed against; a whole module — `AnnotationCarriers`, a parallel walk mirroring the lowering's descent rules, plus its `CarrierDepthExceededError` — existed to put the dropped keys back afterwards. Re-probed at rc.112, the re-graft was **redundant in all six required cases** (field node, root node, `$defs` pool entry reached through `suspend`, the tuple-item move, the rest-element move, and an annotation landing in an `allOf` position beside a check). The module is deleted; the probes are permanent tests in `__test__/annotation-carrying.test.ts`, which assert on raw `JsonSchema.toDocumentDraft07` output so that a regression in core is attributed to core rather than rediscovered as a package bug.

**One thing the predecessor design got right survives and must not be relitigated**: pointer-mapping is the wrong frame. Consumers supplying explicit JSON pointers into the lowered document was rejected because it discards definition-site DX and forces consumers to know the lowered layout, which is exactly the knowledge this package exists to own. **No pointer arithmetic exists anywhere in the package**, and core's in-place preservation is now the reason it never needs to.

**What the deletion moved rather than removed is admission.** The package previously relied on the lowering's drop as its enforcement: a caller-supplied `includeAnnotationKey` could admit any key it liked, and anything outside the declared families quietly vanished during lowering. That was the design flaw — the invariant was being held by a side effect of someone else's implementation, and core's fix exposed it by shipping those keys straight into the emitted document. **The gate is now the package's own**: `StoreDocument.fromSchema` / `fromSchemaResult` fail with the `@public` typed `UndeclaredAnnotationKeyError` (carrying the document's `$id` and the sorted offending `keys`) when the caller's predicate admits a key outside the declared families. Failing loudly beats both alternatives: emitting the key ships a document SchemaStore's own ajv-strict gate rejects, and silently omitting it hides the mistake in the caller's predicate. The error widens the channels of `StoreDocument.fromSchema`/`fromSchemaResult` and of `SchemaPipeline.run`/`check`/`runOne`/`checkOne`.

Three consumer-facing facts the design commits to:

- **Annotate at the definition site.** Annotating a hoisted or identifier'd schema at its *usage* site reaches neither the `$ref` node nor the `$defs` pool entry, even at 2020-12 — the annotation silently carries nothing. This is core behavior, documented rather than fixable here.
- **The declared families are default-on and cannot be turned off.** They are admitted regardless of what a supplied `includeAnnotationKey` answers; the predicate has no admitting role left, since the only thing it can now add is a key that fails the build. It survives solely because the rest of `ToJsonSchemaOptions` passes through, and is best left unset. `x-ai-` rides exactly like the upstream families, needing no separate opt-in, because one `KeywordFamilies.isDeclared` predicate governs both.
- **Carried values are shared by reference, not cloned.** A declared key's value in the emitted document is the same object the caller handed to `.annotate()`, which lives on the schema AST. This is cheap and correct as long as the emitted document is treated as read-only; mutating a carried `x-ai-hint` payload in place corrupts every later emission from that schema, not merely this document.

**The `#/definitions` → `#/$defs` `$ref` rewrite deliberately does not descend into a declared-family value.** Those payloads are opaque advice addressed to a language server, not schema positions: a `$ref`-shaped string inside one means whatever that tool says it means, and rewriting it corrupts it. Under the old design the carrier grafted values on *after* the rewrite had run, so the exemption was free; deleting the carrier put those values in the rewrite's path, and without the explicit skip the deletion would have silently started rewriting inside `x-taplo` and `x-ai-*` payloads. It is load-bearing by mutation testing rather than by assertion — the skip also keeps a deep payload from spending the walk's depth budget.

**Open limitation: a `Schema.Class`'s class-level annotations never reach the document** — title and description as well as the declared families. Core emits a class's definition from its *encoded* AST, and the class-level annotations do not survive that; the same annotations on a hoisted `Schema.Struct` do survive, which is what makes this a core bug rather than a constraint this package should design around. Tracked as [effected#606](https://github.com/spencerbeggs/effected/issues/606) and upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084). Until it is fixed, the workaround is to annotate a `Schema.Struct` root rather than a `Schema.Class`.

## Versioning: SchemaStore's file convention, SemVer's label grammar

The two halves of "follow SchemaStore" pull apart here and are decided separately.

**The file-name convention stays the store's**: `<name>-<version>.json`, hyphen-separated, matching its guide and its corpus. There is no reason to diverge on the separator.

**The label grammar narrows to full three-component SemVer**, enforced through [@effected/semver](semver.md)'s own parse rather than a parallel regex. The store's own labels are commonly two-part and unparseable as SemVer, but **a partial label cannot be split back out of a file name or URL unambiguously**, and that is the operation a consumer of these artifacts actually performs. Requiring `major.minor.patch` makes it mechanical.

The cost, stated plainly: a schema submitted to SchemaStore proper carries a third component its neighbours lack. That is valid — the store prescribes no label grammar — just not identical in style. For self-hosted schemas, where the URL is the publisher's own, there is no cost at all.

Three consequences worth recording:

- **Build metadata is rejected.** It is hostile in a URL, and SemVer precedence *ignores* it, so two labels differing only in build compare EQUAL and both would claim to be the latest version.
- **Surrounding whitespace is rejected**, because the underlying parse trims and an untrimmed label would round-trip verbatim into a file name.
- **Ordering is a plain parse** — the brand's filter and the ordering's parse are literally the same call, which retires a whole class of drift between what the grammar admits and what the comparator can read.
- **No SemVer label is array-index-like**, so the version map's ascending insertion order survives serialization. A grammar admitting bare-major labels would not: JavaScript enumerates integer-like keys first regardless of insertion order.

**`isPinned` is the one predicate the contract guard and the bump both read**, because they must never disagree: a label with no prerelease is "pinned" — a published, URL-pinned document — and both `SchemaPipeline`'s `"block-versioned"` policy and `SchemaVersioning.next` consume the exact same test. If the two used different definitions, a caller could be refused a write by the guard while `next` told it to keep the same label — a deadlock neither side could resolve. A prerelease is unpinned by SemVer's own §9: it declares its own instability, so a contract change inside one is not a break for anyone, and both the guard and the bump treat it as identity.

**`next(current, change)` is pure and total, with four arms**, and each earns its place:

- Any non-`"contract"` classification (`"none"`, `"annotations"`, `"created"`) is identity — nothing to break.
- A non-pinned `current` (a prerelease) is identity — see above.
- `major === 0` bumps MINOR: on the 0.x line, MINOR is the axis 0.x consumers already treat as breaking, so it is the loud, conspicuous direction.
- Otherwise, MAJOR — also the loud, conspicuous direction, one axis further out.

The bump's job is to be **strictly greater and conspicuous, not to encode SemVer compatibility**: `DocumentDiff` cannot distinguish an added optional property from a removed required one, so every contract change reads as breaking regardless of whether it actually is. Each version label is its own file and its own URL, so an over-bump costs an extra file; an under-bump would silently overwrite a document consumers had pinned. `next` never mints a prerelease from a stable input — a bump only ever moves a stable label to another stable label.

## The validation gate: ajv ships closed

The package ships a **real ajv-backed validator layer**, and ajv is a direct dependency. The alternatives — a contract-only seam closed by the consumer, or owned structural lint with the engine left to consumer CI — were both tried, and the reasoning that overturned the seam is worth keeping because it constrains future decisions:

- The premise behind keeping the engine out — that many consumers need only assembly and lint — **did not survive contact.** This package is build-time tooling installed as a devDependency; the engine's weight in a consumer's *runtime* graph is a cost nobody was actually paying.
- ajv is not an incidental implementation choice but **a first-class part of SchemaStore's own contract**: the gate IS ajv strict mode. A package that owns the SchemaStore shape while refusing to own its gate is drawing the boundary in the wrong place.
- The seam's cost was real and recurring: every consumer wrote the same adapter, and one wrote it *worse*, collapsing ajv's structured errors into a single root-pathed finding, which wasted the finding vocabulary and made all-errors reporting inert. **An example copied verbatim out of a README is a default that has not been shipped.**

A companion `@effected/schemastore-ajv` package was available as a middle path and declined: it preserves the ceremony while adding a package to maintain.

**What survives, and must:** the **channel convention** — findings are values, so a strict-mode rejection is a report rather than an error, and the error channel is reserved for the mechanism failing; the **engine-shaped input**, decoupled from the package's own classes; and the **service-as-interface**, with a noop layer, a test layer and a substitutable engine all intact. The seam survives as an interface, not as a requirement. What changed is only that not-writing-an-adapter is the default path.

The shipped layer **registers every declared keyword family found in the document before compiling**, so ajv strict mode cannot reject the language-server families the lint deliberately allows. One predicate governs both verdicts.

## Write-if-changed compares content, not bytes

Comparison is **by parsed content by default**, with a byte-exact mode as an opt-out.

A byte comparison falsifies the whole promise in the common case. A repo whose pre-commit hook formats staged JSON will reformat the written file; the next run reads back different bytes, finds them different, and rewrites — forever. "Unchanged" becomes unreachable and a CI drift check fails on a document whose content never changed. **A repo that formats its JSON is the common case, not the exotic one**, and the only consumer-side fix was a formatter carve-out caused entirely by the comparison's layer. Content equality is what "unchanged" was always trying to express, and it is immune to any downstream formatter. Object key order is not a difference, since a formatter may sort; array order is, because that is data.

Two consequences worth stating, because they are not obvious:

- **Reading the file is not a sufficient drift check.** With value comparison, a write legitimately leaves a formatter's bytes on disk, so a text-comparing drift test disagrees with the writer. Hence a separate **non-writing check**: the same comparison without touching the filesystem, which is what a CI drift job actually wants, since it must not regenerate. It answers both the content question and the would-this-write question, so the pair agrees with the writer under either comparison mode. **Both routes compute from one internal comparison helper**, so they cannot drift apart.
- **An existing file that does not parse is classified as a contract change and repaired**, not failed typed. Failing would leave a hand-corrupted generated file permanently un-regenerable, which is worse than overwriting something that was not a valid document in the first place.

## Change classification: annotations versus contract

If the writer parses both sides anyway, it can say *what kind* of change it found: none, annotations-only, or contract.

The value is versioning. The decision "does this change need a new schema version" is exactly the question of whether a document valid against the old schema is still valid against the new one. **Rewording a description is transparently replaceable; moving an assertion keyword is not.** A generator that reports the difference gives its operator that signal for free, at the moment it matters.

**The governing principle, stated once so every keyword's classification follows from it rather than from a memorized list**: a keyword is a CONTRACT change when it alters what a validator asserts or what data a generic tool writes into an instance; a keyword that alters only the advice given to a reader — human or machine — is an ANNOTATION. That is the test that puts `default`/`examples`/`readOnly`/`writeOnly` on the contract side despite Draft-07's own taxonomy calling them annotations (a generic tool acts on them), and puts `x-ai-*` on the annotation side despite it being a family this package itself declared (it advises a machine reader and asserts nothing). One consequence worth stating plainly: adopting `x-ai-*` on an already-published, versioned document — the first time a maintainer starts annotating it — rewrites that file in place rather than cutting a new version, because the change classifies as `"annotations"`. That is correct, not a gap: the annotation is transparently replaceable by definition.

Two design calls, both deliberately conservative:

- **`default`, `examples`, `readOnly` and `writeOnly` are not treated as documentation**, though the Draft-07 vocabulary's own taxonomy calls them annotations — form generators and clients act on them. The asymmetry is intentional: misreporting a contract change as annotations ships a silent breaking change, while the reverse costs only an unnecessary version bump. **When in doubt the documentation set stays small.**
- **The walk is keyword-position aware**, mirroring the lint's descent exactly: a property *named* `description` inside a properties map is data, not an annotation.

The leaf value comparison uses a **looser stack guard than the structural depth cap**, and sharing one budget was a real bug: the structural walk stopped classifying at the cap and handed the remainder to a comparison that then ran out of frames before reaching the leaves, so a deeply-nested but *identical* document compared as different. The two are different concerns — one bounds how deep meaning is assigned, the other only prevents a stack overflow.

## The pipeline: orchestration as a shipped surface

The generate → lint → validate → gate → write loop is shipped, because every consumer was writing it independently and would diverge on error shape, log wording and — most consequentially — **gating policy**.

This is the ajv decision one layer up: there the copied boilerplate was the engine adapter and shipping it once fixed a bug none of the copies had noticed; here the boilerplate is the loop, and the latent divergence is two consumers disagreeing about what an advisory finding means. It does not cross the [scope fence](#scope-fence): it adds no JSON Schema capability at all, only orchestration over modules already owned, in the order the package already documents.

Three design calls:

- **Plain statics, not a `Context.Service`.** Their requirements compose through `R` for free; a service would add a layer to wire for no capability the consumer lacks — precisely the ceremony the ajv decision removed.
- **Gating is policy and must be overridable.** The default treats warnings as blocking, which is right, but a hardcoded policy sends anyone who disagrees back to hand-rolling the whole loop to change one comparison, which defeats the point of shipping it.
- **Findings are values, never logs**, consistent with the lint's convention. This deliberately does **not** solve log-wording divergence — log wording is repo policy. What it solves is the gating divergence, which is the part that silently changes what ships.

Both gates' findings normalize into one finding type so a single predicate judges them; engine findings are always blocking-severity, because a document the engine rejects is not advisory.

**Know which gate actually blocks here.** A target carries a `Schema`, so a pipeline document is always built through the generation path — and `StoreDocument.fromSchema` refuses an undeclared annotation key outright, failing `UndeclaredAnnotationKeyError` before a document exists to lint. The unknown-keyword check therefore **cannot fire through the pipeline at all**, and the **engine** is what stops a bad document. Note the mechanism carefully, because the *old* explanation is still the one a reader reaches for: it used to be unreachable because core's Draft-07 lowering dropped every keyword outside its copy-list, and that lowering has preserved unknown keywords since rc.112. The conclusion outlived its original reason — do not restore the dropped-keyword wording. This is a reachability fact, not a policy error: the default gating predicate is unchanged and still correct. What it corrects is a *claim* — do not describe the pipeline's lint gate as the thing catching keyword mistakes on schema-derived documents. The lint's warning checks earn their keep on documents the pipeline did **not** build (a hand-assembled document, or one read back off disk) and on depth, which a schema can genuinely exceed.

**`run` is two-phase, and writes nothing unless every target passes.** Phase 1 touches no filesystem: it generates each target's document, runs the gate (fail-fast on `SchemaGateError` — a document the engine rejects would never be written under any contract policy, so classifying it further is noise), and, only for a target the contract policy guards, classifies it against its on-disk predecessor. Phase 2 writes the held documents, in target order, only once every target has cleared phase 1. The two phases are a snapshot, not a transaction: a concurrent writer between them is not defended against, and the guarded read in phase 1 costs a second parse of the same file phase 2 will read again — accepted, because only targets that declare themselves published pay it. `check` stays **total over the targets** and never fails on findings, carrying `blocked` and now `contractBlocked` per target instead — reporting is its job, and a repo with three broken documents should learn all three in one run.

**`contractChanges` is the second, independent policy, keyed on `SchemaVersioning.isPinned(target.version)`.** The default, `"block-versioned"`, treats a pinned versioned target as a published, URL-pinned document: a `"contract"` classification against it fails with `SchemaContractChangeError` — collected across every guarded target before the error is raised, so two broken documents surface in one run, the same total-not-first-wins shape as the gate's own findings — rather than silently rewriting a document consumers pin by URL. An unversioned target, or one carrying a prerelease label, has no such consumer expectation and is rewritten in place exactly as before. `"allow"` is the escape hatch: classify and report only, the pre-guard behaviour — and it is also the **sanctioned repair path** for a corrupted published file. `SchemaFile` classifies unparseable on-disk text as `"contract"` so a hand-corrupted generated file stays regenerable rather than permanently stuck; under the default policy that exact classification is what gets refused, so the repair has to go through `"allow"` deliberately.

**`"block"` — refusing every contract change regardless of pinning — was considered and deliberately not shipped as a policy value.** It is the over-broad policy: it is exactly the shape of the hand-rolled preflight that silk-release-action's `generate-schema.ts` wrote for itself, and that preflight wedged on the action's own **unversioned** input schema, which has no predecessor for consumers to pin and no business being refused a rewrite. A policy with no notion of pinning cannot distinguish the document that must never move from the document that is expected to move on every run.

**The default derives from `SchemaTarget.version`, a fact about the target, rather than from a separate boolean the caller would have to keep in sync with it.** A boolean flag independent of `version` could disagree with reality — a target could carry a pinned label and still be told it is not guarded — where reading `version` directly cannot drift from what the target actually is.

**The policy is only coherent when the version participates in `path`** — `schemas/<version>/<name>-<version>.json` is the shape that makes it so. A versioned target whose path does *not* embed the label compares the same file forever regardless of what `version` says, so bumping `version` alone would not move the write target and the guard would keep firing against a file the bump never touched.

## Resolved decisions

- **Module naming.** The assembly module is `StoreDocument`. A `SchemaDocument` name was rejected because it reads like the banned general-JSON-Schema scope.
- **The meta-schema constant keeps its trailing `#`**, matching the SchemaStore corpus convention and deliberately diverging from core's equivalent constant, which omits it. Documented on the constant itself.
- **The store's own coverage tool is not reimplemented.** Its checks are candidate inspiration only.
- **No `SchemaVersioning.plan`.** `catalogUrls` already sorts and dedupes the version set, so a separate planning surface would only restate what the existing catalog derivation already computes.
- **No shipped `templates/` directory.** The bundler publishes emitted `src`, `LICENSE` and `README` only; the canonical schema-generator script a consumer repo copies lives in the `actions-inputs-outputs` skill reference and in the `github-action-template` repo, not as a package artifact.
- **No `bin`.** The package is a library consumed by a generator script the caller owns, not a CLI.
- **No `layerDefault`.** Every service-shaped module (`SchemaValidator`, `SchemaFile`) ships a real layer and a test layer; a third "default" layer would only be a name for one of the two that already exist.
