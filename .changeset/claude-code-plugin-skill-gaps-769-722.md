---
"@effected/claude-code-plugin": patch
---

## Bug Fixes

- The `effect-v4-schema` skill teaches `Schema.fromJsonString(S)` as the codec for a JSON-string-encoded value, and `Config.schema(Schema.fromJsonString(S), name)` for a config or action input, in place of `JSON.parse` / `JSON.stringify` wrapped around `decodeUnknown*` / `encodeUnknown*`.
- The `effect-v4-idioms` skill documents what `Config.withDefault` does and does not swallow under `Config.schema` (probed at rc.115): an unset variable and `""` both resolve to the default because the provider maps an empty string to missing unless `preserveEmptyStrings: true`, while malformed or wrong-shaped input fails with a typed `ConfigError` the default never absorbs. It also adds a polling section: `Effect.repeat` with `{ schedule, times, while, until }` replaces a recursive `Effect.sleep` loop, with the probed traps that `times: N` runs `N + 1` times, an `until` refinement narrows the result type, and `until` with no `schedule` is a busy loop.
- The `effect-v4-observability` skill documents custom loggers as a formatting logger (`Logger.make`) routed by `Logger.withConsoleLog` / `withConsoleError`, composed with `inner.log(options)`, in place of a hand-written `Console` lookup; the route goes through the `Console` service, so `TestConsole` captures it.
- The construct-index generator skips every api-extractor forgotten export (a `~` after the `!` in the canonical reference, such as a private brand symbol used as a computed key on a public interface) in addition to class-factory `_base` symbols, so an unimportable symbol is neither rendered nor demanded an intent; the `ConfigBrand` intent is dropped from `construct-annotations.json`.
