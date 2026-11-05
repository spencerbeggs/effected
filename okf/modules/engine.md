---
type: Module
title: "@effected/engine"
description: "The effected tool's shared logic, consumed by its CLI and MCP front ends: the identity report both describe themselves with, and the ./schema subpath that holds everything effected schema does, from loading a schemastore config to the shipped ajv engines."
status: draft
kind: package
resource: ../../packages/engine
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-05T06:55:47Z
integrity:
  generated:
    body: de768c7f21973d62
---

# @effected/engine

`@effected/engine` is where the [effected tool](../decisions/one-tool-beside-the-libraries.md)'s logic lives once, so the [`effected` command](cli.md) and the [`effected-mcp` server](mcp.md) cannot drift. It is an application package, not a library: no library tier applies. It was named `@effected/engine` only after the kit's carrier library moved to [`@effected/kit`](kit.md) ([why](../decisions/carrier-libraries-take-kit-names.md)).

## Surface

- **Root.** `Identity.report({ version, distribution })` returns an `IdentityReport` (`Schema.Class`): `tool` (always `effected`), the front end's `version`, the carrier `distribution` or `null`, and the `effect` version read from the resolved `effect/package.json`. The root never reaches `./schema`, so reading identity pulls in neither `jiti` nor `ajv`.
- **`./schema`.** The machinery behind [`effected schema build|check|validate`](../interfaces/schema-commands.md) and the `schema_*` MCP tools:
  - `ConfigLoader` finds and evaluates a `schemastore.config.*` through `jiti`, afresh on every call (what it cannot reload is [a limitation](../limitations/mcp-config-reload-cache.md)), with an optional ceiling for discovery.
  - `Runner` is the walk: the frozen-version pre-flight, generation, the drift table, the catalog slice and merged catalog, with every write gated on one `writing` predicate.
  - `SchemaRun` is the shared body of `build` and `check`: it loads the config, runs `VersionCheck`, runs `Runner`, and answers a `RunReport` and a verdict, which a front end maps to an exit code or returns as data. `SchemaValidate` is the same for a payload, and its findings carry the file, line and column of the value they point at.
  - `RunReport`, `SchemaReport`, the catalog reports, `DocumentDiff` and `ValidateReport` are `Schema` classes: the CLI's JSON and the MCP result are encodings of the same classes. `Report` renders them as human lines, JSON and markdown, and `StepSummary` appends the markdown to `GITHUB_STEP_SUMMARY`; the engine never appends it, because a read-only MCP call must not write it.
  - `VersionCheck` compares the `@effected/schemastore` version stamped on a config's values with the one the tool was built against ([the check](../decisions/schema-version-mismatch-check.md)).
  - `AjvValidator` and `AjvInstanceValidator` are the one shipped engine for each of the library's two validator contracts ([why they are here](../decisions/schemastore-engine-lives-in-the-cli.md)); they stay exported for a program that drives `SchemaPipeline` itself.

## Boundaries

- `@effected/kit` is a regular dependency (it supplies `Distribution`); `effect` is a regular dependency, because a tool declares its full stack.
- `@effected/schemastore` is a `workspace:*` dependency, published exact, and `ajv` and `ajv-formats` are exact versions, because each decides what the tool outputs ([the pin chain](../conventions/peer-dependency-discipline.md#cross-effected-dependencies)). `jiti` has a tilde range because the reload behaviour rests on its routing.
- New logic both front ends need goes here, never in a front end. The carrier [plugin](plugin.md) holds nothing but bin shims and one re-export.
- Package-local rules live in the package's `CLAUDE.md`.
