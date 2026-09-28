---
"@effected/app": minor
"@effected/cli": minor
"@effected/commands": minor
"@effected/config-file": minor
"@effected/engine": minor
"@effected/git": minor
"@effected/github-actions": minor
"@effected/github-references": minor
"@effected/github": minor
"@effected/glob": minor
"@effected/jsonc": minor
"@effected/jsonl": minor
"@effected/lockfiles": minor
"@effected/markdown": minor
"@effected/mcp": minor
"@effected/memfs": minor
"@effected/npm": minor
"@effected/package-json": minor
"@effected/pnpm-plugin-effect": minor
"@effected/runtimes": minor
"@effected/sbom": minor
"@effected/schema-org": minor
"@effected/schemastore-cli": minor
"@effected/schemastore": minor
"@effected/semver": minor
"@effected/spdx": minor
"@effected/store": minor
"@effected/templates": minor
"@effected/toml": minor
"@effected/tsconfig-json": minor
"@effected/walker": minor
"@effected/workspaces": minor
"@effected/xdg": minor
"@effected/yaml": minor
---

## Breaking Changes

The kit now builds on and peers `effect` `4.0.0-rc.118`, pinned exactly. Consumers must move `effect` and every `@effect/*` package to `4.0.0-rc.118` in the same install. Effect removed the `effect/unstable/*` export paths in this release, so an `@effected` package built on rc.118 cannot share an install with `effect` rc.117.

Moving the pin also closes a fresh-install failure on rc.117. `@effect/platform-node@4.0.0-rc.117` depends on `@effect/platform-node-shared` with a caret, so an install without a lockfile paired the rc.118 shared package with `effect` rc.117 and failed at startup with `ERR_MODULE_NOT_FOUND`.

Consumers moving to this release: effect removed the `effect/unstable/*` export paths (imports become `effect/<module>`), moved `Arbitrary` to `effect`, split `effect/Encoding` into `effect/encoding/Base64`, `Base64Url` and `Hex`, and renamed the `Schema` range and string checks (`isLengthBetween` → `isBetweenLength`, `isStartsWith` → `isStartingWith`, and so on). Kit exports are otherwise unchanged; the kit's own imports moved onto the new paths.
