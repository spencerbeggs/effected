---
type: Convention
title: Pin heavy-dependency confinement with a reachability suite that has a positive control
description: A structural test walks a package's runtime import graph to prove which modules may reach a heavy dependency, and must also prove it can fail.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - bundle
  - testing
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 70812bcecfba9d7e
---

# Pin heavy-dependency confinement with a reachability suite that has a positive control

Never assert a heavy-dependency confinement claim by inspection or by
convention alone — pin it with a `__test__/reachability.test.ts` that
walks the **runtime import graph of `src`** statically (type-only imports
skipped, since they are erased at build time) and asserts two things
together: that no module outside the declared permitted set imports the
heavy dependency, **and** that the permitted modules do import it. A test
that only asserts the first half can pass for the wrong reason — a walker
bug that under-reports imports produces a suite that is always green,
which is a confinement test that can never fail. This pattern is used by
[`github-actions`](../modules/github-actions.md) (Azure, `markdown`,
`npm` — see
[Azure is confined to three modules](../decisions/azure-blob-confined-to-three-modules.md)),
`github`, [`sbom`](../modules/sbom.md) (`@sigstore/*`) and `schema-org`.

Get the comment-stripping order right before trusting the walker at all.
Stripping block comments before line comments is the wrong order: a `/*`
token appearing inside prose in a **line** comment (for example the
backtick-quoted `` `@sigstore/*` `` in a doc comment) opens what the
walker treats as a block comment, deleting everything up to the next
`*/`-terminated doc comment — imports included. `packages/sbom/src` hit
this exactly: a module importing `effect` was reported as importing
nothing at all, because prose describing the confinement itself broke the
walker meant to check it. Strip line comments first. This failure mode is
silent and lands in the **safe** direction (nothing looks like it imports
the heavy dependency), which for a confinement test is the worst
direction there is, since a green suite gives no signal that anything is
wrong.

Be precise in the concept's prose about which graph the suite constrains.
It constrains the **import** graph of `src`, never the **resolver**
graph: a heavy dependency confined to N modules is still a declared
dependency of the whole package, so every consumer installs it and a
bundler's resolver walks it regardless of which module names it. Whether
an unreferenced module is then dropped from a consumer's bundle is the
bundler's decision, resting on the package declaring `"sideEffects":
false` (which the suite should also assert) plus module-per-file build
output. State the confinement claim as "no import edge exists, so a
tree-shaking bundler can drop the module" — never as "the dependency is
absent from the consumer's tree", which the suite does not prove and
resolver-graph reality contradicts whenever a sibling module inside the
same package takes the heavy edge for an unrelated reason (as
`github-actions` does through its `sbom` edge into the Sigstore stack).

Revisit this convention when a package's build moves off per-module
output or when a reachability suite is added without the positive-control
assertion, since either change reopens the failure mode this convention
exists to close.
