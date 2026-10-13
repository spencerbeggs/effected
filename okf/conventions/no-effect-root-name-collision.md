---
type: Convention
title: A public name must not collide with an effect root export
description: Check every candidate public name against effect's root exports before committing to it, because every consumer in this ecosystem already imports from effect.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
  - dx
sources:
  - id: effect-root-index
    resource: ../../.repos/effect/packages/effect/src/index.ts
  - id: schema-org-src
    resource: ../../packages/schema-org/src
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 0af03290b3451635
---

# A public name must not collide with an effect root export

Every consumer file in this ecosystem already imports from `effect`, so a
kit name that duplicates a core root export is not an unlucky edge case —
it is the default import situation, forcing an alias at the call site or,
worse, letting a reader resolve the name to the wrong construct silently.

Check a candidate public name against `effect`'s root exports before
committing to it. `effect`'s root barrel re-exports each module under its
own name (`export * as Ref from "./Ref.ts"`, and likewise for every other
top-level module), so the check is a single grep against that
list.[^effect-root-index] The check is cheap and the rename is not:
renaming a published symbol is a breaking change, and the collision is
easiest to see before anyone depends on it.

## The rule constrains public names only

A package's internal or build-time code may legitimately import and use
the core construct under its own name. Using `effect`'s `Graph` inside a
generator script to assert acyclicity, for example, is exactly right and
must not be "corrected" — the rule is about the name a consumer sees on
the kit's own public surface, not about which core modules a package is
allowed to import.

## The worked example: schema-org's three renames

`@effected/schema-org` moved three names off a collision with a core root
export: `Graph` → `JsonLdDocument`, `GraphNode` → `JsonLdNode`, and `Ref`
→ `NodeRef`.[^schema-org-src] Two lessons generalize from it:

- **`Ref` is the sharpest name to avoid.** Core's `Ref` is among the most
  used constructs in the ecosystem and means a mutable reference cell;
  any domain meaning of "reference" collides with it head-on.
- **Treat a collision as a prompt to re-ask whether the name was right.**
  `Graph` turned out to name the *key* (`@graph`) of the JSON-LD document
  rather than the document itself, and the class's own documentation
  already called it a document — so the forced rename produced a name
  that was better independently of the collision it fixed. Expect this
  outcome often enough that a collision is worth treating as a design
  signal, not just an obstacle to route around.

[^effect-root-index]: `.repos/effect/packages/effect/src/index.ts` — the
    root barrel that re-exports every top-level module by name, including
    `Ref`, `Graph` and every other collision candidate.
[^schema-org-src]: `packages/schema-org/src/JsonLdDocument.ts` (which
    also defines `JsonLdNode`) and `packages/schema-org/src/NodeRef.ts` —
    the classes that would otherwise have collided with core's `Graph`,
    `GraphNode` and `Ref`.
