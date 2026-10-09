---
"@effected/ai-plugin": minor
---

## Documentation

* The `effect-v4-cli` skill's live-view and testing references teach `LiveHandle.printAbove`, which prints a forwarded line above a mounted frame and reports whether it did, and the `CliUiTestLive` test seams `write`, `stdoutWritten` and `stderrWritten` for reproducing and asserting a torn frame.
* The `building-schemastore-schemas` skill now teaches a scoped Biome `json.formatter.expand: "always"` override, so a freshly built schema is lint-clean under CI, and records that the CLI writes every array element and object member on its own line.
