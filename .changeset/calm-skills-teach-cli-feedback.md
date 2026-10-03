---
"@effected/ai-plugin": minor
---

## Documentation

* The `effect-v4-cli`, `effected-packages`, `building-schemastore-schemas` and `effect-v4-testing` skills now cover the new `@effected/cli` surface: `CliUi.map`, `CliUi.lazyView` and `LiveOptions.final`, masked `TextInput`, the span-trail modes, the `CliUiTest` transcripts and serializer, and the new `@effected/schemastore-cli` failure report
* The `effect-v4-cli` skill now covers six adoption traps: where `CliUiTest.session` goes relative to `CliEnv.layerTest`, `Select` drawing `detail` only for the highlighted choice, the session's 80-column default and row truncation, `CliUi.prompt` keeping `NotInteractive` without `otherwise`, `Doc.print` writing one `Console.log`, and top-level `Doc` blocks printing with no blank line
* The `effect-reviewer`, `effect-developer` and `action-engineer` agents are updated to match
