---
"@effected/xdg": minor
---

## Features

- `@effected/jsonc`, `@effected/yaml` and `@effected/toml` are now optional peer dependencies. Install only the engine for the config format you read. This matches `@effected/config-file`, whose `JsoncCodec`, `YamlCodec` and `TomlCodec` now ship from the `./jsonc`, `./yaml` and `./toml` subpaths.
