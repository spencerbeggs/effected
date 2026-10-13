---
type: Gotcha
title: A branch build's dist/ carries the previous release's version
description: An unreleased branch's dist/** manifest reports the last published version number, identical to what the registry is already serving — a consumer linked against that build must take its pin from the release, never from the linked artifact's own version field.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - release
  - dx
sources:
  - id: root-claude-releases
    resource: ../../CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 184731f30a07ccc8
---

# A branch build's dist/ carries the previous release's version

## What a reader sees

A consumer is linked against a local build of an `@effected/*` package on
an unreleased branch — via a `file:` override or a workspace link — and
inspects the linked artifact's `package.json`. The version field reads,
say, `0.8.0`. `npm view @effected/<pkg> version` against the registry
also reports `0.8.0`.

## What they would wrongly conclude

That the linked build and the published package are the same code, or
that pinning a consumer's dependency range from the linked artifact's
version is safe because it matches what is already on the registry.

## What is actually true

Changesets bump a package's version at release time, not at build time.
`dist/**` on an unreleased branch is built from the unreleased source but
still carries the *previous* release's version number in its manifest,
because nothing has run the version-bump step yet. The registry is
serving that same previous number. So a consumer linked against the
branch build and a consumer resolving the registry package both see
identical version strings for genuinely different code — the linked
build contains work that has never shipped.

A dogfood consumer that derives its post-unlink pin from the linked
build's version therefore resolves, on its next clean install, to
registry code it has never actually run against.

## The check

Never read a version number off a linked build's `package.json`. Take
the version from the release itself: the `release` mail in a dogfood
loop, or `npm view <pkg> version` run *after* the release actually
publishes. The upstream package owes the consumer that number explicitly
at hand-off, for exactly this reason — the number is not something the
artifact can tell you on its own.[^root-claude-releases]

[^root-claude-releases]: `CLAUDE.md` §Commands — the release model this
    gotcha follows from: "Releases are changeset-driven: CI builds the
    changesets and releases the packages they name."
