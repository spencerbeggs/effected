---
type: Interface
title: "@effected/workspaces release surface"
description: PublishabilityDetector, VersioningStrategy, and ReleaseTag — the release-shaped questions the workspace model already holds the facts for.
status: stable
kind: api
resource: ../../packages/workspaces/src/Publishability.ts
tags:
  - architecture
  - release
sources:
  - id: publishability-ts
    resource: ../../packages/workspaces/src/Publishability.ts
  - id: versioning-strategy-ts
    resource: ../../packages/workspaces/src/VersioningStrategy.ts
  - id: release-tag-ts
    resource: ../../packages/workspaces/src/ReleaseTag.ts
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 60ef126d7f84c6a06c5c56d58fad461629a46665f613f4b07a77916270a9e7a5
verified:
  - by: human:spencer
    at: 2026-09-24T00:12:03.300Z
---

# @effected/workspaces release surface

Three modules answer the release-shaped questions the workspace model
already holds the facts for: does this package publish, and to where;
how does this workspace version; and what is the git tag called.
`Publishability.ts`, `VersioningStrategy.ts`, and `ReleaseTag.ts` reach into
the rest of `@effected/workspaces` only through
[discovery](workspaces-discovery.md) and the located-member model. They
ship inside this package rather than as their own package because they are
meaningless without a discovered workspace, and the swappable half is one
small service.

## PublishabilityDetector

A `Context.Service` deciding whether a package publishes and to where. Its
shape is an exported interface, for symmetry with the discovery service's,
so a consumer overriding it can name the type it is implementing without
reaching into the class.[^publishability-ts]

