---
"@effected/app": patch
"@effected/cli-kit": patch
"@effected/commands": patch
"@effected/git": patch
"@effected/jsonl": patch
"@effected/mcp-kit": patch
"@effected/package-json": patch
"@effected/schemastore": patch
"@effected/store": patch
"@effected/templates": patch
"@effected/workspaces": patch
---

## Documentation

* Examples import `@effect/platform-node` by subpath, such as `import * as NodeServices from "@effect/platform-node/NodeServices"`, instead of from the package root. The root re-exports `NodeRedis`, so copying a root import fails wherever the `redis` peer is not installed.
