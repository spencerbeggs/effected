---
"@effected/app": minor
---

## Features

### `AppConfig.layer` options: `xdg`, `systemEtc`, `resolversAfter`

The resolver chain `AppConfig.layer` builds is now caller-controlled at both ends and in the middle, without giving up the ambient namespace and `defaultPath` wiring the preset does for free:

- `xdg?: boolean` — pass `false` to drop the XDG pair (`XdgConfig.resolver` and `XdgConfig.nativeResolver`) entirely, so a `--config <path>` flag's own resolver is the only lookup and a failed explicit path can no longer silently fall through to the user's XDG config (#631).
- `systemEtc?: boolean | { dir?: string }` — appends a machine-wide `/etc/<namespace>/<filename>` tier behind the XDG pair; an object overrides the root, chiefly for pointing the tier at a writable directory in tests (#645).
- `resolversAfter?: ReadonlyArray<ConfigResolver<RR>>` — composes after every built-in tier, the counterpart to the existing `resolvers` (which prepends).

With `xdg: false` the chain is exactly `[...resolvers, ...resolversAfter]`, so an app that previously had to drop to `ConfigFile.layer` directly for a non-standard chain no longer needs to.

```ts
AppConfig.layer(MyConfigTag, {
	filename: "app.toml",
	xdg: false,
	resolvers: [ConfigResolver.explicitPath(cliFlag)],
});
```

This also addresses the second half of #97, which asked for `AppConfig`'s resolver chain to be swappable within `App` — `xdg: false` plus `resolvers`/`resolversAfter` now expresses a caller's own chain end to end while the preset still supplies the ambient namespace and `defaultPath`. The first half of that issue — composing more than one `Store` under a single control plane — is untouched, so #97 is not closed by this change.
