---
"@effected/config-file-yaml": minor
---

## Features

Initial release of `@effected/config-file-yaml` — a YAML `ConfigCodec` for `@effected/config-file`, built on `@effected/yaml`. Plugs YAML 1.2 parsing and stringification into the codec seam, so a config file can be YAML instead of JSON:

```ts
import { YamlCodec } from "@effected/config-file-yaml";
import { ConfigFile, ConfigResolver, MergeStrategy } from "@effected/config-file";
import { Schema } from "effect";

class AppShape extends Schema.Class<AppShape>("AppShape")({
  port: Schema.Number,
  host: Schema.String,
}) {}

class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

const AppConfigLive = ConfigFile.layer(AppConfig, {
  schema: AppShape,
  codec: YamlCodec,
  resolvers: [ConfigResolver.upwardWalk({ filename: ".apprc.yaml" })],
  strategy: MergeStrategy.firstMatch<AppShape>(),
});
```

* `YamlCodec` — a `ConfigCodec` (`name: "yaml"`) ready to pass to `ConfigFile.layer`, `MergeStrategy`, `EncryptedCodec` or `ConfigMigration.make`. Both `parse` and `stringify` fail with `ConfigCodecError`, the same error `@effected/config-file`'s own JSON codec raises, wrapping `@effected/yaml`'s `YamlParseError` / `YamlStringifyError` structurally in `cause` rather than flattening it to a string.
* Unlike the JSONC adapter, `YamlCodec` has a genuine encode path — `stringify` round-trips through `@effected/yaml`'s own serializer, with no comment-loss caveat.
