---
status: current
module: effected
category: architecture
created: 2026-08-12
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 92
related:
  - ../effect-standards.md
  - ../releases.md
  - workspaces.md
  - workspaces-discovery.md
  - npm.md
  - git.md
  - semver.md
---

# @effected/workspaces release surface design

## Overview

Three modules inside [@effected/workspaces](workspaces.md) answer the **release-shaped** questions the workspace model already holds the facts for: *does this package publish, and to where*, *how does this workspace version*, and *what is the git tag called*. They are split out here because they form a cohesive subsystem — `Publishability.ts`, `VersioningStrategy.ts` and `ReleaseTag.ts` reach into the rest of the package only through [discovery](workspaces-discovery.md) and the located-member model, and everything else in workspaces is about *structure* rather than *releases*.

They ship inside `@effected/workspaces` rather than as their own package because they are meaningless without a discovered workspace, and the swappable half is one small service.

## PublishabilityDetector

A `Context.Service` deciding whether a package publishes and to where. Its shape is an **exported interface**, for symmetry with the discovery service's: a swappable service whose whole point is that consumers override it must let a consumer *name the type they are implementing* without reaching into the class.

### There is no ambient default

**The composites neither provide nor require a detector.** `Workspaces.layer()` and its variants do not supply one, and their own requirements are unchanged, because nothing *inside* a composite consumes a detector. The requirement surfaces where a program actually asks a publishability question — in `VersioningStrategy.detect`'s `R` — and is enforced wherever `R` must be closed.

This is the shape to preserve, and the failure it exists to prevent is specific. When the composite baked npm semantics in, the override was **silently order-dependent in the dangerous direction**: merging a custom detector *before* the composite resolved to the default, with no type error and no warning. For a service that decides whether a package publishes and to which registry, a silent revert to "publishes to the public registry with public access" is the worst available failure mode, and it was one word-order away at every call site. With no default to shadow, **both merge orders are now safe**, and a regression test pins a caller's detector observed through the composite in both.

Two consequences worth knowing:

- **The mechanism is "the composite provides nothing", not "the composite requires it".** A consumer that uses discovery, catalogs or lockfiles and never asks a publishability question is never made to supply a publish policy.
- **The diagnostic can land far from the wiring.** A missing detector fails to close `R` at the downstream operation that names it, which may be distant from the layer-composition site. That is the accepted cost of the requirement living where it is genuinely consumed.

### Merge sideways; provide downward

`Layer.provide(detector)` feeds the detector *into* the composite's requirements — and since the composite does not require one, the provide satisfies nothing and the detector is **discarded**, taking the service back out of the resulting layer's output. The program then fails to close `R` at whichever operation asks the publishability question, for a reason the wiring line does not suggest. **The correct form is `Layer.mergeAll`.** This is a live defect class, not a style preference; a published changelog once shipped the wrong form and a consumer copied it.

### Policies are values, not only layers

The shipped policies are reachable as **values** — npm semantics and a publishes-nothing policy — with layers built over them. There is no bare `layer` static: a static called `layer` reads as "the" layer, and once no composite provides one, the name must say which policy it is.

The value form is load-bearing, and it generalizes past this seam: **any shipped implementation of a swappable contract should be reachable as a value, not only as a layer bound to the tag it occupies.** A consumer composing *around* the default otherwise has to build that layer and provide it to the very tag it is replacing, purely to get a function it could have called — which is exactly what one real consumer had to write.

The npm policy implements **npm's** semantics, not necessarily anyone's: private with no publish-config access publishes nowhere; an explicit publish-config access overrides private; anything else publishes to the public registry.

### The contract is degrade-or-die

`detect`'s error channel is deliberately **`never`**, because every caller — the release planner iterating a whole workspace, most of all — treats "does this publish?" as a **total** question. An overriding layer whose lookup *can* fail therefore has exactly two honest moves: fold the recoverable failure into a safe answer, usually the empty target list, or die into the defect channel. **It may not widen the channel the contract declares.**

This is stated on the service rather than left implied by the signature, because a consumer reading only the type could mistake the `never` for an accident of the default implementation rather than a rule their layer inherits.

### The empty array is an open question, not the answer type

`detect` returns a target list, and it should not become a richer classification **yet**. Every consumer surveyed asks exactly one question of it — whether the list is non-empty — so a reason channel would be speculative API against the kit's ships-on-evidence discipline.

**But the conflation is real and worth recording**: a consumer's adaptive detector returns an empty list for several different facts, and a user asking "why didn't my package release?" cannot be answered from the contract's output. **The trigger to revisit is the first consumer that must *explain* an exclusion rather than act on it**, and the additive shape then is a second method, not a change to `detect` — `detect`'s totality is what makes it cheap to call in a loop over every package.

## VersioningStrategy

**Neither this nor `ReleaseTag` is a service, and the kit-wide rule is what settles it**: a service shape carries only effectful members, and both halves here are total pure functions. Wrapping classification and formatting in `Effect` with `never` error channels purely to fit a service shape is precisely the shape that rule exists to prevent. There is nothing to swap here either — the two genuinely swappable inputs, discovery and publishability, are already services with their own doubles.

`classify` is total, answering single, fixed-group or independent. Two properties are load-bearing and easy to lose:

