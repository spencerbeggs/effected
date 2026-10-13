---
type: Decision
title: tsconfig-json is one package, not a pure-schema/boundary-IO split
description: tsconfig-json keeps schemas and file IO in one boundary-tier package rather than splitting into a pure schema package plus a separate IO package.
status: draft
tags:
  - architecture
  - bundle
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
integrity:
  generated:
    body: 0581cb4db00fb4aa
---

# tsconfig-json is one package, not a pure-schema/boundary-IO split

## Context

`@effected/tsconfig-json` has a clear internal seam: pure schema and codec modules that never touch `FileSystem`, and loader/resolver/discovery modules that do. That internal seam looks, on its face, like an argument for splitting the package in two — a pure schema package a consumer could take without any IO surface, and a separate boundary package for the loading, resolving and discovery machinery.

## Decision

`@effected/tsconfig-json` ships as **one boundary-tier package**. The pure/IO seam is kept as internal module architecture only — pure schema and codec modules that never import `FileSystem`, alongside separate loader, resolver and discovery modules that do — never as a package boundary.

## Alternatives rejected

Splitting into a pure schema package plus a boundary IO package was rejected for four reasons:

- **The dependency-tier rule already delivers the split's benefit.** Boundary tier does not propagate ([R3](../glossary/library-tier.md)), and a schema-only consumer pays no install cost for the IO surface, because `FileSystem`/`Path` are core in v4 and the package carries zero external runtime dependencies. A separate package would not buy a schema-only consumer anything they do not already have.
- **The no-barrel, module-per-concept discipline already gives bundle isolation.** A consumer importing only the schema modules never references the loader modules, so their graphs tree-shake away regardless of package boundaries — modules, not packages, are the unit of bundle isolation here.
- **The pure package could not even be `jsonc`-free.** String→document decoding belongs with the schemas, and every tsconfig is JSONC, so a "pure" half would still carry the `jsonc` edge — the split would not even produce a genuinely dependency-free artifact.
- **Precedent runs toward consolidation, not division.** `package-json` is one package spanning schemas and file IO, with no quarantine motive recorded there either; splitting `tsconfig-json` would be inconsistent with that precedent for no offsetting benefit.

## Consequences

A consumer that only wants the schemas (say, to validate a tsconfig shape without touching a filesystem) still installs the whole `tsconfig-json` package, but their bundle tree-shakes down to exactly the modules they import — the split cost is paid at the module level, not avoided at the package level. The package's internal directory structure (pure schema/codec modules separate from loader/resolver/discovery modules) remains a meaningful contributor-facing distinction even though it is invisible to a consumer choosing what to install.
