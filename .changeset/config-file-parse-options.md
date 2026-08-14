---
"@effected/config-file": minor
"@effected/app": minor
---

## Features

### `parseOptions` on config loading, for strict config files

`ConfigFileOptions`, `ConfigReadOptions` and `AppConfigOptions` each take an optional `parseOptions`, threaded into every schema decode. The field that matters is `onExcessProperty`:

```ts
const ConfigLive = AppConfig.layer(SettingsFile, {
	filename: "settings.toml",
	schema: Settings,
	codec: TomlCodec,
	parseOptions: { onExcessProperty: "error" },
});
```

It defaults to core's `"ignore"`, so **nothing changes for existing consumers** — unknown keys are still dropped silently unless you ask otherwise.

Why it is worth asking for: a loader that silently discards part of a user's file cannot report a typo'd section name, and cannot enforce a field the schema deliberately removed. A user migrating from an older format keeps a removed credential field, is told nothing, and believes a dead token is live. With `"error"` that becomes a `ConfigValidationError` whose issue names the offending path.

`validate` cannot substitute for it: `validate` runs on the *decoded* value, by which point the excess keys are already gone and there is nothing left to detect.

Keys covered by a `Schema.StructWithRest` rest are **not** excess, so a schema that deliberately admits a pass-through section — `[settings.*]` and the like — keeps working under `"error"`.