- **Names are de-duplicated before counting**, or a duplicated name misclassifies a one-package repo as independent and cuts per-package tags for it.
- **Lockstep requires one single group to cover the publishable set.** Two groups covering it between them mean the packages move separately, so a naive "are there any fixed groups?" test is wrong.

A group naming non-publishable or nonexistent packages still counts, because groups describe the whole repo rather than the publishable slice.

**Fixed groups are a plain argument, never read from a file.** They are a release tool's concept, and a workspace-model package that read that tool's config file would be adopting one tool's schema and one tool's release policy. A contract service for group sources is the recorded escalation if a second source ever appears; today there is one, and it lives outside the kit.

`detect` is the one effectful member, over discovery and publishability: enumerate, keep what publishes somewhere, classify. **Asking publishability through the service is the point** — a consumer honouring a release tool's ignore list swaps the layer rather than filtering afterwards.

An empty classification is the canonical "nothing publishable" value at fallback call sites. A named constructor for it was requested and declined: one more name for a value the type already expresses.

## ReleaseTag

A leaf module importing nothing else in the package.

**The version prefix defaults to empty, uniformly**, with strict SemVer. This diverges on purpose from a common scoped/unscoped `v`-prefix asymmetry: that asymmetry was inherited rather than designed — two prior implementations disagreed about it, one contradicting its own doc comment — and once the kit had to pick anyway, strict SemVer is the one worth keeping.

**Git tag history is not an API.** Pre-1.0 breaking-change freedom covers the kit's own code, not a consumer's existing tags, so a consumer that wants a `v`-prefixed convention (or keeps existing `v`-prefixed history) passes the prefix explicitly. Only a **leading** `@` makes a name scoped, so an `@` mid-name is not a scope — that still governs the name/version split, just not the prefix default.

**Formatting is total.** The only prior failure cause was an empty version, which the non-empty-string schema now catches during construction, so every call site sheds an error arm. A bad version reaching these statics is developer wiring rather than untrusted input, so it dies as a defect.

### TrackingTag — the floating alias family

Release tags are strict SemVer and immutable. **Tracking tags are the deliberately-not-SemVer alias family** — a truncated major or major-minor, re-pointed at whatever release is newest in that line. This is the GitHub Actions distribution convention.

**A tracking tag is its own concept, not a third tag style**, because it is derived *from* a version rather than being a way of formatting one: a release tag names one immutable version, while a tracking tag carries a truncated number that is not a version at all. Folding them together would put a mutable pointer and an immutable name behind one type. It lives in the same module because the classifier below has to know both families, so splitting would force one to import the other anyway.

Three properties are load-bearing:

- **A prerelease derives nothing**, and the override is off by default. Anyone depending on a major alias is asking for the newest *stable* release in that line; re-pointing it at a prerelease ships one to every such consumer with no signal.
- **Build metadata is not a prerelease.** Build metadata carries no precedence meaning in SemVer, so a version carrying it is stable and derives normally. **Stripping build before testing for a prerelease marker is what makes that correct**; the obvious wrong implementation treats any suffix as prerelease.
- **Derivation is total and never throws.** A version that is not three numeric segments derives nothing, because this is a query about a version rather than a validation of one — and the workspace model's version field is deliberately tolerant, so odd versions reach here routinely.

**0.x versions do derive aliases.** Floating a `v0` alias across 0.x minors is a genuine hazard, but which aliases to publish is policy decided where tags are moved, not something a derivation should quietly withhold.

**Moving a git tag is not this package's business.** The module derives, formats and parses; re-pointing is a consumer concern over [@effected/git](git.md). That omission is what keeps the module a pure leaf.

### Classification

The recognition half answers, for any tag string, whether it is a release tag, a tracking alias, or neither. The families are told apart by **segment count, not by the `v` prefix** — three numeric segments is a version, with or without the prefix; one or two is a truncated alias. **The `v` is required on an alias**, because a bare number is neither valid SemVer nor the convention, and accepting it would make the classifier guess.

Unrecognized is a real answer rather than a failure, because a repository's tags include release channels, branch names and whatever else humans wrote.

**Round-tripping is a tested property in both directions** — every tag the formatters produce classifies back to its own family with fields intact — which is what makes the classifier trustworthy rather than a parallel guess that can drift from the producers.

### @effected/semver was consciously declined

The tracking-tag grammar is not SemVer, and the derivation needs only the three numeric segments plus the presence of a prerelease — a handful of lines. A dependency edge for that is disproportionate, matching the call [markdown.md](markdown.md) records for its own version grammar.

It earns itself the day something here needs real semver **comparison** — say, deciding whether a release is the newest matching an alias — which no caller asks for, because choosing what a tracking tag should point at is the consumer's decision, made where the tag is moved.

## Folding them together

The strategy's tag derivation folds classification and formatting into one call, which is what collapses a consumer's hand-rolled strategy-determination code to two lines. Under the lockstep strategies it returns exactly one tag carrying the **first** release's version; a lockstep batch shares a version by construction, so the choice is visible only on a batch that should not exist. **Whether a batch actually agreed is a property of that batch, not of the workspace**, so a fixed-versioning flag is deliberately not provided — it stays the caller's one-line check.
