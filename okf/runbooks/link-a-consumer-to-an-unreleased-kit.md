---
type: Runbook
title: Link a consumer to an unreleased kit build
description: Point an external consumer's manifest at an unpublished @effected build safely, so the consumer resolves one effect instance and no sibling overrides are needed.
status: stable
tags:
  - dx
  - compat
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: e214a3d0f315b375
---

# Link a consumer to an unreleased kit build

## Trigger

A dogfood loop or an early integration needs a consumer repository to run
against a kit package's unreleased, unpublished build rather than the
last published version on the registry.

## Steps

1. **Do not use a plain `link:` or `file:` protocol on its own.** Left
   alone, either resolves the linked package's own dependencies —
   `effect` and its `@effected` siblings — from the *kit's* tree rather
   than the consumer's, producing the two-instance failure described in
   [the green-typecheck trap](../gotchas/link-override-passes-typecheck-with-two-effects.md).
2. **Point the consumer's manifest at the kit package with `file:`, and
   add `dependenciesMeta.<pkg>.injected: true`** for that package. This
   combination makes pnpm materialize a real, separate copy of the linked
   package whose own dependencies resolve from the *consumer's* tree —
   one `effect`, one of everything, and no sibling overrides required at
   all.
3. **Clean the lockfile before installing after any change to an injected
   override.** A plain install over a stale lockfile entry replays the
   previous resolution and silently keeps the old link in place, so the
   consumer keeps testing against a build that no longer matches what was
   just changed.
4. **Run the install a second time if the first one leaves a dangling
   symlink.** The first install can leave a symlink that points at
   nothing yet; a second install is what actually materializes the
   injected copy correctly.
5. **Take the eventual release pin from the release itself, never from
   the linked build's own `package.json` version field** — a branch build
   reports the previous release's version, not the one about to ship.

## End state

The consumer's install resolves exactly one copy of `effect` and every
`@effected` package it depends on, sourced from the consumer's own
dependency tree rather than the kit's, with the linked package's code
coming from the kit's unreleased build. A typecheck and a full test run
against this state reflect the unreleased build's real behavior, not an
artifact of chasing type identity errors by linking siblings.
