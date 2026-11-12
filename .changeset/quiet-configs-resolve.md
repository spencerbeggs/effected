---
"@effected/engine": minor
---

## Features

* `ConfigLoader.load` resolves `effect/Schema` beside the config, through the same jiti that loaded it, and returns its generator as the new `LoadedConfig.toJsonSchemaDocument`.
* `RunOptions.toJsonSchemaDocument` is new, and `SchemaRun` lowers schemas with it, falling back to the tool's own `effect` copy when none resolves beside the config.
* `SchemaRunDeps.toJsonSchemaDocument` is new. A caller that loads the config itself and passes it in through `importModule` uses it to hand over the generator that load resolved.
* `effected action init` now opens the `effected.toml` it scaffolds with a `#:schema` directive naming the published `effected.toml` JSON Schema, so tombi, taplo and other TOML editors complete and validate it.
