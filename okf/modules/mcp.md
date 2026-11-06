---
type: Module
title: "@effected/mcp"
description: "The effected-mcp server: a stdio MCP server with an identity tool, the package_build and action_build tools, and the schema_check, schema_build and schema_validate tools on effect/ai and @effected/mcp-kit, run by a bin that a carrier shim can wrap with its own distribution identity."
status: draft
kind: package
resource: ../../packages/mcp
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T22:24:55Z
integrity:
  generated:
    body: f7a19b13de7e27f4
---

# @effected/mcp

`@effected/mcp` is the `effected-mcp` server, a front end of the [effected tool](../decisions/one-tool-beside-the-libraries.md). It is an application package with no library tier. A consumer installs [`@effected/plugin`](plugin.md), not this package; the MCP boundary library is [`@effected/mcp-kit`](mcp-kit.md) ([the rename](../decisions/carrier-libraries-take-kit-names.md)). The [effected agent plugin](ai-plugin.md) launches it.

## Surface

- `identity`: the tool name, this front end's version, the carrier `distribution` or `null`, and the resolved `effect` version, built by [engine](engine.md) and served as a real tool result.
- `schema_check` (read-only, writes nothing), `schema_build` (writes) and `schema_validate` (read-only): the [schema commands](../interfaces/schema-commands.md) as tools. Parameters mirror the flags; each declares a result schema, the same classes the CLI's JSON encodes, so an agent reads a declared shape and a located diff instead of inferring one. Drift, staleness and a failed validation are ordinary results (a `verdict`, or `valid: false`); only a config that cannot be found or loaded, a path outside the workspace root, or a run that could not finish is a refusal.
- `package_build` and `action_build` (both write): [the build commands](../interfaces/build-commands.md) as tools, answering the classes the CLI's JSON encodes. A build that crashes or records an error, or validation stopping one, is an ordinary result with the verdict `failed`; only a run that could not start or finish is a refusal. `action_build`'s `persist` defaults to false, the opposite of the command. They share one `Exclusive` lane with a 10-minute timeout, which cannot stop a build that is already running.
- `main(options?)`: runs the server over stdio under `McpGuard.run` with a lazy `load` and `exitBeforeConnect` for both crash events; `options.distribution` names the carrier.
- `MCP_VERSION`: the package's own version, replaced at build.

## What the schema tools promise

- **Path containment.** `config`, `payload` and a file-valued `schema` (and a payload's own `$schema`) resolve against the workspace root (the nearest `pnpm-workspace.yaml`, else `.git`, else the working directory), checked with `PathContainment` from `@effected/kit`; a path outside it is refused. A config's own output paths are not covered: loading a config already runs its code, and `schema_build` writes what `effected schema build` would.
- **Discovery stops at the root.** With no `config`, the upward walk starts at the working directory and stops at the workspace root, because a config is code and one above the checkout may be someone else's.
- **Serialized writes.** `schema_build` and `schema_check` load the config outside one `Exclusive` lane and walk inside it, so a reader never answers from a document being written. The load stays outside the lane because a lane timeout would abandon the import. `schema_validate` takes no lane.
- **A config cannot write the wire.** A config runs in this process and could print to stdout, so each schema call runs under `StdioCapture`, stdout diverted to stderr.
- **A version mismatch warns, it does not stop.** The tools run past a config from another `@effected/schemastore` and return the warning in the result ([why](../decisions/schema-version-mismatch-check.md)).
- **Fresh config, bounded.** Every call reloads the config and the TypeScript and JSON it imports. An imported `.mjs`, `.cjs` or `.js` under `type: module`, and a sibling workspace package's built output, stay cached until the server restarts ([the limitation](../limitations/mcp-config-reload-cache.md)); the server's instructions say so.

## Boundaries

- Stdout is the JSON-RPC wire: nothing here writes to it.
- The `effected-mcp` bin is declared here and again by the carrier, a [supported shared-bin choice](../decisions/carrier-only-declares-bins.md).
- Shared logic belongs in [engine](engine.md), held as a `workspace:*` dependency published exact.
- `typescript` is a peer at the literal range [the carrier](plugin.md#boundaries) records, nightlies excluded, and the tsconfig presets ship from the carrier rather than here.
- Tests drive the server in-process through `McpHarness` from `@effected/mcp-kit/testing`.
