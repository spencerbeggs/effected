---
type: Decision
title: The validation gate ships a real ajv engine, closed by default
description: SchemaValidator ships a real ajv-backed layer rather than a contract-only seam or a companion package, because a copied adapter is not a shipped default.
status: draft
sources:
  - id: claude-md
    resource: ../../packages/schemastore/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 7dc956d39db19ff5df388f5a04b7c327d9e55f59c38497bd0fb9c7d2b805193e
---

# The validation gate ships a real ajv engine, closed by default

## Context

`@effected/schemastore` needs a real JSON Schema validator to check that
what it emits is actually valid under SchemaStore's own ajv-strict gate.
Three shapes were available: keep the engine out and ship only a
contract-typed seam, split the engine into a companion package, or ship
the real engine directly in this package.

## Decision

`SchemaValidator.layer` ships a real ajv-backed validator as part of
`@effected/schemastore` itself, registering every declared keyword
family (see `KeywordFamilies`) before compiling so ajv strict mode
cannot reject a language-server family the lint deliberately allows, and
registering the standard `ajv-formats` vocabulary only
(`addFormats(ajv, { keywords: false })`) so a document can express
`format: "date-time"` without falling back to a `pattern` the published
document cannot carry. An unknown format string is still a strict-mode
rejection, and `keywords: false` stays load-bearing, because the
plugin's default would otherwise also register `formatMaximum` /
`formatMinimum`, which `DocumentLint` answers as unknown keywords —
exactly the two-verdicts drift the declared-families rule exists to
prevent.

## Alternatives rejected

**A contract-only seam, engine left to consumer CI.** The premise that
many consumers need only assembly and lint did not survive contact:
this package is build-time tooling installed as a devDependency, so the
engine's weight in a consumer's *runtime* graph is a cost nobody was
actually paying — the usual argument for keeping an engine out of a
library does not apply to devDependency-only tooling. ajv is not an
incidental implementation choice but a first-class part of SchemaStore's
own contract (the gate IS ajv strict mode), so a package that owns the
shape while refusing to own the gate draws the boundary in the wrong
place. The seam's cost was also real and recurring: every consumer wrote
the same adapter, and one wrote it worse, collapsing ajv's structured
errors into a single root-pathed finding that wasted the finding
vocabulary and made all-errors reporting inert.

**A companion `@effected/schemastore-ajv` package.** Declined: it
preserves the ceremony of a separate install while adding a package to
maintain, with no benefit over shipping the engine in the package that
already owns the SchemaStore shape it validates.

## Consequences

See [the retier decision](schemastore-retier-to-integrated.md) for the
tier consequence of taking `ajv` as a dependency. What survives from the
rejected seam design: the channel convention (findings are values, the
error channel is reserved for the mechanism failing), the engine-shaped
input decoupled from the package's own classes, and the service as an
interface with a `noop` layer and a test layer, so a consumer that
genuinely needs to swap the engine still can. Not-writing-an-adapter is
simply the default now, rather than the only option.

Since 2026-09-15 the engine's home is `@effected/schemastore-cli`, as
`AjvValidator.layer` — see
[the engine lives in the CLI](schemastore-engine-lives-in-the-cli.md).
Every registration rule above holds unchanged there; what moved is the
package that pays for `ajv`, and the "companion package" alternative
was declined a second time in favour of the CLI that already existed.
