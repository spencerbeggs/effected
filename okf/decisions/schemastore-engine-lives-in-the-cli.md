---
type: Decision
title: The ajv engine lives in the CLI, and the library returns to boundary tier
description: "The one shipped SchemaValidator engine is @effected/schemastore-cli's AjvValidator.layer, so ajv is a cost only the command pays; @effected/schemastore keeps the contract and its doubles, drops ajv and ajv-formats, and retiers from integrated back to boundary."
status: draft
supersedes: schemastore-retier-to-integrated.md
tags:
  - architecture
  - bundle
  - deps
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-09-15T00:00:00Z
  - id: library-package-json
    resource: ../../packages/schemastore/package.json
  - id: cli-package-json
    resource: ../../packages/schemastore-cli/package.json
  - id: ajv-validator
    resource: ../../packages/schemastore-cli/src/AjvValidator.ts
  - id: schema-validator
    resource: ../../packages/schemastore/src/SchemaValidator.ts
generated:
  by: "okfit/claude-code"
---

# The ajv engine lives in the CLI, and the library returns to boundary tier

## Context

`@effected/schemastore` retiered from boundary to integrated on
2026-08-04 to ship `SchemaValidator.layer`, a real ajv engine, as part
of the library ([the retier decision](schemastore-retier-to-integrated.md)).
The argument rested on one premise: the library was build-time tooling
every consumer installed as a devDependency of its own generator script,
so ajv's weight in a runtime graph was never on anyone's bill.

Two things changed that premise. The generator scripts collapsed into
[`@effected/schemastore-cli`](../modules/schemastore-cli.md), which
became the only consumer that composes the real engine — every other
caller either drives `SchemaPipeline` through the command or never
validates at all. And applications began importing the library at
*runtime*: `HostedSchema` is the one value an application derives its
`$schema` URL from, so silk-release-action — a bundled GitHub Action —
moved `@effected/schemastore` from `devDependencies` to
`dependencies`.[^owner] With the engine in the library, that import
pulled `ajv` and `ajv-formats` into an install and a bundle that would
never run a validation.

## Decision

The one shipped `SchemaValidator` implementation is
`AjvValidator.layer`, exported from `@effected/schemastore-cli`'s single
`.` entry.[^ajv-validator][^cli-package-json] It is the same engine the
library shipped — ajv strict mode over the Draft-07 meta-schema, every
declared `KeywordFamilies` keyword registered, `ajv-formats` with
`keywords: false`, a fresh instance per call, findings as values and
mechanism failures as `SchemaValidatorError` — moved, not rewritten.
The command composes it at its edge where it composed
`SchemaValidator.layer`.

`@effected/schemastore` keeps the contract and nothing of the engine:
the `SchemaValidator` service, `SchemaValidatorShape`,
`SchemaValidatorOptions`, `SchemaValidatorError`, `ValidationFinding`,
`noop`, `makeTest` and `layerTest`.[^schema-validator] `ajv` and
`ajv-formats` leave its dependencies; `@effected/semver` is its only
runtime dependency.[^library-package-json] Under
[R1](../conventions/dependency-policy.md#r1-tiers-1-and-2-take-no-external-runtime-dependencies)
that is a boundary package, and the tier flips back.

The CLI stays a companion: its canonical use is the command, and the
`AjvValidator` export exists so a program that drives `SchemaPipeline`
itself can compose the same engine the command runs — nothing is hidden
from a consumer with a reason to wire the layers differently. The peer
rule is untouched: `effect` and `@effected/schemastore` remain the
CLI's peers.

## Alternatives rejected

**Keep the engine in the library and accept the runtime weight.** The
2026-08-04 argument no longer holds. A library an application depends
on at runtime for `HostedSchema` is not devDependency-only tooling, and
an engine that runs only under the command is the textbook case of an
edge every importer pays for and one consumer uses.

**A third package, `@effected/schemastore-ajv`.** Declined twice now.
The retier decision declined it because the library already owned the
shape; this decision declines it because the CLI already exists, is the
only real-engine consumer, and an export from it costs nothing a new
package would not also cost.

**Contract inversion with the engine as an optional peer of the
library.** An optional peer still surfaces on every install that does
not want it, and leaves the library's own module reaching for an engine
it does not ship. The CLI as the engine's home gives the same "library
declares, another package implements" shape without a peer.

## Consequences

- The retier decision is superseded. Its two admissibility facts —
  nothing in the kit depends on the package, and the engine is
  build-time tooling — are still the test a future retier must pass;
  the second one is what stopped holding here.
- [Ajv ships closed](schemastore-ajv-ships-closed.md) is unchanged in
  substance: every registration rule it records (declared families
  before compiling, `ajv-formats` vocabulary only, an unknown format
  still a strict-mode rejection) now describes `AjvValidator`, and its
  "in this package itself" wording is read as the CLI.
- [No layerDefault](schemastore-no-layer-default.md) still holds, with
  the real layer named `AjvValidator.layer` rather than
  `SchemaValidator.layer`; the library's `SchemaValidator` ships the
  contract and the doubles only.
- A consumer that composed `SchemaValidator.layer` from the library
  imports `AjvValidator` from `@effected/schemastore-cli` instead; a
  consumer that only builds documents, derives URLs or lints never
  installs ajv again.
- The CLI grows a declaration bundle and an api-extractor model
  (`website/lib/models/schemastore-cli/`) for the one entry; the
  `emitDts: false` departure from the scaffold is gone.
- The [companion package](../glossary/companion-package.md) definition
  narrows from "exports nothing" to "its API is not why you install it":
  the tier still does not apply, because the one export is a layer over
  the library's own contract, not a surface of its own.

[^owner]: The owner's design conversation of 2026-09-15: silk-release-action
    moving `@effected/schemastore` to `dependencies` for `HostedSchema`,
    the CLI as the only real-engine consumer, and the "nothing is
    hidden" reason for exporting the layer.
[^ajv-validator]: `packages/schemastore-cli/src/AjvValidator.ts` —
    `AjvValidator.layer`, the strict-mode engine with `KeywordFamilies`
    registration and `addFormats(ajv, { keywords: false })`.
[^cli-package-json]: `packages/schemastore-cli/package.json` — the `.`
    export to `src/index.ts`, and `ajv` / `ajv-formats` as regular
    dependencies.
[^schema-validator]: `packages/schemastore/src/SchemaValidator.ts` — the
    contract, the error and finding classes, `noop`, `makeTest` and
    `layerTest`; no `layer` and no ajv import.
[^library-package-json]: `packages/schemastore/package.json` —
    `@effected/semver` as the only runtime dependency.
