---
"@effected/config-file-toml": minor
---

## Features

Initial release of `@effected/config-file-toml` — a TOML `ConfigCodec` for `@effected/config-file`, built on `@effected/toml`. Plugs TOML 1.0.0 parsing and stringification into the codec seam, so a config file can be TOML instead of JSON:

```ts
import { TomlCodec } from "@effected/config-file-toml";
import { ConfigFile, ConfigResolver, MergeStrategy } from "@effected/config-file";
import { Schema } from "effect";

class AppShape extends Schema.Class<AppShape>("AppShape")({
  port: Schema.Number,
  host: Schema.String,
}) {}

class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("app/Config") {}

const AppConfigLive = ConfigFile.layer(AppConfig, {
  schema: AppShape,
  codec: TomlCodec,
  resolvers: [ConfigResolver.upwardWalk({ filename: ".apprc.toml" })],
  strategy: MergeStrategy.firstMatch<AppShape>(),
});
```

* `TomlCodec` — a `ConfigCodec` (`name: "toml"`) ready to pass to `ConfigFile.layer`, `MergeStrategy`, `EncryptedCodec` or `ConfigMigration.make`. Both `parse` and `stringify` fail with `ConfigCodecError`, the same error `@effected/config-file`'s own JSON codec raises, wrapping `@effected/toml`'s `TomlParseError` / `TomlStringifyError` structurally in `cause` rather than flattening it to a string.
* `@effected/toml`'s hardening rides along: array and inline-table nesting past the engine's depth cap fails as a typed `ConfigCodecError` carrying a positioned `NestingDepthExceeded` diagnostic, never a stack-overflow defect — on both the parse and stringify sides.
* TOML's value model surfaces honestly at the seam: date-times decode to `@effected/toml`'s four date-time classes, integers beyond ±(2^53 − 1) decode to `bigint`, and a document carrying `null` (which TOML cannot represent) fails `stringify` with a structured `UnsupportedValue` diagnostic in `cause`.
