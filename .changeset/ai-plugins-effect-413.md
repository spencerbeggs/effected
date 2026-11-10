---
"@effected/ai-plugins": patch
---

## Documentation

- The upgrade ledger records what Effect 4.1.3 changes for a consumer: `Command.withHandler` keeping the command's earlier error types, driver SQL clients no longer assignable to `SqlClient`, the required `MessageStorage.deleteProcessed`, tool results encoded with their JSON codec, the new MCP server telemetry and stdio exit code, OTLP unit and span status changes, `isAnyOf` tag checking, `Schema.Struct` fields named after `Object.prototype` members, RPC middleware errors in handler types, and `Runtime.InterruptExitCode`.
- It also records the `effected` catalog serving the Effect family at exact versions, the local `catalogs.effected` block a consumer must re-export or remove, and the switch of every peer to `catalog:effected:peers`.
- The `@effected/pnpm-plugin-effected` reference teaches the peers catalogs: `catalog:effected` for dependencies, `catalog:effected:peers` for peers.
- Skill citations are re-derived against Effect 4.1.3, and the `TestClock` notes cite its rewritten implementation.
