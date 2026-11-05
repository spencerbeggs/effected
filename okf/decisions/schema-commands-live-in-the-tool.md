---
type: Decision
title: The schemastore commands live in the effected tool, and the companion package is removed
description: "build, check and validate moved from the @effected/schemastore-cli companion into the effected tool as effected schema and the schema_build, schema_check and schema_validate MCP tools, with the logic in @effected/engine and a workspace:* pin chain from the carrier down to schemastore, so one install gives a consumer the command, the server and the config import and a kit dependency cannot move on its own."
status: stable
tags:
  - architecture
  - release
  - deps
sources:
  - id: design
    resource: ../../docs/superpowers/specs/2026-11-04-effected-schema-design.md
  - id: owner
    resource: conversation with the repository owner
    author: human:spencerbeggs
    last_modified: 2026-11-04T00:00:00Z
  - id: plugin-package-json
    resource: ../../packages/plugin/package.json
  - id: engine-package-json
    resource: ../../packages/engine/package.json
  - id: engine-schema
    resource: ../../packages/engine/src/schema/index.ts
generated:
  by: "okfit/claude-code"
  at: 2026-11-05T06:58:37Z
integrity:
  generated:
    body: 4434f81aa1487d59
  verified:
    by: human:spencer
    at: 2026-11-05T14:25:52Z
    content: 8ae557e04128782a
verified:
  - by: human:spencer
    at: 2026-11-05T14:25:52Z
---

# The schemastore commands live in the effected tool, and the companion package is removed

## Context

`@effected/schemastore` builds, gates and classifies SchemaStore-shaped documents. Six consuming repositories each wrote
the same two hundred lines around it[^six], and a companion package, `@effected/schemastore-cli`, collected them into a
`schemastore` bin released as a fixed pair with the library. Meanwhile the [effected tool](one-tool-beside-the-libraries.md)
shipped as a carrier that only reported its identity. The companion already worked and had real consumers (okfit,
vitest-agent and silk-release-action), so it was the first thing the tool could take on, and the owner's intent was three
things: one front door instead of a bin per builder, a declared result an agent can read instead of arbitrary JSON, and
output changes that cannot slip through unnoticed when a dependency moves.[^design]

## Decision

The commands moved into the tool as `effected schema build|check|validate`, and the companion package was deleted from the
repository and from the `effected` catalog.

- **Logic lives once, in [engine](../modules/engine.md)'s `./schema` subpath:** the config loader, the runner, the report
  classes, both ajv engines, the step summary, the shared run and validate bodies and the version check. `ajv`,
  `ajv-formats` and `jiti` moved with them; `ajv` and `ajv-formats` are exact versions because they decide gate verdicts.
- **Flags, prompts, exit codes and the step-summary append stay in [cli](../modules/cli.md)**; the [mcp](../modules/mcp.md)
  server answers the same verdicts as data, through three tools with declared result schemas. The CLI's JSON and the MCP
  result are encodings of the same `Schema` classes, so they cannot drift. The contract is
  [the schema commands](../interfaces/schema-commands.md), carried over from the companion's with the same flags and exit
  codes.
- **The config imports `defineSchemastore` from `@effected/plugin`**, which re-exports `@effected/schemastore`'s
  `defineConfig` under that name (`defineSchema` read as defining one schema). Nothing moves out of the library, and the
  carrier's root stays cheap to import from a config.
- **One pin chain.** The carrier depends on `cli`, `mcp` and `schemastore`, `cli` and `mcp` on `engine`, `engine` on
  `schemastore`, and `schemastore` on `semver`, every link `workspace:*` and so published exact
  ([the exception](../conventions/peer-dependency-discipline.md#cross-effected-dependencies)). A patch of any of them reaches
  a consumer only with a new carrier version. The changesets `fixed` group the pair needed is gone.[^plugin-package-json]
- **`effect` stays held to one copy by the catalog override**, and the catalog is the supported way to use the kit; nothing
  here detects a consumer who is not on it. What the pin cannot cover, such as an `effect` bump that changes output, the
  command's own `check` and drift policy catch, and a config whose `@effected/schemastore` is another version is caught by
  [the version check](schema-version-mismatch-check.md).

Removing the package is not a breaking change to it: the last published version stays on npm and keeps working, and the
owner upgrades the consuming repos, then deprecates it pointing at `@effected/plugin`. Two limits go in the upgrade
ledger's note: the old CLI's exact peer on `@effected/schemastore` means a repo that bumps the library must move to
`effected` in the same step, and a repo still writing `catalog:effected` for the old package fails at install once the
catalog drops it, which is loud and acceptable.

## Alternatives rejected

- **`@effected/schemastore` as a peer of the engine.** The owner offered a direct dependency or a peer and the design
  picked the dependency; the rationale given here (a peer leaves the consumer to align the version, the partial-bump failure
  the pin exists to prevent) is the author's, not the owner's.[^engine-package-json]
- **Float the chain at `workspace:^`.** That was the carrier's link to `cli` and `mcp`, and it would let a patch change
  output with no carrier bump, which the design names as an anti-goal.
- **`defineSchema` as the carrier's name for the function.** It reads as defining one schema, where the function defines a
  whole config; the owner offered two candidates and the design picked `defineSchemastore`.

## Author's reasoning, not considered with the owner

These two alternatives are inferred by the author of this concept. Nobody discussed them; the owner can verify or delete them.

- **Keep the companion and add an MCP server beside it.** A second install, a second front door and a second set of
  result shapes to keep level, with the tool still reporting nothing a builder needs. The point of the carrier is one
  install for every kit build tool.
- **Keep the logic in the CLI and have the MCP shell out to it.** The agent would parse arbitrary JSON, which is exactly
  the guess the declared result is there to remove, and the two surfaces would share no types. Shared logic belongs in
  `engine`, and the front ends stay thin.

## Consequences

- The `effected` catalog drops the old package and the construct index regenerates; the agent plugin's
  `building-schemastore-schemas` skill and its references name `effected schema`.
- `@effected/schemastore` gained what the tool needs and nothing else: `SchemastoreVersion`, the generated and existing
  text on a pipeline check result (the line diff needs the text of a document that was not written), `ResolvedSchema.hosted`,
  and recognition of a `HostedSchema` by brand. `@effected/source` gained `LineDiff`, `@effected/kit` gained
  `PathContainment`, and `cli-kit` and `mcp-kit` gained what the tool's tests and metadata needed.
- The engines' home is the engine package; see [the ajv engine decision](schemastore-engine-lives-in-the-cli.md) and
  [no bin on the library](schemastore-no-bin.md), both of which stand with the destination changed.
- A config evaluated in a long-lived server has
  [a reload limit](../limitations/mcp-config-reload-cache.md).

[^design]: `docs/superpowers/specs/2026-11-04-effected-schema-design.md`: Intent, Packages and the pin, and Retiring `@effected/schemastore-cli`.
[^plugin-package-json]: `packages/plugin/package.json`: `@effected/cli`, `@effected/mcp` and `@effected/schemastore` at `workspace:*`.
[^engine-package-json]: `packages/engine/package.json`: `@effected/schemastore` at `workspace:*`, and `ajv`, `ajv-formats` at exact versions.
[^six]: The owner's design conversation of 2026-09-13 (the six duplicated generators), recorded in the former `@effected/schemastore-cli` Module and in `schemastore-no-bin.md`.
