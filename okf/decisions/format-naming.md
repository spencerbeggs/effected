---
type: Decision
title: "Format-package naming is `*Format`, not `*Unvalidated`"
description: "The `*Format` concept class with total statics is the kit's naming convention; `*Unvalidated` is rejected."
status: draft
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 9a9966b582e8f2db
---

# Format-package naming is `*Format`, not `*Unvalidated`

## Context

Four of the kit's five format packages — `jsonc`, `yaml`, `toml`, `markdown`
— converged independently on a `*Format`/`*Formatter` concept class exposing
`format` (edits) and `formatToString` (bytes→bytes), per the [format-package
convention](../conventions/format-package-convention.md). The fifth,
`package-json`, differs because it alone decodes against a schema. A naming
convention was needed for the shared shape before any of these surfaces
shipped and became unchangeable.

## Decision

The `*Format` concept class with total statics is the kit's naming
convention. `formatToString` is the shared name for the bytes→bytes shape, so
a consumer who has met one kit formatter has met them all
(`packages/jsonc/src/JsoncFormatter.ts:48`, `packages/yaml/src/YamlFormat.ts:826`,
`packages/toml/src/TomlFormat.ts:790`, `packages/markdown/src/MarkdownFormat.ts:673`,
`packages/package-json/src/PackageJsonFormat.ts:196`). A package-specific
shape gets a package-specific name instead of being forced into the shared
one — `package-json`'s value-path entry point is `sortValue`
(`packages/package-json/src/PackageJsonFormat.ts:159`), not `format`, because
its shape (`T → T`) differs from the other four's (`string →
ReadonlyArray<Edit>`).

The guarantee a formatter makes lives in the class's doc comment, where it
can be stated precisely, rather than compressed into a name prefix.

## Alternatives rejected

**`*Unvalidated`.** Accurate for `package-json`, which has a decode step to
skip, and wrong everywhere else. `yaml`, `toml`, `jsonc` and `markdown` have
no validation to be un-done — their tolerant/strict distinction is about
fidelity and error tolerance, not schema decoding. The axis worth naming is
not "validated" but whether the path decodes at all: a decode-free path
cannot normalize, because it never looks at the field, and *source-preserving*
is the guarantee a consumer is actually shopping for.

## Consequences

A reader who has used `JsoncFormatter.formatToString` recognizes
`YamlFormat.formatToString` on sight, and can predict that a package with a
genuinely different shape (`package-json`) will diverge in the value-path
name while keeping the shared text-path name. New format surfaces added to
the kit are checked against this naming before they ship, since renaming a
published static is a breaking change.
