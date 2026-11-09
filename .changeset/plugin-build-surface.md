---
"@effected/ai-plugins": minor
---

## Features

* A `building-a-package` skill for repositories that build with `effected package build`. It covers:
  * every `effected.toml` table and key, taken from `PackageBuildConfig`;
  * targets and publish groups;
  * output keys (`copy`, `plugins`, `looseFiles`, `overrides` with `outSubdir`, `exe`, manifest `drop` and `set`);
  * workspace wiring;
  * how to read `dist/prod/issues.json`, including what changes when a build runs under CI.
* An `authoring-tsdoc` skill on TSDoc for the kit build: the release-tag policy, fixes for each `ae-*` and `tsdoc-*` diagnostic, the supported tags, and registering custom tags and suppressions in `[package.build.meta.tsdoc]`. It sits beside `effect-api-extractor-bases`, and the two cross-link.
* A `tsdoc-fixer` agent that builds a package, reads `issues.json` and fixes every API Extractor diagnostic in source, then rebuilds to confirm.
  * It adds no suppressions and makes no config changes; it reports dependency, `dtsExternals` and suppression changes as recommendations.
  * It stops when a round makes no progress or after five rounds.
* A Claude Code background monitor, `build-diagnostics`, that reports `ae-*` and `tsdoc-*` diagnostics from `dist/prod/issues.json` once a package's count settles.
  * It stays quiet when the build failed, when the artifact is older than its sources or `effected.toml`, and when those inputs have uncommitted changes.
  * Set `EFFECTED_BUILD_MONITOR_STABLE_POLLS` to change how long a count must hold steady before it reports.
  * The Copilot build omits it.

## Bug Fixes

* The bundler reference in `effected-packages` described `effected.toml` discovery as "later wins". It now gives the rule the config loader follows: the first file found in each tier is the only one read, then the package tier merges over the root.
