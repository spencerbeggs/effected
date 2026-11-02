---
id: "0049"
title: Install the effected tool through the carrier package
kind: tooling
shows: none
applies:
  "@effected/pnpm-plugin-effected": ">=0.21.0"
---

The kit now ships a command-line tool, `effected`, and an MCP server, `effected-mcp`. The carrier package `@effected/plugin` provides both as bins. It is in the `effected` catalog, and `@effected/pnpm-plugin-effected` hoists it with `publicHoistPattern`, so once it is installed the command is reachable from every workspace package.

What to do, if the repository wants the tool:

- Add `"@effected/plugin": "catalog:effected"` as a root `devDependency` and install.
- Run `effected --version`. It ends with `via @effected/plugin <version>` when the carrier is the one answering.
- To use the MCP server, launch `effected-mcp` over stdio; its `identity` tool reports the carrier as its distribution.

This is offered, never applied unasked: a repository that does not want the tool changes nothing. Do not add `@effected/cli`, `@effected/mcp` or `@effected/engine` for this; they are the tool's internals, and the carrier is the one dependency to declare.
