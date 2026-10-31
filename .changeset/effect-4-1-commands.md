---
"@effected/commands": minor
---

## Breaking Changes

Rebuilt on Effect 4.1.1. The `effect` peer dependency (and any `@effect/*` peer) is now `~4.1.0`, so an Effect 4.0.x install no longer satisfies it. Upgrade `effect` to 4.1 alongside this release; mixing this package with a copy built on 4.0.x is unsupported.

### ScriptedSpawner records Redacted arguments

`SpawnRecord.args` is now `ReadonlyArray<CommandLine.Word>` (`string | Redacted<string>`) and `SpawnRecord.env` values may be `Redacted<string>`. A `Redacted` argument stays the `Redacted` object, so a record never holds a secret as text; code that treats `args` as `string[]` stops compiling. Normalise with `args.map(String)` or assert on the `Redacted` itself. A `SpawnScript` still receives `ReadonlyArray<string>` and sees `"<redacted>"` for a `Redacted` argument. `Run.extendEnv` also accepts `Redacted` values.
