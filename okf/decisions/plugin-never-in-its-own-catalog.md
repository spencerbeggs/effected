---
type: Decision
title: pnpm-plugin-effect is deliberately absent from its own effected catalog
description: Cataloguing @effected/pnpm-plugin-effect inside the effected catalog it ships would create a release loop with no termination condition.
status: draft
tags:
  - release
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: b3586e06fcd0240c
---

# `pnpm-plugin-effect` is deliberately absent from its own `effected` catalog

## Context

`@effected/pnpm-plugin-effect` publishes the `effected` catalog naming
every other publishable kit package's next-release version. The plugin
itself is also a publishable kit package. Whether to include the plugin's
own entry in the catalog it ships inside determines whether the catalog
can ever reach a stable state.

## Decision

`@effected/pnpm-plugin-effect` is deliberately absent from its own
`effected` catalog, and must stay absent. It is the package the catalog
ships inside: cataloguing it means every catalog rewrite bumps the
plugin's own version, which invalidates the catalog the moment it is
written (since the plugin's own version moved), which writes another
changeset to fix that, which bumps the plugin again — a release loop with
no termination condition. The omission *is* the termination condition,
not an oversight. Two tests in
`packages/pnpm-plugin-effect/__test__/catalog.test.ts` pin the omission.

## Alternatives rejected

**Catalogue the plugin and special-case its own version bump to skip
`catalog:sync`.** Rejected because it would require the sync tooling to
recognize and exempt one specific package by name inside its own general
membership and version-drift logic, turning a structural guarantee (the
plugin simply is not a valid target of its own rewrite) into a
special-cased behavioral rule that a future refactor could silently
break.

**Catalogue the plugin at a version that never needs to move.** Rejected
because the plugin does, in fact, release like every other kit package —
freezing its own catalog entry would mean the catalog no longer reflects
reality for the one package readers might reasonably expect it to cover
completely.

## Consequences

A consumer installing this config dependency gets the current
`@effected/pnpm-plugin-effect` version from the registry or their own
`configDependencies` pin, never from the catalog it ships — there is no
`catalog:effected` entry for it to reference. Any future audit or
generator that assumes the `effected` catalog names *every* publishable
kit package must special-case this one exclusion rather than treating its
absence as a bug to fix.
