---
"@effected/plugin": minor
---

## Features

* `effected package build` now ships with the tool, replacing `@savvy-web/bundler`, and `effected action build` replaces `@savvy-web/github-action-builder`. The `effected-mcp` server gains the matching `package_build` and `action_build` tools
* Adds the tsconfig presets `@effected/plugin/tsconfig/ecma.json` and `@effected/plugin/tsconfig/root.json`

## Breaking Changes

* `typescript` (`7.1.0-beta || 7.1.0-rc || >=7.1.0 <8`) and `@types/node` are now peer dependencies. Install them alongside the plugin, or expect a peer warning

## Other

* Upgrading: keep `@effected/plugin` as a root devDependency, never as a package's dependency
* Replace the `@savvy-web/bundler` devDependency and its `build:dev` / `build:prod` / `prepare` scripts with one `"build": "effected package build"` script, and move `savvy.build.ts` settings into `effected.toml`
* Build a GitHub Action with `effected action build` instead of `@savvy-web/github-action-builder`
