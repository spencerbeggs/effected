---
"@effected/engine": minor
---

## Features

* `ConfigLoader.load` resolves `effect/Schema` beside the config, through the same jiti that loaded it, and returns its generator as the new `LoadedConfig.toJsonSchemaDocument`.
* `RunOptions.toJsonSchemaDocument` is new, and `SchemaRun` lowers schemas with it, falling back to the tool's own `effect` copy when none resolves beside the config.
