---
type: Gotcha
title: ReleaseTag defaults to strict SemVer with no version prefix
description: A repository whose git tag history uses a v-prefixed convention gets bare-SemVer tags from ReleaseTag by default, silently diverging from its own existing history unless versionPrefix is passed explicitly.
status: stable
resource: ../../packages/workspaces/src/ReleaseTag.ts
stale_after: "2027-03-13T00:00:00Z"
tags:
  - release
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 8bcc893847e97d52
---

# ReleaseTag defaults to strict SemVer with no version prefix

## What a reader sees

A repository whose existing git history uses `v`-prefixed release tags
(`v1.2.3`) adopts `@effected/workspaces` for tagging, calls
`ReleaseTag.single` or `ReleaseTag.scoped` with no options, and gets a tag
back that looks like ordinary SemVer.

## What they would wrongly conclude

That the produced tag follows the repository's existing convention,
because nothing about calling the constructor without options signals
that a prefix decision was made on the caller's behalf.

## What is actually true

`ReleaseTag`'s version prefix defaults to empty, uniformly, producing
strict SemVer tags with no leading `v`. This is a deliberate choice rather
than an oversight: a `v`-prefix convention is not a universal default to
inherit, and two prior implementations disagreed about it — one even
contradicting its own doc comment — so once the kit had to pick one
default, strict SemVer is the one it kept. Git tag history is not treated
as an API the kit must match: pre-1.0 freedom to make breaking choices
covers the kit's own code, not a consumer's pre-existing tag history. A
repository with `v`-prefixed tags that adopts the default silently starts
producing a second, incompatible tag family alongside its existing
history.

## The check

Pass `versionPrefix: "v"` explicitly to `ReleaseTag.single` or
`ReleaseTag.scoped` when the target repository's existing tag history
uses that convention, or keeps it going forward.[^release-tag] Verify by
comparing a freshly produced tag against the repository's most recent
existing release tag before the first real release through the new
tooling.

[^release-tag]: `packages/workspaces/src/ReleaseTag.ts:8-13,54,346,364` —
    the module comment states the default is `""` uniformly with strict
    SemVer, and `TagFormatOptions.versionPrefix` is the escape hatch both
    `single` and `scoped` read.
