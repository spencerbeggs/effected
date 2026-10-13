---
type: Decision
title: sbom owns its own CycloneDX emitter, declining the object-model library
description: "@effected/sbom hand-rolls a CycloneDX 1.6 model and serializer rather than depending on @cyclonedx/cyclonedx-library."
status: draft
tags:
  - bundle
  - architecture
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: b1ff13e3758640d2
---

# sbom owns its own CycloneDX emitter, declining the object-model library

## Context

`@effected/sbom` needs to produce a CycloneDX 1.6 SBOM document. The
obvious candidate is `@cyclonedx/cyclonedx-library`, the reference
JavaScript object model for the format, and the package's own test
fixture provenance file
(`packages/sbom/__test__/fixtures/VENDORED.md`) records vendoring that
library's `res/schema/bom-1.6.SNAPSHOT.schema.json` at version `10.1.0` as
a **test-only conformance oracle** — which is itself evidence of how close
the package sits to that library without depending on it at runtime.

## Decision

`@effected/sbom` owns its own CycloneDX 1.6 model
(`packages/sbom/src/SbomDocument.ts`) and normalizing JSON serializer,
and declines `@cyclonedx/cyclonedx-library` as a runtime dependency.

Three pieces of evidence made the choice easy rather than merely
defensible:

- **The library is 6.6 MB with seven optional peer dependencies**, of
  which everything this package actually needs is an object model plus a
  JSON normalizer — roughly ten used symbols. The parts that earn the
  weight (XML serialization, JSON-schema validation via `ajv`, SPDX
  expression parsing) are exactly the parts an emitter that only produces
  CycloneDX JSON never calls.
- **CycloneDX JSON is a published schema, not an engine.** Emitting
  conformant output is serialization with a field-ordering convention,
  not an algorithm to port — the same economics that justify
  `@effected/toml` and `@effected/glob` owning their own engines rather
  than wrapping a reference implementation.
- **The library's own optional SPDX peer would install a second SPDX
  engine** beside [`@effected/spdx`](../modules/spdx.md), which this kit
  already owns for exactly the license-expression classification a
  CycloneDX emitter needs.

The 6.6 MB / seven-optional-peer maze had already cost two consumer
repositories hand-rolled bundler ignore lists and a lazy-import cache
before this package existed, which is the concrete cost this decision
avoids reproducing a third time.

## Alternatives rejected

**Depend on `@cyclonedx/cyclonedx-library` and accept the optional-peer
maze.** Rejected on weight and on duplication: the SPDX peer duplicates
work this kit already owns, and the optional-peer pattern (a lazy-import
cache to defer peers a consumer's bundler cannot statically resolve) is
exactly the workaround this package's own consumers had already built and
that this decision deletes rather than inherits.

**Depend on the library only for validation, and hand-roll emission.**
Rejected because validating third-party BOMs is not this package's job —
it emits its own — and pulling `ajv` plus the library's schema loader
solely to validate output this package fully controls is the weight this
package exists to avoid. The published JSON schema itself is vendored as
a test fixture and used as the conformance oracle instead, at zero
runtime cost.

## Consequences

Declining the library caps the CycloneDX surface at one owned module,
`SbomDocument.ts`, which is what keeps the package's [reachability
invariant](../modules/sbom.md#bundle-reachability) simple: nothing about
CycloneDX emission pulls in a chain of optional peers that a consumer's
bundler must be configured to ignore. Two reversal triggers are recorded
so the decision is revisited on evidence rather than re-litigated from
scratch: needing CycloneDX **XML** output, which this package's owned
serializer does not produce, or needing to **consume and validate**
third-party BOMs rather than emit this package's own, which is a
different job than the one this package does today.

Conformance confidence is not sacrificed: CycloneDX conformance tests
read their expectations (`required` arrays, `enum` members, property
names) directly from the vendored published schema rather than from
hand-written assumptions, so a wrong `externalReference.type` or a
renamed property fails against the specification itself.
