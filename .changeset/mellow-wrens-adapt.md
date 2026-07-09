---
"@effected/config-file-jsonc": minor
---

## Features

Initial release of `@effected/config-file-jsonc` — a JSONC `ConfigCodec` for `@effected/config-file`, built on `@effected/jsonc`. Plugs comment- and trailing-comma-tolerant parsing into the codec seam, so a config file can be JSONC — the format behind `tsconfig.json` and VS Code settings — instead of strict JSON:

```ts
import { JsoncCodec } from "@effected/config-file-jsonc";
import { ConfigFile, ConfigResolver, MergeStrategy } from "@effected/config-file";
import { Schema } from "effect";

class AppShape extends Schema.Class<AppShape>("AppShape")({
  port: Schema.Number,
  host: Schema.String,
}) {}

class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

const AppConfigLive = ConfigFile.layer(AppConfig, {
  schema: AppShape,
  codec: JsoncCodec,
  resolvers: [ConfigResolver.upwardWalk({ filename: ".apprc.jsonc" })],
  strategy: MergeStrategy.firstMatch<AppShape>(),
});
```

* `JsoncCodec` — a `ConfigCodec` (`name: "jsonc"`) ready to pass to `ConfigFile.layer`, `MergeStrategy`, `EncryptedCodec` or `ConfigMigration.make`. Both `parse` and `stringify` fail with `ConfigCodecError`, the same error `@effected/config-file`'s own JSON codec raises, wrapping `@effected/jsonc`'s `JsoncParseError` structurally in `cause` rather than flattening it to a string.
* `JsoncCodec.stringify` writes plain JSON, not JSONC — `@effected/jsonc` exposes no comment-preserving encode, so comments do not survive a load-mutate-save round trip.
