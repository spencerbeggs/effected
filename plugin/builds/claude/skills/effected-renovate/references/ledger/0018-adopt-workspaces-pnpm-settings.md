---
id: "0018"
title: "@effected/workspaces: PnpmSettings reads pnpm's effective settings without spawning pnpm"
kind: adopt
shows: none
applies:
  "@effected/workspaces": ">=0.44.0"
detect: ["pnpm config get", "\"config\", \"get\""]
closes: ["spencerbeggs/effected#1171", "spencerbeggs/effected#1285"]
changesets: ["set-patterns-fail"]
---

Offer this to the user; never apply it unasked. It replaces `pnpm config get` shell-outs, such as a tool applying pnpm's release-age gate itself.

- **`PnpmSettings.load({ cwd, env, platform })`** locates and reads the files through `FileSystem` and `Path`, failing with `PnpmSettingsError`, whose `reason` is `read`, `parse`, `shape` or `membership` (the workspace's `packages:` patterns compile one by one but not as a set, so membership cannot be decided). `PnpmSettings.fromSourcesResult` is the pure form over text.
- **Typed reads** are `get`, `getString`, `getNumber`, `getBoolean` and `getStringArray`, each answering an `Option`. `origin` says where a value came from. Keys may be camelCase or kebab-case.
- **`minimumReleaseAge`** answers an `Option`, and **`minimumReleaseAgeExclude`** answers an empty list when unset.

The precedence, highest first, is the `pnpm_config_*` or `PNPM_CONFIG_*` environment variables, the workspace root's `pnpm-workspace.yaml`, then pnpm's global `config.yaml`. A higher source replaces a whole list. Neither `.npmrc`, `npm_config_*` nor the global `rc` file holds a pnpm setting, so code that also looked there can stop. Registries and credentials stay in `@effected/npm`'s `NpmConfig`.

An unset `minimumReleaseAge` reads as `None`, as `pnpm config get` reports it undefined, so keep any fallback the caller applies. Read the installed `.d.ts` for the exact shapes.
