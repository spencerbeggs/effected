---
type: Decision
title: package-json delegates SPDX license validity to @effected/spdx
description: License.ts validates the license field's SPDX expression grammar by calling @effected/spdx's isValidExpression rather than owning that grammar itself, keeping only the two npm-specific special cases (UNLICENSED, SEE LICENSE IN); the delegation dropped the kit's last foreign spdx-expression-parse runtime dependency.
status: stable
tags:
  - architecture
  - bundle
sources:
  - id: package-json-license
    resource: ../../packages/package-json/src/License.ts
  - id: package-json-claude
    resource: ../../packages/package-json/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 007cda72f962dbf8
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: eeaaf82dab8f0920
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# package-json delegates SPDX license validity to @effected/spdx

## Context

npm's `license` field is either a real SPDX license expression or one of
two npm-specific spellings SPDX itself does not recognize: `UNLICENSED`
and `SEE LICENSE IN <file>`. Validating this field therefore needs both
the actual SPDX expression grammar (a real parser) and the two npm
carve-outs layered on top. Before `@effected/spdx` existed,
`@effected/package-json` carried its own SPDX validity check through the
`spdx-expression-parse` npm package, which was the kit's last
foreign (non-`@effected/*`) runtime dependency and the dependency that
made this package integrated tier.

## Decision

`@effected/package-json`'s `License.ts` delegates real SPDX expression
validity to `@effected/spdx`'s `isValidExpression`, and keeps only the
npm-specific `UNLICENSED` and `SEE LICENSE IN <file>` cases as its own
logic layered on top:[^package-json-license]

```text
isValidSpdx(value) =
  value === "UNLICENSED"
  || value starts with "SEE LICENSE IN " and has content after it
  || SpdxExpressionOps.isValidExpression(value)
```

This delegation is what dropped the former `spdx-expression-parse`
runtime dependency and its ambient shim — the dependency that once made
this package integrated — so `@effected/package-json`'s tier is now
boundary.[^package-json-claude] The npm-specific cases stay local because
they are npm semantics, not SPDX grammar: `@effected/spdx` has no reason
to know that npm treats those two strings specially, and folding them
into the shared package would leak an npm-specific carve-out into a
package meant to model SPDX itself.

## Alternatives rejected

- **Keep the local `spdx-expression-parse` dependency** and accept the
  integrated tier it forced. Rejected because a genuine cross-package
  vendored SPDX schema package (`@effected/spdx`) already existed as a
  candidate to replace it, and the tier cost of keeping a foreign
  dependency for a capability the kit could own itself outweighed the
  cost of the delegation.
- **Move the npm-specific special cases (`UNLICENSED`, `SEE LICENSE IN`)
  into `@effected/spdx` itself**, so package-json's `License.ts` could
  call one function covering the whole field grammar. Rejected because
  those two spellings are not SPDX grammar at all — they are npm's own
  convention — and folding them into the SPDX package would misrepresent
  what SPDX itself defines, plus create an npm-shaped dependency inside
  a package meant to be a general-purpose vocabulary vendor.

## Consequences

`@effected/package-json` carries zero third-party runtime dependencies
outside `effect` core, with `@effected/spdx` as its only source of real
SPDX grammar. A branded `SpdxLicense` value is therefore not guaranteed
to be parseable as an actual SPDX expression — `licenseExpressionOf`
exists precisely because a value passing `isValidSpdx` might still be one
of the two npm carve-outs, and any consumer needing an actual expression
(a license URL, a badge, structured data, a policy check) must go through
that accessor rather than assuming every valid `SpdxLicense` parses.

[^package-json-license]: `packages/package-json/src/License.ts:5-6,29-34`
    — `isValidSpdx` calling `@effected/spdx`'s `isValidExpression` for
    the real grammar, with the two npm special cases handled inline.
[^package-json-claude]: `packages/package-json/CLAUDE.md` — "Core SPDX
    license validity is delegated to `@effected/spdx`… That delegation
    dropped the former `spdx-expression-parse` runtime dependency and its
    ambient shim — the dep that once made this package integrated — so
    its tier is now boundary."
