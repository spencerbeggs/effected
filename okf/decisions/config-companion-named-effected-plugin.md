---
type: Decision
title: "The config companion is named @effected/plugin, not built yet"
description: A future silk-pattern companion package will ship config JSON files and peer-depend on the mcp/cli tools so a consumer's Claude Code plugin and tooling stay on the same versions; the name @effected/plugin is decided, @effected/config is rejected as confusable with @effected/config-file, and the package itself is unbuilt.
status: stable
tags:
  - dx
sources:
  - id: root-package-json
    resource: ../../package.json
  - id: pnpm-plugin-effect-claude
    resource: ../../packages/pnpm-plugin-effect/CLAUDE.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: f96390bfa6f119f68f3db354d64c56905aa85cfacbe829dc68c29c15f75d384e
verified:
  - by: human:spencer
    at: 2026-10-09T17:01:48Z
---

# The config companion is named @effected/plugin, not built yet

## Context

`@savvy-web/silk` and `@vitest-agent/plugin` are companion packages this
repo already depends on: each ships preconfigured tooling and config so a
consumer's plugin and its CLI/MCP tools stay on matched
versions.[^root-package-json] The kit's own companion,
`@effected/pnpm-plugin-effect`, already follows that shape for the Effect
catalogs — a category, not a tier, since it exposes no API and nothing
may depend on it.[^pnpm-plugin-effect-claude] A second companion was
proposed to carry the kit's own agent-tooling configuration in the same
way, and its name needed deciding before any implementation started.

## Decision

The proposed package is a silk-pattern companion, following
`@vitest-agent/plugin` and `@savvy-web/silk`: it would ship config JSON
files and peer-depend on the kit's mcp/cli tools, so a consumer's Claude
Code plugin and its tooling stay on the same versions. It would ship
preconfigured tsconfigs, potentially including a tsgo LSP tsconfig once
that track proves out.

The recommended name is `@effected/plugin`. `@effected/config` is
rejected: it reads as a sibling of the already-published
`@effected/config-file` and would confuse every import list that has
both. The package is companion category, no tier — like
`@effected/pnpm-plugin-effect`.[^pnpm-plugin-effect-claude]

This package does not exist yet. The decision fixes the name and the
category so a future build does not re-litigate either; it is not a
commitment to a build date.

## Alternatives rejected

- **`@effected/config`.** Rejected because it collides in spirit with
  `@effected/config-file` — a reader scanning an import list would
  reasonably guess the two are related or interchangeable, when they
  would in fact serve entirely different purposes (one loads and edits
  config files at runtime; the proposed one ships agent tooling
  configuration).
- **Folding this capability into `@effected/pnpm-plugin-effect`
  itself.** Rejected because the existing companion's scope is
  specifically the Effect version catalogs; broadening it to also carry
  agent-tooling config would mix two independent version surfaces behind
  one package, defeating the purpose of a companion's narrow, single
  responsibility.

## Consequences

Any future work on this package starts from the name `@effected/plugin`
and the companion category (no tier, no `@effected/*` dependents
permitted) already settled. Nothing else about its contents — which
config files, which peers, whether the tsgo LSP tsconfig ships in the
first version — is decided by this record.

[^root-package-json]: `package.json:53-54` — `"@savvy-web/silk": "^4.0.1"`
    and `"@vitest-agent/plugin": "^3.0.3"`, the two companion packages
    this repo already consumes in the shape the config companion would
    follow.
[^pnpm-plugin-effect-claude]: `packages/pnpm-plugin-effect/CLAUDE.md` —
    "Companion is a *category, not a fourth tier*… it exposes no API and
    it has no tier."
