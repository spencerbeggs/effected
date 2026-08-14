---
"@effected/app": minor
---

## Features

### `AppConfig.layer` accepts a caller resolver chain

`AppConfigOptions` gains an optional `resolvers`, composed **ahead** of the XDG chain in the order given. The case it exists for is a CLI's `--config` flag, which has to outrank the app's own search path:

```ts
const ConfigLive = AppConfig.layer(SettingsFile, {
	filename: "settings.toml",
	schema: Settings,
	codec: TomlCodec,
	resolvers: flag === undefined ? [] : [ConfigResolver.explicitPath(flag)],
});
```

`ConfigResolver.staticDir` covers a flag naming a directory, and `ConfigResolver.upwardWalk` a project-local file. Previously this meant dropping to `ConfigFile.layer` and rebuilding the XDG wiring — the save path, the ambient namespace — by hand.

Prepending is the whole contract: `XdgConfig.resolver` and the native probe stay behind whatever you pass, so **the default chain is unchanged** when the option is absent.

Two properties worth knowing before you rely on it:

* A caller resolver that finds nothing **falls through** to the XDG chain. Every `ConfigResolver`'s error channel is `never` by contract, so a `--config` naming a file that does not exist quietly loads the XDG config instead. If that must be an error, check the path before building the layer.
* The **save path is unaffected**. `save` still writes to the app's own config directory; writing back to a flag-named file is `write(value, path)`.

A chain that needs the XDG resolvers anywhere but last — or not at all — has outgrown the preset: compose `ConfigFile.layer` from `@effected/config-file` directly and order the chain yourself.

`AppConfigOptions` takes a third type parameter, `RR`, for those resolvers' requirements; it defaults to `never` and joins the layer's `R`. Existing code naming `AppConfigOptions<A, I>` is unaffected.
