---
"@effected/claude-code-plugin": patch
"@effected/copilot-plugin": patch
---

## Documentation

- The `effected-packages` skill's walker reference documents `descend`'s `onUnreadable: "record"` overload for the first time — `DescendRecordOptions`, the `DescendResult` it resolves to, and the new `UnreadableDirectory { path, cause }` entry carrying the `PlatformError` the walk absorbed — and its config-file reference covers `ConfigFileShape.encode`, the `options` argument on `write`, and `ConfigEncodeOptions.header`.
- The generated construct index picks up `@effected/walker`'s `UnreadableDirectory` and `@effected/config-file`'s `ConfigEncodeOptions` and `ConfigEncodeError`, with `DescendResult` and `descend` re-rendered against their updated summaries.
