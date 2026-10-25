---
"@effected/config-file": minor
---

## Breaking Changes

### Format codecs moved to subpaths

`JsoncCodec`, `YamlCodec` and `TomlCodec` are no longer exported from the package root. Each now has its own subpath: `@effected/config-file/jsonc`, `@effected/config-file/yaml` and `@effected/config-file/toml`. `JsonCodec` and everything else stay on the root. Closes #274.

`@effected/jsonc`, `@effected/yaml` and `@effected/toml` are now **optional** peer dependencies. Only the matching subpath loads its engine, and the root never does, so a JSON-only program installs and loads no parser at all.

**Migration:** change the codec import, and add the engine for each format you read to your own manifest:

```ts
// Before
import { ConfigResolver, YamlCodec } from "@effected/config-file";

// After
import { ConfigResolver } from "@effected/config-file";
import { YamlCodec } from "@effected/config-file/yaml";
```

```bash
pnpm add @effected/yaml   # likewise @effected/jsonc or @effected/toml
```