No composite provides or requires a detector. `Workspaces.layer()` and its
variants neither supply one nor widen their own requirements, because
nothing inside a composite consumes a detector — the requirement surfaces
only where a program actually asks a publishability question
(`VersioningStrategy.detect`'s `R`), and is enforced wherever `R` must be
closed. With no default to shadow, a caller's own detector merged over the
composite in either order behaves the same way, which matters because the
earlier shape — a composite that baked in npm semantics as a default — made
an override silently order-dependent in the dangerous direction: merging a
custom detector before the composite resolved, with no type error and no
warning, back to "publishes to the public registry with public access",
the worst available failure mode for a service that decides where a
package publishes.

`Layer.provide(detector)` feeds the detector into the composite's
requirements, and since the composite requires nothing, the provide
satisfies nothing and the detector is discarded, taking the service back
out of the resulting layer's output; the correct form is
`Layer.mergeAll(Workspaces.layer(), detectorLayer)`. This is a live defect
class, not a style preference.

The shipped policies — npm semantics and a publishes-nothing policy — are
reachable as values, with layers built over them; there is no bare `layer`
static, since a static called `layer` would read as "the" layer once no
composite provides one. The npm policy implements npm's semantics
specifically: private with no publish-config access publishes nowhere, an
explicit publish-config access overrides private, and anything else
publishes to the public registry.

`detect`'s error channel is deliberately `never`, because every caller —
most of all the release planner iterating a whole workspace — treats "does
this publish?" as a total question. An overriding layer whose lookup can
fail has exactly two honest moves: fold the recoverable failure into a safe
answer, usually the empty target list, or die into the defect channel; it
may not widen the channel the contract declares. `detect` returns a target
list rather than a richer classification, because every consumer surveyed
asks exactly one question of it — whether the list is non-empty.

## VersioningStrategy

Neither this nor `ReleaseTag` is a service: a service shape carries only
effectful members, and both halves here are total pure functions, so
wrapping classification and formatting in `Effect` with `never` error
channels purely to fit a service shape would be exactly the anti-pattern
that rule prevents.[^versioning-strategy-ts]

`classify` is total, answering single, fixed-group, or independent. Names
are de-duplicated before counting, or a duplicated name misclassifies a
one-package repo as independent and cuts per-package tags for it. Lockstep
requires one single group to cover the publishable set — two groups
covering it between them mean the packages move separately, so a naive
"are there any fixed groups?" test is wrong. A group naming non-publishable
or nonexistent packages still counts, because groups describe the whole
repository rather than the publishable slice. Fixed groups are a plain
argument, never read from a file, because they are a release tool's concept
and a workspace-model package that read that tool's config file would be
adopting one tool's schema and one tool's release policy.

`detect` is the one effectful member, over discovery and publishability:
enumerate, keep what publishes somewhere, classify. Asking publishability
through the service is the point — a consumer honouring a release tool's
ignore list swaps the layer rather than filtering afterward.

## ReleaseTag

A leaf module importing nothing else in the package.[^release-tag-ts] The
version prefix defaults to empty, uniformly, with strict SemVer — see
[the strict-default gotcha](../gotchas/releasetag-strict-semver-default.md)
for the divergence this creates from a common scoped/unscoped `v`-prefix
convention. Git tag history is not an API: pre-1.0 breaking-change freedom
covers this package's own code, not a consumer's existing tags, so a
consumer that wants a `v`-prefixed convention passes the prefix explicitly.
Only a leading `@` makes a name scoped. Formatting is total: the only prior
failure cause was an empty version, which a non-empty-string schema now
catches during construction, so a bad version reaching these statics is
developer wiring rather than untrusted input and dies as a defect.

### TrackingTag — the floating alias family

Release tags are strict SemVer and immutable. Tracking tags are the
deliberately-not-SemVer alias family — a truncated major or major-minor,
re-pointed at whatever release is newest in that line, which is the GitHub
Actions distribution convention. A tracking tag is its own concept, not a
third tag style, because it is derived *from* a version rather than being a
way of formatting one.

Three properties are load-bearing: a prerelease derives nothing, and the
override is off by default, because anyone depending on a major alias is
asking for the newest stable release in that line; build metadata is not a
prerelease, since build metadata carries no precedence meaning in SemVer,
and stripping it before testing for a prerelease marker is what makes
derivation correct; and derivation is total and never throws, because this
is a query about a version rather than a validation of one, and the
workspace model's version field is deliberately tolerant. 0.x versions do
derive aliases — floating a `v0` alias across 0.x minors is a genuine
hazard, but which aliases to publish is policy decided where tags are
moved, not something a derivation should quietly withhold. Moving a git tag
is not this module's business; the module derives, formats, and parses,
and re-pointing is a consumer concern over `@effected/git`.

### Classification

The recognition half answers, for any tag string, whether it is a release
tag, a tracking alias, or neither. The families are told apart by segment
count, not by the `v` prefix — three numeric segments is a version, with or
without the prefix; one or two is a truncated alias, and the `v` is
required on an alias because a bare number is neither valid SemVer nor the
convention. Unrecognized is a real answer rather than a failure, because a
repository's tags include release channels, branch names, and whatever else
humans wrote. Round-tripping is a tested property in both directions: every
tag the formatters produce classifies back to its own family with fields
intact.

`@effected/semver` was consciously declined here: the tracking-tag grammar
is not SemVer, and the derivation needs only the three numeric segments
plus the presence of a prerelease — a handful of lines, for which a
dependency edge is disproportionate. It earns itself the day something here
needs real semver comparison, which no caller asks for today, because
choosing what a tracking tag should point at is the consumer's decision,
made where the tag is moved.

## Folding them together

`VersioningStrategy`'s tag derivation folds classification and formatting
into one call, collapsing a consumer's hand-rolled strategy-determination
code to two lines. Under the lockstep strategies it returns exactly one tag
carrying the first release's version; a lockstep batch shares a version by
construction, so the choice is visible only on a batch that should not
exist, which is why a fixed-versioning flag is deliberately not provided —
it stays the caller's one-line check.

[^publishability-ts]: `packages/workspaces/src/Publishability.ts` —
    `PublishabilityDetector`, `PublishTarget`.
[^versioning-strategy-ts]: `packages/workspaces/src/VersioningStrategy.ts` —
    `VersioningStrategy`, `VersioningStrategyType`, `ClassifyOptions`,
    `VersioningDetectOptions`, `PackageRelease`.
[^release-tag-ts]: `packages/workspaces/src/ReleaseTag.ts` — `ReleaseTag`,
    `TagStyle`, `TagFormatOptions`, `TrackingTag`, `TrackingTagOptions`,
    `classifyTag`, `TagClassification`.
