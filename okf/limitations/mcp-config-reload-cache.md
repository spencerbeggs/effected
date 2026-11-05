---
type: Limitation
title: A long-lived MCP server does not see an edit to an imported native module until it restarts
description: "The schema tools reload the config on every call, but a config's imported .mjs, .cjs or .js under type module, and a sibling workspace package resolved to built output, stay cached by Node's ESM loader, so an edit to one is not seen until the effected-mcp process restarts; .ts, .mts, untyped .js and .json do reload. Fixing it would take a child process per call."
status: draft
bounds: ../modules/mcp.md
tags:
  - dx
  - architecture
sources:
  - id: config-loader
    resource: ../../packages/engine/src/schema/ConfigLoader.ts
  - id: reload-suite
    resource: ../../packages/engine/__test__/schema/ConfigLoader.reload.test.ts
  - id: design
    resource: ../../docs/superpowers/specs/2026-11-04-effected-schema-design.md
generated:
  by: "okfit/claude-code"
  at: 2026-11-05T06:55:47Z
integrity:
  generated:
    body: c7959150016ff6f1
---

# A long-lived MCP server does not see an edit to an imported native module until it restarts

## Condition

`effected-mcp` stays running between tool calls, so `schema_check`, `schema_build` and `schema_validate` load the config
through `ConfigLoader` on every call, evaluating it and everything `jiti` transpiles afresh (`moduleCache` and `fsCache`
off, and the `.json` entries `jiti` reads through `require` evicted by hand).[^config-loader] What `jiti` hands to Node
natively is cached by Node's ESM loader for the life of the process, and nothing the loader can do evicts it.

| Imported by the config | After an edit, the next call |
| ---------------------- | ---------------------------- |
| `.ts`, `.mts` | sees it |
| `.json` | sees it |
| `.js` in a package with no `type` (ESM `.js`) | sees it, as a new module instance |
| `.mjs`, `.cjs` | **does not** |
| `.js` under `"type": "module"` | **does not** |
| a sibling workspace package resolved to its built `.js` under `"type": "module"` | **does not** |

## Symptom

The agent edits a schema that lives in a native module, or rebuilds a sibling workspace package the config imports, then
calls `schema_check`. The result describes the old schema: no drift where there is some, or a clean tree after a change.
Nothing in the result says the import was stale, so the answer looks authoritative. The same edit seen through
`effected schema check` on the command line is correct, because that process is new each time.

## Why it is acceptable

The common config is TypeScript, and its schema sources are TypeScript, so the case that decides the tool's usefulness
(edit a schema, check again) reloads, and a dedicated test pins it.[^reload-suite] The caches that remain belong to a
package the config merely depends on: a built workspace package changes when its build runs, which is a step an agent
or a person already knows to follow with a restart. A `type: module` or CommonJS package staying a native import is also
what keeps a reload on one `@effected/schemastore` copy, rather than minting a second one per call.

## What a fix would take

A fresh module graph per call, which Node does not offer in-process: each call would run the load in a child process
and return its report. That costs a process start per tool call and moves the platform layer, the `StdioCapture` and
the `Exclusive` lane across a process boundary, so it was not taken. Restarting the server is the remedy until then.

[^config-loader]: `packages/engine/src/schema/ConfigLoader.ts`: the `jiti` options, the `require.cache` eviction for `.json`, and the comment that lists what stays cached.
[^reload-suite]: `packages/engine/__test__/schema/ConfigLoader.reload.test.ts`: edits between two loads for each import kind.
