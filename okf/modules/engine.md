---
type: Module
title: "@effected/engine"
description: "The effected tool's shared logic, consumed by its CLI and MCP front ends: for now the identity report (tool, version, carrier distribution and resolved effect version) both describe themselves with."
status: draft
kind: package
resource: ../../packages/engine
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-02T16:44:32Z
integrity:
  generated:
    body: 441c9eae30fb31db
---

# @effected/engine

`@effected/engine` is where the [effected tool](../decisions/one-tool-beside-the-libraries.md)'s logic lives once, so the [`effected` command](cli.md) and the [`effected-mcp` server](mcp.md) cannot drift. It is an application package, not a library: no library tier applies. It was named `@effected/engine` only after the kit's carrier library moved to [`@effected/kit`](kit.md) ([why](../decisions/carrier-libraries-take-kit-names.md)).

## Surface

`Identity.report({ version, distribution })` returns an `IdentityReport` (`Schema.Class`): `tool` (always `effected`), the front end's `version`, the carrier `distribution` or `null`, and the `effect` version read from the resolved `effect/package.json`.

## Boundaries

- `@effected/kit` is a regular dependency (it supplies `Distribution`); `effect` is the only peer.
- New logic both front ends need goes here, never in a front end. The carrier [plugin](plugin.md) holds nothing but bin shims.
- Package-local rules live in the package's `CLAUDE.md`.
