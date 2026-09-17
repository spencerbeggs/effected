---
"@effected/copilot-plugin": patch
---

## Bug Fixes

- Ports the `effect-v4-schema`, `effect-v4-idioms` and `effect-v4-observability` skill corrections from the Claude Code plugin: `Schema.fromJsonString` and `Config.schema` for JSON-string and config inputs, the probed `Config.withDefault` contract for absent, empty and malformed input, `Effect.repeat` options for polling, and custom loggers routed by `Logger.withConsoleLog` / `withConsoleError`.
- Mirrors the regenerated construct index, which no longer lists the unimportable `ConfigBrand` symbol.
