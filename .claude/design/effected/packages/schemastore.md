---
status: current
module: effected
category: architecture
created: 2026-07-28
updated: 2026-09-02
last-synced: 2026-09-02
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

The division of labour with core is the package's organizing idea: **core owns the generation pipeline, this package owns the SchemaStore shape around it.** Core's `Schema.toJsonSchemaDocument` produces Draft 2020-12 and `JsonSchema.toDocumentDraft07` lowers it; everything this package does is assembly, annotation carrying, versioning, lint, validation and IO on top of that.

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
- **Language servers consume non-standard keyword families** — the vscode set by exact name, plus the taplo, tombi and IntelliJ prefixes. These must be able to ride from Effect Schema annotations into emitted documents, and they interact with the ajv gate, because unknown keywords fail strict mode.

## Module surface

Module-per-concept per the [module layout standard](../effect-standards.md#module-layout-module-per-concept); no barrel re-exports below the entrypoint. See `src/` and the package's modules context file for each module's as-built shape. The load-bearing division:

- **`StoreDocument`** — the assembly. Owns the `#/definitions` → `#/$defs` `$ref` rewrite the Draft-07 lowering makes necessary (the lowering emits canonical `definitions` refs while the publication shape keeps its pool under `$defs`, a Draft-07-valid alias) and the publication shape itself. **The package owns assembly, not a JSON Schema engine.**
- **`SchemaTarget`** — the target manifest vocabulary: schema, identity, destination path and optional name and version.
- **`SchemaVersioning`** — both catalog modes and the version grammar.
- **`CatalogEntry`** — the catalog entry shape plus the fileMatch hygiene lint.
- **`DocumentLint`** — owned structural checks: `$ref` resolution against the `$defs` pool, unknown keywords outside the declared families, best-practice advisories, and a depth cap that degrades to a finding rather than throwing.
- **`CanonicalJson`** — the owned deterministic serializer. It exists because the extraction source this package generalizes shelled out to a formatter binary for serialization, and **a library must own canonical JSON rather than shelling to a formatter**. It fails typed on values `JSON.stringify` would silently drop or rewrite.
- **`KeywordFamilies`** — the one owner of the declared non-standard keyword registry. The carriers, the assembly, the lint and the validator all consume its single predicate, so they cannot drift on what counts as declared.
- **`AnnotationCarriers`** — the post-lowering re-graft; see [annotation carrying](#annotation-carrying-a-parallel-walk-not-pointer-mapping).
- **`SchemaValidator`** — real-engine validation; see [the validation gate](#the-validation-gate-ajv-ships-closed).
- **`DocumentDiff`** — pure change classification; see [change classification](#change-classification-annotations-versus-contract).
- **`SchemaFile`** — the one IO module; see [write-if-changed](#write-if-changed-compares-content-not-bytes).
- **`SchemaPipeline`** — the emit verb; see [the pipeline](#the-pipeline-orchestration-as-a-shipped-surface).

## Annotation carrying: a parallel walk, not pointer mapping

Two constraints probed against the pinned Effect prerelease fix the design space.

First, **core's Draft-07 lowering drops every keyword outside its fixed copy-list.** Annotation-admitted keys survive at 2020-12 and vanish after lowering, so the carrier mechanism must act *after* the lowering; it cannot ride the generation options alone.

Second, **pointer-mapping is the wrong frame entirely.** The problem looks like mapping schema nodes to JSON-pointer locations in the lowered document, but annotation-admitted keys land deterministically on their 2020-12 nodes at every attachment site core generates, and the definitions pool maps key-for-key through the lowering. The only coordinate move is the tuple-item rename. The mechanism is therefore a **parallel walk mirroring the lowering's descent rules**, and **no pointer arithmetic exists anywhere in the package.**

The alternative — consumers supplying explicit JSON pointers into the lowered document — was rejected because it would discard definition-site DX and force consumers to know the lowered layout, which is exactly the knowledge this package exists to own.

Two consumer-facing facts the design commits to:

- **Annotate at the definition site.** Annotating a hoisted or identifier'd schema at its *usage* site reaches neither the `$ref` node nor the `$defs` pool entry, even at 2020-12 — the annotation silently carries nothing. This is core behavior, documented rather than fixable here.
- **Carriers are default-on.** The declared families are always admitted; a caller's admission predicate adds keys but cannot suppress a declared family. The flag widens, never narrows.

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

**Know which gate actually blocks here.** A target carries a `Schema`, so a pipeline document is always built through the generation path — and the Draft-07 lowering drops every keyword outside its copy-list, so an undeclared keyword never survives to be linted. The unknown-keyword check therefore **cannot fire through the pipeline at all**, and the **engine** is what stops a bad document. This is a reachability fact, not a policy error: the default gating predicate is unchanged and still correct. What it corrects is a *claim* — do not describe the pipeline's lint gate as the thing catching keyword mistakes on schema-derived documents. The lint's warning checks earn their keep on documents the pipeline did **not** build (a hand-assembled document, or one read back off disk) and on depth, which a schema can genuinely exceed.

**Run enforces; check reports.** The writing entry point stops at the first gate failure, so a gated document is never written and neither are the targets behind it. The checking entry point is **total over the targets** and never fails on findings, carrying a blocked flag per target instead — reporting is its job, and a repo with three broken documents should learn all three in one run. A blocked target is still never mistaken for clean drift, because the flag says so explicitly. This is the one place the two deliberately differ in more than writing.

## Resolved decisions

- **Module naming.** The assembly module is `StoreDocument`. A `SchemaDocument` name was rejected because it reads like the banned general-JSON-Schema scope.
- **The meta-schema constant keeps its trailing `#`**, matching the SchemaStore corpus convention and deliberately diverging from core's equivalent constant, which omits it. Documented on the constant itself.
- **The store's own coverage tool is not reimplemented.** Its checks are candidate inspiration only.
