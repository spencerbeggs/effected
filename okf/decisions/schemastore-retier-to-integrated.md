---
type: Decision
title: Schemastore retiers from boundary to integrated for a direct ajv dependency
description: The one package in the kit retiered after publishing, from boundary to integrated, to take ajv as a real validation engine rather than a contract-only seam.
status: draft
sources:
  - id: package-json
    resource: ../../packages/schemastore/package.json
  - id: claude-modules
    resource: ../../packages/schemastore/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 4d0ae081bc1b0510ccc787b44fd92c50a4aab0cc6957bd4b708d4ec00b1b432c
---

# Schemastore retiers from boundary to integrated for a direct ajv dependency

> Superseded on 2026-09-15 by
> [the engine lives in the CLI](schemastore-engine-lives-in-the-cli.md):
> the ajv engine moved to `@effected/schemastore-cli` and the library
> returned to boundary tier. Kept as the record of why the retier was
> admissible when it was made.

## Context

`@effected/schemastore` shipped first at boundary tier: a validation
seam typed against an interface, with the real ajv engine left for each
consumer to wire in. `ajv` and `ajv-formats` are now regular
dependencies of the package, and `SchemaValidator.layer` ships a real,
closed validator.[^package-json] This is the one package in the kit
retiered after it had already published.

## Decision

Move `@effected/schemastore` from boundary to integrated tier, per
[R1](../conventions/dependency-policy.md#r1-tiers-1-and-2-take-no-external-runtime-dependencies),
by taking `ajv` as a direct runtime dependency and shipping a real
engine implementation rather than a contract-only seam. `ajv` stays the
only third-party runtime dependency and the sole reason for the tier,
which is itself the guardrail against a casual second one.

Two facts made the retier admissible, and both must hold for any future
retier to cite this as precedent:

- **Nothing in the kit depends on `schemastore`**, so
  [R2](../conventions/dependency-policy.md#r2-tier-3-propagates)
  propagates the tier to nobody.
- **`ajv` is build-time tooling a consumer installs as a devDependency**
  of their own generator script, so the runtime-graph weight R1 exists
  to guard against was never actually on anyone's bill.

## Alternatives rejected

**Keep the contract-only seam and let every consumer close it.** This
was the original design, and it did not survive contact: the premise
that many consumers need only assembly and lint was false in practice —
every consumer wrote the same adapter, and one wrote it worse, collapsing
ajv's structured errors into a single root-pathed finding that wasted
the finding vocabulary. ajv is not an incidental implementation choice
but a first-class part of SchemaStore's own contract: the gate IS ajv
strict mode, and a package that owns the SchemaStore shape while
refusing to own its gate draws the boundary in the wrong place.

**A companion `@effected/schemastore-ajv` package.** Available as a
middle path and declined: it preserves the ceremony of a separate
package while adding one more thing to maintain, for no benefit over
shipping the engine directly in a package that already owns the shape
the engine validates.

## Consequences

The seam survives as an interface, not as a requirement: the channel
convention (findings are values, so a strict-mode rejection is a report
rather than an error; the error channel stays reserved for the mechanism
failing), the engine-shaped input decoupled from the package's own
classes, and the service-as-interface with a `noop` layer, a test layer
and a substitutable engine are all intact. What changed is only that
not writing an adapter is now the default path.

This is the counter-case to `npm`'s guardrail against a similar move —
`npm` declined an equivalent retier because neither of the two enabling
facts held there. A future retier proposal should be checked against
both facts above before being accepted, not merely against "did
schemastore do this."

[^package-json]: `packages/schemastore/package.json` — `ajv`,
    `ajv-formats` as regular dependencies.
