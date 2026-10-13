---
type: Decision
title: "github's github-references compat re-export is droppable, not breaking"
description: Why the six-name re-export in @effected/github exists, and why removing it later is not a breaking change for the consumer that already adopted the new home.
status: draft
tags: [bundle, compat]
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: ea48fe796670ea49
---

# github's github-references compat re-export is droppable, not breaking

## Context

When the issue-reference grammar moved from `@effected/github` into
`@effected/github-references` (see
[the extraction decision](github-references-extracted-for-install-weight.md)),
consumers that had already adopted the grammar from its old home would
otherwise fail to compile the moment `github` stopped exporting those
names.

## Decision

`@effected/github`'s entry point re-exports exactly the six names the
grammar was extracted from it under: `CLOSING_KEYWORDS`, `ClosingKeyword`,
`IssueReference`, `harvestIssueReferences`, `BareLineReference`,
`parseBareLineReference`. Nothing else moves back: the closing-list dialect
(`parseClosingList`, `parseReferenceList`) and the companion surfaces
(`harvestReferenceLists`, the per-line helpers, `keywordFamily`,
`collectReferenceLists`) are deliberately not re-exported, so the compat
surface cannot widen by accident.

`packages/github/__test__/IssueReferencesCompat.test.ts` exercises the
value exports through the entry point and annotates values with the type
exports, so compiling the suite is itself the assertion that the promise
holds — a future bump that drops the re-export deletes that suite
deliberately, which is the point: the surface cannot lapse silently.

## Alternatives rejected

- **Keep the full grammar re-exported from `github` indefinitely.** This
  would make `github` carry the whole grammar's surface forever, defeating
  the reachability goal the extraction exists to serve.
- **Drop the re-export immediately at extraction.** This would break every
  consumer that had adopted the grammar in its old home with no migration
  window.

## Consequences

Removing the re-export at a later `github` release is **not** a breaking
change for a consumer that has migrated to importing
`@effected/github-references` directly — it is a breaking change only for a
consumer still importing those six names through `@effected/github`, and
that consumer's fix is a one-line import-path change. The re-export is
explicitly a migration affordance rather than a permanent surface, and
widening it beyond the original six names is treated as a design decision
each time it comes up, not a default.
