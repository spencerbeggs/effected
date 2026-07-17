# @effected/pnpm-plugin-effect

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
