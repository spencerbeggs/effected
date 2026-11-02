---
type: Module
title: "@effected/mcp"
description: "The effected-mcp server: a stdio MCP server with one identity tool on effect/ai and @effected/mcp-kit, run by a bin that a carrier shim can wrap with its own distribution identity."
status: draft
kind: package
resource: ../../packages/mcp
tags:
  - architecture
  - dx
generated:
  by: "okfit/claude-code"
  at: 2026-11-02T16:44:32Z
integrity:
  generated:
    body: 8a45bd270a12940b
---

# @effected/mcp

`@effected/mcp` is the `effected-mcp` server, a front end of the [effected tool](../decisions/one-tool-beside-the-libraries.md). It is an application package with no library tier. A consumer installs [`@effected/plugin`](plugin.md), not this package; the MCP boundary library is [`@effected/mcp-kit`](mcp-kit.md) ([the rename](../decisions/carrier-libraries-take-kit-names.md)). The [effected agent plugin](ai-plugin.md) launches it.

## Surface

- One tool, `identity`: the tool name, this front end's version, the carrier `distribution` or `null`, and the resolved `effect` version, built by [engine](engine.md) and served as a real tool result.
- `main(options?)`: runs the server over stdio under `McpGuard.run` with a lazy `load` and `exitBeforeConnect` for both crash events; `options.distribution` names the carrier.
- `MCP_VERSION`: the package's own version, replaced at build.

## Boundaries

- Stdout is the JSON-RPC wire: nothing here writes to it.
- The `effected-mcp` bin is declared here and again by the carrier, a [supported shared-bin choice](../decisions/carrier-only-declares-bins.md).
- Tests drive the server in-process through `McpHarness` from `@effected/mcp-kit/testing`.
