---
"@effected/claude-code-plugin": patch
---

## Bug Fixes

- The `effect-v4-cli` skill corrects two traps met building a bin-only CLI package: `Flag.Boolean(name)` has no implicit `false` — omission fails with `MissingOption` unless piped through `Flag.withDefault(false)` (or `Flag.optional`) — and `CliLogger.layer()` routes `Info`/`Warning` to stdout by default (`stderrFrom` defaults to `"Error"`), which interleaves log lines into a `--format=json` command's document unless `stderrFrom: "All"` is set.
- The `effect-v4-cli` and `effect-api-extractor-bases` skills document the bin-only package shape: an `exports` map limited to `"./package.json"` fails `build:prod` with `Cannot merge zero API models` unless `savvy.build.ts` sets `emitDts: false`, which skips the declaration and API-model passes for a package that ships no importable surface.
- The `effect-v4-idioms` skill corrects `fs.exists`: it already absorbs `NotFound` and re-fails every other `PlatformError` reason, so appending `Effect.orElseSucceed(() => false)` is a policy choice to treat an unreadable path as absent, not a required fix for a missing path.
- The `effect-v4-schema` skill documents that every schema value is a function at runtime (`typeof === "function"`), so a `typeof x === "object"` guard rejects every schema; use `Schema.isSchema` to recognize one.
