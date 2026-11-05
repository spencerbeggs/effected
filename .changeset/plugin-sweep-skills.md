---
"@effected/ai-plugins": minor
---

## Features

* The consumer upgrade ledger gains entries for this sweep: `AtomicDirectory` moved to `@effected/files`, `ManagedSection` requiring `Path`, `@effected/cli-kit` dropping its `@effected/config-file` peer, the `CliUi.prompt` `otherwise` overloads, adopting the new helpers, and writes needing directory permission (#1176, #1185, #1203).
* The `effected-packages` skill and construct index cover `@effected/files`, `EditDistance`, `CliExit.report`, `McpToolkit.provideLifetime` and the `promiseInExclusive` boundary rule.

## Documentation

* The `effect-v4-cli`, `effect-v4-mcp`, `effect-v4-schema`, `effect-v4-services-layers` and `effect-v4-testing` skills are corrected to match the sweep's behaviour (#1089).
