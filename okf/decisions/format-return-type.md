---
type: Decision
title: Format entry points never return Effect
description: A three-way return-type rule keyed on whether failure is possible; a tolerant formatter entry point never returns Effect.
status: stable
tags:
  - architecture
  - dx
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e711180080bbff3c
  verified:
    by: human:spencer
    at: 2026-10-23T01:00:25Z
    content: 3af433f9956540df
verified:
  - by: human:spencer
    at: 2026-10-23T01:00:25Z
---

# Format entry points never return `Effect`

## Context

Kit formatters ship into synchronous lint hosts — lint-staged, pre-commit —
per the [format-package convention](../conventions/format-package-convention.md)'s
driving constraint. A return-type rule was needed that both hosts (plain
synchronous callers and Effect-based callers) can use without forcing every
synchronous consumer to build a runtime.

## Decision

A three-way rule, keyed on whether failure is possible:

1. **Cannot fail → total.** Plain return, no wrapper — the shape every one
   of `JsoncFormatter.format`, `YamlFormat.format`, `TomlFormat.format`,
   `MarkdownFormat.format` and `PackageJsonFormat.sortValue` takes.
2. **Can fail, pure and sync → `Result`.** Lifted in one call by
   `Effect.fromResult` for an Effect host, so the `Result` return is strictly
   more useful than an `Effect` return: it serves both host kinds.
3. **`Effect` is not permitted on a tolerant formatter entry point.** Lint
   hosts are synchronous; an `Effect` return forces every one of them to
   build a runtime to format a file.

This generalizes past formatting as the [sync-primitive
policy](../conventions/sync-primitive-policy.md); this rule is that policy's
formatting-specific case.

A known hazard is accepted rather than designed away: totality plus
identity-degradation on unparseable input means a host cannot distinguish
"already correctly formatted" from "unparseable, I gave up." The totals stay
total — narrowing them would break the property that makes them safe in a
lint hook — and every one of these packages exposes a `parse` entry point
carrying typed diagnostics for a host that needs to tell the difference.

## Alternatives rejected

**Returning `Effect` from a tolerant entry point, for consistency with the
rest of the kit's Effect-first surfaces.** Rejected because the driving
constraint is a synchronous host: an `Effect` return would force every
lint-staged handler and pre-commit hook to spin up a runtime just to format
one file, defeating the entire reason the tolerant seam exists.

**Narrowing the total formatters to signal "could not parse" via their
return type.** Rejected as an open question rather than a settled
alternative — see the [format-package convention](../conventions/format-package-convention.md)'s
open notes. Totality is what makes the totals safe in a lint hook; the
`parse` entry point already exists for a host that needs the diagnostic.

## Consequences

A reviewer checks any new formatting entry point against this three-way
table before merge. Adding fallibility to a previously-total entry point is a
breaking signature change (total → `Result`), not a silent behavior change,
because the return type itself documents the failure mode.
