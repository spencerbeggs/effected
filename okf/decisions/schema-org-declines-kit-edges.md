---
type: Decision
title: "@effected/schema-org declines both available @effected edges"
description: license and version are typed to the vocabulary's own wide ranges rather than to @effected/spdx or @effected/semver, because a vocabulary's declared range is the contract.
status: draft
tags: [compat, architecture]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 4d71df942c08b36e
---

# @effected/schema-org declines both available @effected edges

## Context

Two kit packages exist that could plausibly type two `@effected/schema-org`
fields more strictly: `@effected/spdx` for `license`, and `@effected/semver`
for `version`. Both edges are pure-to-pure, cost nothing at the tier level,
and would look like the kit "eating its own dog food" by wiring its
vocabulary package to its own grammar packages.

## Decision

Both edges are declined, and the package ships with zero `@effected/*`
runtime edges.

- **`@effected/spdx` for `license`.** schema.org's `license` has range
  `CreativeWork | URL` — a URL, not an SPDX identifier. Typing it as an
  SPDX expression would reject legal input (`https://example.com/eula`) to
  serve a coincidence. A consumer holding an SPDX id maps it to a URL at
  its own call site with spdx's `License.referenceUrl`
  (`packages/spdx/src/License.ts`), without either package learning about
  the other.
- **`@effected/semver` for `version`.** schema.org's `version` has range
  `Number | Text`. Requiring SemVer would reject a legal `"2024-11"` or
  `"1.0-beta"`. Same decline, same reason.

**A vocabulary's range is the contract, not our neighbour package's
grammar.** Both declines look obviously right from the kit's side (why
wouldn't a version field want SemVer?) and are obviously wrong from the
vocabulary's (schema.org never promised SemVer). Whichever side a reader
starts from, the other side needs the reasoning written down rather than
assumed, which is the reason for this Decision.

## Alternatives rejected

**Typing `license` as `SpdxExpression | URL`.** Rejected because it still
narrows: a bare cataloged SPDX id string (`"MIT"`, no `SpdxExpression`
wrapper) is common upstream input and would need its own accommodation,
and the union invites a caller to assume the SPDX branch is preferred or
validated, when the field's only real contract is "a `CreativeWork` or a
`URL`".

**Typing `version` as `SemVer | Number | Text`.** Rejected for the same
reason as `license`: it implies a preference or a validation guarantee the
vocabulary does not make, and schema.org's own examples use date-based and
non-SemVer version strings routinely, so the union would reject or
awkwardly side-step common legal input the moment a caller reached for the
strict branch.

**Accepting the edge for internal consistency with the rest of the kit.**
Rejected because tier-purity and cross-`@effected` consistency are not the
governing constraints here — the governing constraint is fidelity to
schema.org's own declared ranges. `@effected/schema-org` is a vocabulary
package first; its job is to reject nothing the vocabulary permits, not to
demonstrate kit cohesion.

## Consequences

A consumer that holds a stronger-typed value (an `SpdxExpression`, a
`SemVer`) converts it to the vocabulary's wire shape at its own call site
— one line each, using `License.referenceUrl` or `SemVer.toString()` — and
neither package needs to change to support that consumer. The package's
dependency graph stays at zero `@effected/*` edges, which is itself
evidence, on a spot-check, that the tier-purity claim in [the schema-org
Module](../modules/schema-org.md#tier-and-dependencies) holds.
