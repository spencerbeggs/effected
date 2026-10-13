---
type: Decision
title: The npm tier guardrail — a non-core runtime dependency in a service escalates the whole package
description: "@effected/npm stays boundary only while its pure vocabulary never reaches IO and index.ts exports individually; a reachability test asserts both from the source graph, and the answer to the named escalation trigger is a package split, never an accepted retier."
status: draft
tags:
  - architecture
  - bundle
sources:
  - id: npm-reachability-test
    resource: ../../packages/npm/__test__/reachability.test.ts
  - id: npm-package-tarball
    resource: ../../packages/npm/src/PackageTarball.ts
  - id: npm-package-json
    resource: ../../packages/npm/package.json
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 4bcf6f7e1a7fc827
---

# The npm tier guardrail — a non-core runtime dependency in a service escalates the whole package

## Context

`@effected/npm` moved from pure to boundary tier when its registry, tarball
and publish services landed, because those services do IO through
core-declared contracts required in `R`. Under the dependency policy's
tier-propagation rule, a *boundary* dependency does not propagate — so
`@effected/lockfiles` (pure) and `@effected/package-json` (boundary) were
able to stay at their own tiers even though both depend on `npm`. That
stability holds only while npm's services keep their IO confined to core
contracts; the moment a service takes a genuinely external runtime
dependency, the package would become integrated, and integrated *does*
propagate under R2 — dragging `lockfiles` and `package-json` up with it.
The question was how to keep that boundary from eroding silently as new
service capability gets added.

## Decision

Two structural properties keep `@effected/npm` at boundary tier, and a
test asserts both directly from the source import graph rather than
relying on review discipline:

1. **The pure vocabulary modules must not reach IO.** `IntegrityHash` and
   its siblings must import neither a service module nor
   `@effected/commands`, so a consumer that only wants vocabulary links
   no HTTP client and no subprocess runner.
2. **`index.ts` must export individually**, never through a namespace
   object — a namespace object is one live binding a bundler cannot see
   through, so importing `IntegrityHash` through one would retain every
   service's whole module graph.

`packages/npm/__test__/reachability.test.ts` checks both from the source
graph and is proven discriminating: adding a `commands` import to a
vocabulary module fails it.[^npm-reachability-test] It exists because the
guardrail was otherwise only prose.

**The escalation trigger, named explicitly:** the moment any service
takes a non-core runtime dependency — an npm client library, a tarball
reader, a registry SDK — the package becomes integrated. The recorded
answer to that day is **not** "accept an integrated npm." It is to split
the services into their own package, leaving the contracts and vocabulary
pure here. That split was considered and rejected *for now*, because the
services' densest dependency is this package's own vocabulary, so
splitting today would buy a package boundary between two halves that talk
constantly for no present benefit. The trigger to revisit is the
guardrail breaking, not taste.

**The rule has since been tested against its own named trigger and
held.** `PackageTarball` needs to unpack a `.tgz`, and the obvious
implementation is a tarball-reader library — the exact named escalation
trigger, verbatim. It extracts instead by shelling out to `tar` through
core's `ChildProcessSpawner`, so the tier stayed unmoved and `lockfiles`
stayed pure.[^npm-package-tarball] That is a tier decision, not a
convenience: the cost is that a consumer off a CI runner image needs both
a spawner and the `tar` binary, and paying that cost was judged cheaper
than moving three packages' tiers.

## Alternatives rejected

- **Accept the retier to integrated** once a service needs a real
  registry/tarball library, on the theory that the package already does
  real IO and one more dependency changes nothing qualitative. Rejected
  because R2 propagation is not free: it would move `lockfiles` (pure)
  and `package-json` (boundary) to integrated too, and every consumer of
  those two pays the widened peer closure for a dependency neither of
  them actually needs.
- **Split the services out of `@effected/npm` preemptively**, before any
  concrete trigger forces the question, to keep the pure vocabulary
  permanently insulated. Rejected because the services' heaviest
  dependency today is the package's own vocabulary — splitting now would
  create a package boundary between two halves that constantly talk to
  each other, for a hypothetical future dependency that has not
  materialized.
- **Trust code review alone** to keep the pure vocabulary modules from
  acquiring an IO import over time. Rejected in favor of an automated
  reachability test, because the guardrail is exactly the kind of
  constraint that erodes silently one import at a time without a test
  that actively fails on the violation.

## Consequences

Any future service capability added to `@effected/npm` — a new registry
operation, a richer tarball inspection, an extended publish flow — must
be checked against whether it can still be built on core contracts alone.
If it cannot, the guardrail's own recorded answer applies: split the
services, do not retier the package. `packages/npm/package.json`'s
`dependencies` staying at exactly `{ "@effected/commands": "workspace:^" }`
is the observable proof the guardrail currently holds — zero external
runtime dependencies.[^npm-package-json]

[^npm-reachability-test]: `packages/npm/__test__/reachability.test.ts:5-15,24-70`
    — the confinement test asserting vocabulary modules import no IO
    module and that `index.ts` exports individually.
[^npm-package-tarball]: `packages/npm/src/PackageTarball.ts` — extraction
    shells out to `tar` through core's `ChildProcessSpawner` rather than
    taking a tarball-reader dependency.
[^npm-package-json]: `packages/npm/package.json` — `"dependencies": {
    "@effected/commands": "workspace:^" }`, the package's only runtime
    dependency.
