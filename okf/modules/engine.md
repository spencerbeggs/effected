---
type: Module
title: "@effected/engine"
description: "The effected tool's shared logic, consumed by its CLI and MCP front ends: the identity report both describe themselves with, the ./schema subpath that holds everything effected schema does, from loading a schemastore config to the shipped ajv engines, and the ./build subpath behind effected package build, effected action build and effected action init."
status: draft
kind: package
resource: ../../packages/engine
tags:
  - architecture
  - dx
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-10T01:42:40Z
integrity:
  generated:
    body: c37c110e1be3782f
---

# @effected/engine

`@effected/engine` is where the [effected tool](../decisions/one-tool-beside-the-libraries.md)'s logic lives once, so the [`effected` command](cli.md) and the [`effected-mcp` server](mcp.md) cannot drift. It is an application package, not a library: no library tier applies. It was named `@effected/engine` only after the kit's carrier library moved to [`@effected/kit`](kit.md) ([why](../decisions/carrier-libraries-take-kit-names.md)).

## Surface

- **Root.** `Identity.report({ version, distribution })` returns an `IdentityReport` (`Schema.Class`): `tool` (always `effected`), the front end's `version`, the carrier `distribution` or `null`, and the `effect` version read from the resolved `effect/package.json`. The root never reaches `./schema` or `./build`, so reading identity pulls in no `jiti`, no `ajv` and no build tooling.
- **`./schema`.** The machinery behind [`effected schema build|check|validate`](../interfaces/schema-commands.md) and the `schema_*` MCP tools:
  - `ConfigLoader` finds and evaluates a `schemastore.config.*` through `jiti`, afresh on every call (what it cannot reload is [a limitation](../limitations/mcp-config-reload-cache.md)), with an optional ceiling for discovery.
  - `Runner` is the walk: the frozen-version pre-flight, generation, the drift table, the catalog slice and merged catalog, with every write gated on one `writing` predicate.
  - `SchemaRun` is the shared body of `build` and `check`: it loads the config, runs `VersionCheck`, runs `Runner`, and answers a `RunReport` and a verdict, which a front end maps to an exit code or returns as data. `SchemaValidate` is the same for a payload, and its findings carry the file, line and column of the value they point at.
  - `RunReport`, `SchemaReport`, the catalog reports, `DocumentDiff` and `ValidateReport` are `Schema` classes: the CLI's JSON and the MCP result are encodings of the same classes. `Report` renders them as human lines, JSON and markdown, and `StepSummary` appends the markdown to `GITHUB_STEP_SUMMARY`; the engine never appends it, because a read-only MCP call must not write it.
  - `VersionCheck` compares the `@effected/schemastore` version stamped on a config's values with the one the tool was built against ([the check](../decisions/schema-version-mismatch-check.md)).
  - `AjvValidator` and `AjvInstanceValidator` are the one shipped engine for each of the library's two validator contracts ([why they are here](../decisions/schemastore-engine-lives-in-the-cli.md)); they stay exported for a program that drives `SchemaPipeline` itself.
- **`./build`.** The machinery behind [`effected package build` and `effected action build`](../interfaces/build-commands.md) and the `package_build` and `action_build` MCP tools:
  - `BuildRun.run` checks for a `package.json`, finds the workspace root, loads the config and plugins, runs `Bundler.build`, reads `dist/prod/issues.json` back, appends to the [root journals](../decisions/build-logs-are-journals.md), and answers a `BuildRunResult`. A build that crashes or records an error is the verdict `failed` rather than a failure; the error channel holds a run that could not start or record.
  - `ActionRun.run` is the same for a GitHub Action: it fails `NotAnActionError` when there is no `[action]` table, runs `ActionBuilder.build`, and answers an `ActionRunResult`. It appends to no journal.
  - `ActionInit` is the scaffold behind [`effected action init`](../interfaces/build-commands.md#effected-action-init) and `action_init`. `plan` is pure and answers an `ActionScaffold`: the files as data, and the packages their source imports. `write` inspects every target and every parent with `lstat` before writing anything: a symbolic link, the wrong kind of entry, an uninspectable entry or an unwritable file is a `ScaffoldConflictError` that `force` never overrides, and an existing regular file is `ScaffoldExistsError` unless `force`. It then creates the directories, confirms each target resolves inside the directory, and writes each through `AtomicFile` with `links: "replace"`; a failure past the checks is `ScaffoldWriteError`, naming the files already written. `run` reads the name and description it was not given from `package.json` and answers an `ActionInitResult`. It edits no `package.json`.
  - The classes a front end needs are re-exported here, so the CLI keeps no bundler dependency.

## Boundaries

- `@effected/kit` is a regular dependency (it supplies `Distribution`); `effect` is a regular dependency, because a tool declares its full stack.
- `@effected/schemastore` and [`@effected/bundler`](bundler.md) are `workspace:*` dependencies, published exact, and `ajv` and `ajv-formats` are exact versions, because each decides what the tool outputs ([the pin chain](../conventions/peer-dependency-discipline.md#cross-effected-dependencies)). `jiti` has a tilde range because the reload behaviour rests on its routing.
- `typescript` and `@types/node` are peers, `typescript` at the literal range [the carrier](plugin.md#boundaries) records, nightlies excluded, because this package depends on [the bundler](bundler.md) directly and is published: installed alone it would otherwise leave the bundler's two required peers unmet ([the rule](../conventions/typescript-stays-in-the-bundler.md)). It imports nothing from either.
- New logic both front ends need goes here, never in a front end. The carrier [plugin](plugin.md) holds nothing but bin shims and one re-export.
- Package-local rules live in the package's `CLAUDE.md`.
