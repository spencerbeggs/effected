---
"@effected/mcp": minor
---

## Breaking Changes

* `@effected/mcp` is now the `effected-mcp` server, not the kit's MCP boundary library. That library moved to `@effected/mcp-kit` with the same exports and subpaths (`./testing`, `./guard`, `./node`); anything that imports or depends on `@effected/mcp` for it must move to `@effected/mcp-kit`. Under `catalog:effected` the old name now resolves to this package, so the break shows as missing imports at build, not at install.

## Features

* The `effected-mcp` bin, an MCP server over stdio serving one read-only tool, `identity`: the tool name, the server version, the carrier distribution (`null` for a direct install) and the resolved `effect` version. `./main` exports `main(options?)` for a carrier's bin shim.
