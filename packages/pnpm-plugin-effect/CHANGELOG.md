# @effected/pnpm-plugin-effect

## 0.6.1

### Maintenance

* Synced the `effected` catalog to the current kit release versions [#471][#471]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#471]: https://github.com/spencerbeggs/effected/pull/471

## 0.6.0

### Features

* ### `catalog:effected` and `catalog:effected:peers`

  The plugin now ships two additional pnpm catalogs alongside the existing `effect` pair, covering every published `@effected/*` kit package (`@effected/pnpm-plugin-effect` itself excluded). Reference a kit package by catalog name instead of a hand-written range:

  ```json
  {
    "dependencies": {
      "@effected/workspaces": "catalog:effected"
    },
    "peerDependencies": {
      "@effected/workspaces": "catalog:effected:peers"
    }
  }
  ```

  On `0.x`, a caret does not cross a minor, so a hand-written range like `^0.14.0` silently stops resolving once that package cuts `0.15.0`. `catalog:effected` replaces the range with a name and moves the whole kit surface in one step when the config dependency is upgraded. `catalog:effected:peers` carries the same package set at a minor-floored peer range, computed the same way the existing `effect:peers` catalog is.

  The `effected` catalogs are rebuilt automatically as kit packages release, so each new version of this package carries the kit's current versions — upgrading the config dependency is how a consumer picks them up:

  ````bash
  pnpm update --config @effected/pnpm-plugin-effect
  pnpm install
  ``` [#463](https://github.com/spencerbeggs/effected/pull/463) Thanks [@spencerbeggs](https://github.com/spencerbeggs)!
  ````

## 0.5.0

### Breaking Changes

* ### The legacy `effectPeers` catalog name is removed

  The distributed catalog set no longer includes `effectPeers`, the camelCase compatibility duplicate of `effect:peers`. Both names carried the identical package set; only the colon-form survives. A workspace still referencing the old name fails resolution at install time with an unknown-catalog error rather than silently resolving elsewhere.

  Migration is a rename per specifier — replace `catalog:effectPeers` with `catalog:effect:peers` wherever it appears (typically `peerDependencies`), then reinstall:

  ```diff
   "peerDependencies": {
  -  "effect": "catalog:effectPeers"
  +  "effect": "catalog:effect:peers"
   }
  ```

  Nothing about resolved versions changes — only the name. The surviving `effect:peers` catalog carries the same 28 packages the removed name did, pinned under the `lock` strategy (all at `4.0.0-rc.109` except `@effect/tsgo` at `0.36.5`):

  * `effect` itself, `@effect/vitest`, `@effect/tsgo`, `@effect/opentelemetry` and `@effect/openapi-generator`
  * the four `@effect/ai-*` providers: `ai-anthropic`, `ai-openai`, `ai-openai-compat`, `ai-openrouter`
  * the three `@effect/atom-*` bindings: `atom-react`, `atom-solid`, `atom-vue`
  * the four platform packages: `platform-browser`, `platform-bun`, `platform-node`, `platform-node-shared`
  * the twelve `@effect/sql-*` drivers: `sql-clickhouse`, `sql-d1`, `sql-libsql`, `sql-mssql`, `sql-mysql2`, `sql-pg`, `sql-pglite`, `sql-sqlite-bun`, `sql-sqlite-do`, `sql-sqlite-node`, `sql-sqlite-react-native`, `sql-sqlite-wasm`

  ### The Effect v3 interop catalogs are removed

  The `effect3` and `effect3:peers` catalogs (and the legacy `effect3Peers` duplicate) are no longer distributed. They tracked the latest Effect **v3** releases for dual-version testing during the v3→v4 transition; no consumer references them anymore, so they leave ahead of the `1.0.0` originally slated to drop them. A workspace still referencing `catalog:effect3` or `catalog:effect3:peers` fails resolution at install time with an unknown-catalog error. There is no replacement — a repo that still needs v3 interop pins should declare them directly.

### Features

* The distributed `effect` and `effect:peers` catalogs advance from `4.0.0-beta.107` to `4.0.0-rc.109` (Effect's release line renamed beta → rc at rc.108), and `@effect/tsgo` from `0.36.4` to `0.36.5`, still under the `lock` strategy — exact pins, never a caret.

### Dependencies

* | Dependency           | Type          | Action  | From   | To    |
  | :------------------- | :------------ | :------ | :----- | :---- |
  | rolldown-pnpm-config | devDependency | updated | 0.5.10 | 0.6.0 |

  The legacy name was synthesized by the catalog generator, not declared here — `rolldown-pnpm-config` emitted every peers catalog under both spellings through `0.5.x` and emits only the colon form as of `0.6.0`. [#389][#389]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.4.0

### Dependencies

* | Dependency | Type   | Action  | From           | To             |
  | :--------- | :----- | :------ | :------------- | :------------- |
  | effect     | config | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Maintenance

* Advances every generated `effect` satellite entry (`@effect/ai-*`, `@effect/atom-*`, `@effect/platform-*`, `@effect/sql-*`, `@effect/opentelemetry`, `@effect/openapi-generator`, and peers) in the plugin's catalog table from `4.0.0-beta.101` to `4.0.0-beta.107`, keeping the generated `peerDependencyRules.allowedVersions` table in sync with the kit's pinned beta. [#322][#322]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.3.2

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.3.1

### Documentation

* Catalog notes follow the `.repos/effect` rename and record the current pin [#162][#162]

### Maintenance

* Advanced every `catalog:effect` and `catalog:effectPeers` entry from `4.0.0-beta.99` to `4.0.0-beta.101`, keeping the `lock` strategy's exact pins on both the range and the peer side
* Regenerated the version-qualified `peerDependencyRules.allowedVersions` table from the advanced lock catalog

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.3.0

### Features

* Adds `catalog:effect:peers` with generated peerDependency rules.

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.0

### Features

* ### Generated peer allowed-versions table

  The plugin now generates a `peerDependencyRules.allowedVersions` table from
  the lock catalog, with every rule keyed by a version-qualified parent
  selector:

  ```jsonc
  {
  	"peerDependencyRules": {
  		"allowedVersions": {
  			"@effect/platform-node@4.0.0-beta.99>effect": "4.0.0-beta.99"
  		}
  	}
  }
  ```

  Because each key names the exact satellite version it covers, an `@effect`
  satellite one beta ahead of or behind the pinned `effect` no longer raises a
  peer warning, while a same-named Effect v3 satellite's genuinely unmet peer
  still does. The table is materialized into the plugin's config between
  sentinel comments and regenerated by the package's `pnpm:export` flow, so
  advancing the Effect catalogs refreshes the rules in the same motion. The
  rules are scoped to the effect satellite family only — nothing outside it is
  silenced. [#122][#122]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.1.1

### Bug Fixes

* Added a direct `effect` devDependency (pinned to the workspace's `catalog:effect`) so pnpm binds `@savvy-web/bundler` 2.0's published `@effected/*` peers to Effect v4 instead of the v3 version `rolldown-pnpm-config` carries. Without this, the package failed to build. [#85][#85]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#85]: https://github.com/spencerbeggs/effected/pull/85

## 0.1.0

### Features

* A pnpm config dependency that centralizes Effect-ecosystem versioning through pnpm catalogs. It ships catalogs and a pnpmfile — there is no code API to import. Install it once and every package in the workspace can reference the catalogs by name in place of a version range.

  ### What it ships

  * `catalog:effect` — every `effect` and `@effect/*` package pinned to one Effect v4 beta release. Use it in `dependencies` for applications and `devDependencies` for libraries.
  * `catalog:effectPeers` — the same package set at the computed shared peer floor, the widest range a library can safely advertise in `peerDependencies` without over-constraining the applications that install it.
  * `catalog:effect3` / `catalog:effect3Peers` — the same package set tracking the latest Effect v3 releases (a few excluded), for verifying code against both Effect majors in one monorepo during the v3 → v4 transition. Removed at this plugin's own `1.0.0`, once Effect `4.0.0` has shipped.

  ### Installing and using it

  Add it as a config dependency — not a regular dependency — so pnpm installs it ahead of the rest of the tree and lets it contribute the catalogs to the install that follows:

  ```bash
  pnpm add --config @effected/pnpm-plugin-effect
  ```

  The command writes the package and its integrity hash into `pnpm-workspace.yaml`, and both catalogs become available workspace-wide. Reference them by name in `package.json`:

  ```json
  {
    "devDependencies": {
      "effect": "catalog:effect",
      "@effect/ai-openai": "catalog:effect"
    },
    "peerDependencies": {
      "effect": "catalog:effectPeers",
      "@effect/ai-openai": "catalog:effectPeers"
    }
  }
  ```

  pnpm rewrites `catalog:` specifiers to concrete ranges when it publishes, so what lands on the registry is an ordinary manifest — nothing downstream needs this plugin, or pnpm. Requires pnpm 11 or newer. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
