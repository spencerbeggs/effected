---
"@effected/app": minor
---

## Features

- `@effected/jsonc`, `@effected/yaml` and `@effected/toml` are now optional peer dependencies. Install only the engine for the config format your app reads. This follows the `@effected/config-file` change that moved `JsoncCodec`, `YamlCodec` and `TomlCodec` to their own subpaths, so a TOML config now imports `TomlCodec` from `@effected/config-file/toml`.
