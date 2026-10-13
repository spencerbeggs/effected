---
type: Decision
title: There is no Effect v3 catalog and no camelCase catalog alias
description: The effect3/effect3:peers catalogs and the effectPeers/effect3Peers camelCase aliases are retired and must not be reintroduced.
status: draft
tags:
  - release
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 9e620f04a9283674
---

# There is no Effect v3 catalog and no camelCase catalog alias

## Context

`@effected/pnpm-plugin-effect` once carried `effect3` / `effect3:peers`
catalogs tracking the Effect v3 line, so a package could be tested
against both the v3 and v4 majors during the migration, plus camelCase
aliases (`effectPeers`, `effect3Peers`) shadowing the colon-form catalog
names. The workspace has since completed its move to Effect v4.

## Decision

There is no Effect v3 catalog and no camelCase catalog alias, and neither
may be reintroduced. Nothing in the workspace carries Effect v3 any
longer, so an interop catalog tracking it would be dead configuration
with no consumer. The generator emits colon-form catalog names only
(`effect`, `effect:peers`, `effected`, `effected:peers`) — this is the
whole set.

## Alternatives rejected

**Keep the v3 catalogs dormant in case a future package needs dual-major
testing.** Rejected because a catalog that resolves nothing and is
consumed by nothing is dead weight in the generator's own definitions,
and reviving it speculatively ahead of an actual need would mean
maintaining version data for a major line the workspace has fully
migrated away from, with no way to verify the data stays correct absent a
real consumer exercising it.

**Keep the camelCase aliases for backward compatibility with any external
reference to them.** Rejected because the aliases existed only to shadow
the colon-form names during the transition, and no supported consumer
usage pattern in this kit's documentation or README ever referenced the
camelCase spelling as the primary form.

## Consequences

A catalog name spelled `effect3`, `effect3:peers`, `effectPeers` or
`effect3Peers` appearing anywhere in this workspace — in
`pnpm-workspace.yaml`, in a package manifest, or in `savvy.build.ts` — is
a stale reference to repair, not a surface to restore. Any future
Effect major-version migration that genuinely needs dual-line testing
support designs that support fresh against the current generator, rather
than reviving these retired names.
