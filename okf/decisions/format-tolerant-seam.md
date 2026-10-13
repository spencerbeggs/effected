---
type: Decision
title: Only package-json needs a tolerant formatting seam
description: package-json is the one format package that adds a tolerant entry point; the other four and config-file add no new surface.
status: draft
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e816aafe3e82278b
---

# Only `package-json` needs a tolerant formatting seam

## Context

The [format-package convention](../conventions/format-package-convention.md)'s
P1 rule requires a tolerant path to be its own named entry point rather than
a flag. Given that rule, the kit had to decide, package by package, whether a
tolerant seam needs to be added at all.

## Decision

Only `package-json` needs a new tolerant seam. `yaml`, `toml`, `jsonc` and
`markdown` add no new surface: their formatters (`YamlFormat.format`,
`TomlFormat.format`, `JsoncFormatter.format`, `MarkdownFormat.format`) are
already total, already edit-based, already identity-degrading on unparseable
input. `config-file` is out of scope entirely, deliberately.

## Alternatives rejected

**Mandating a parallel tolerant entry point on all five packages for
uniformity.** Rejected because a mandated tolerant twin on `yaml`, `toml`,
`jsonc` or `markdown` would be an alias for an existing total function — dead
surface that has to be maintained and documented forever for no behavioral
gain. What these four take on from the convention instead is the [fidelity
obligation](format-fidelity-obligation.md), a testing change rather than a
surface change.

**Adding a tolerant seam to `config-file`'s codec pipeline.** `config-file`'s
codec seam is a loading pipeline where decode-and-validate is the entire
point, hosted by an application at startup rather than a synchronous lint
hook — neither the C1 hard-fail constraint nor the synchronous-host
constraint applies there. A tolerant path would mean "load this config but
don't check it," which is not a capability anyone wants. Recorded here so the
question is not reopened.

## Consequences

A convention that mandates surface nobody calls is worse than no convention;
four of five packages correctly opting out is the expected outcome of this
decision, not a sign the convention under-reaches. `package-json`'s tolerant
seam (`LenientManifest`, `PackageJsonFormat.sortValue` /
`.formatToString`) is the one place a reviewer checks for a `{ strict: false
}`-shaped flag creeping back in.
