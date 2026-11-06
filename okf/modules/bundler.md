---
type: Module
title: "@effected/bundler"
description: "The kit's build pipeline as an integrated library: package and GitHub Action builds, API Extractor and the tsdoctor.json schema, SEA executables, the issues.json report and the build journals, returned as typed results that the effected tool's engine wraps for its two front ends."
status: draft
kind: package
resource: ../../packages/bundler
tags:
  - architecture
  - dx
  - release
sources:
  - id: issue-1224
    resource: https://github.com/spencerbeggs/effected/issues/1224
    title: "bundler: create @effected/bundler"
  - id: issue-1225
    resource: https://github.com/spencerbeggs/effected/issues/1225
    title: "bundler: move @tsdoctor/manifest's schema into the kit"
  - id: issue-1227
    resource: https://github.com/spencerbeggs/effected/issues/1227
    title: "plugin: build GitHub Actions through the effected CLI"
  - id: spec
    resource: ../../docs/superpowers/specs/2026-11-06-bundler-research.md
    title: "The bundler research report and the owner's rulings"
  - id: spike
    resource: ../../packages/bundler/__test__/e2e/kit-leaf.e2e.test.ts
    title: "The source-sibling spike, run with EFFECTED_SPIKE=1"
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T23:49:47Z
integrity:
  generated:
    body: ea50f556dd551b5f
---

# @effected/bundler

## Purpose

`@effected/bundler` builds a package, or a GitHub Action, from its source and its config. It ports `@savvy-web/tsdown-plugins` and the thin orchestration of `@savvy-web/bundler`,[^issue-1224] takes in the `BundleManifest` schema of `tsdoctor.json` from `@tsdoctor/manifest`,[^issue-1225] and rewrites `@savvy-web/github-action-builder` on rolldown.[^issue-1227]

It exists to end a loop. The kit built with a tool that depended on the kit, so an Effect minor advance had to pass through a kit release, two builder releases and a tsdoctor release before the kit could build on it.[^spec] `@savvy-web/rspress-builder` is not ported, because the [website](website.md) is frozen.

## Tier and dependency posture

[Integrated tier](../glossary/library-tier.md): it imports tsdown, rolldown, `rolldown-plugin-dts`, `@microsoft/api-extractor` and `@tsdown/exe` at runtime. It stands on kit libraries rather than hand-rolling what they own, among them [`config-file`](config-file.md) and [`toml`](toml.md) for its config and [`jsonl`](jsonl.md) for its journals.

- [`@effected/changesets`](changesets.md) is a `workspace:*` dependency, published exact, and so is this package under [`@effected/engine`](engine.md), per [the pin chain](../conventions/peer-dependency-discipline.md#cross-effected-dependencies).
- `effect` is a peerDependency from `catalog:effected:peers` with a devDependency from `catalog:effected`, like every kit package; the systems bundler's regular-dependency choice is not carried over, because [the one-resolved-effect-copy rule](../conventions/one-resolved-effect-copy.md) needs the consumer's copy.
- `typescript` is a peerDependency at the literal `7.1.0-beta || 7.1.1-rc || >=7.1.0 <8`, nightlies excluded, a range the tool's `cli`, `mcp` and `plugin` share ([the rule](../conventions/typescript-stays-in-the-bundler.md)). This is the only package that imports it. API Extractor keeps its own bundled TypeScript 6. The tsconfig presets ship from [the carrier](plugin.md), not from here.

## Module layout

Module-per-concept under `src/` groups, with `Bundler.ts` the orchestrator over them:

| Group | Owns |
| --- | --- |
| `config/`, `config-validation/` | the `EffectedConfig` schema, `effected.toml` discovery and merge, plugin module loading, the fast-fail validator |
| `entries/`, `catalog/` | the package's entry points, `catalog:` and `workspace:` resolution |
| `manifest/` | the emitted `package.json` |
| `targets/` | publish targets and `targets.json` |
| `passes/`, `dts/`, `tsconfig/`, `jsx/` | the JS pass and the declaration pass, and the tsconfigs they run on |
| `meta/` | API Extractor, the API models, the `BundleManifest` schema of `tsdoctor.json`, the Open Graph image |
| `exe/` | single-executable (SEA) builds |
| `report/` | the issue collector and `issues.json` |
| `journal/` | the two `.cache/effected/*.jsonl` journals |
| `changesets/` | optimistic next versions through `@effected/changesets` |
| `action/` | GitHub Action builds on rolldown |

## What it does not own

- **Rendering and exit codes.** The bundler returns typed results and fails with typed errors. Turning them into human lines, JSON, an MCP result or a process exit code belongs to [`@effected/engine`](engine.md) and the [`effected` command](cli.md) and [`effected-mcp` server](mcp.md) in front of it, under [the build commands' contract](../interfaces/build-commands.md).
- **The website.** It writes no docs pages, and it has no `meta.localPaths` copy into `website/lib/models`.
- **Release.** It emits what the release action packs. Publishing stays with the action.

## Load-bearing outputs

Other tools read these, so a change to one moves with its readers. The full contract is [the build artifacts](../interfaces/build-artifacts.md), and what configures them is [`effected.toml`](../interfaces/effected-toml.md):

| Output | Contract |
| --- | --- |
| `dist/prod/<group>/pkg` | the directory the release action packs; `PackedInstall` and the scratchpad's artifact mode read it too |
| `dist/prod/<group>/meta` | the API model, `package.json`, `tsconfig.json`, `tsdoctor.json` and `og/` read by tsdoctor, the release action and the construct generator |
| `dist/prod/targets.json` | the publish targets the release action binds to |
| `dist/prod/issues.json` | `buildOk` is the first thing a reader checks, never `errors.length`; the per-package artifact turbo caches |
| `.cache/effected/build.jsonl`, `.cache/effected/issues.jsonl` | the root journals, keyed by package |
| `process.env.__PACKAGE_VERSION__` | the define that `packages/plugin/src/version.ts` and `packages/cli/src/version.ts` read |

The emitted `tsdoctor.json` is a wire format with readers outside this repository. Its fields grow additively, and moving the schema here does not change a byte of what is written.[^spec]

## Source-sibling spike

**Verdict, measured 2026-11-06, spike closed: the declaration pass and API Extractor both hold with siblings resolved to source, so the kit builds that way with no `paths` fallback and no `^build` dependency.** The measurements below were taken before the links moved: API Extractor ran under CI's rules for cli-kit and outside them across the kit, and beyond cli-kit `pnpm ci:build` is what exercises CI's rules.[^spike]

`packages/cli-kit` was built in a scratch workspace of its `@effected/*` closure, with no sibling `dist` anywhere. Three alternating runs each, one fresh process per run:

| Siblings resolve to | dts pass | js pass | Whole build | Peak RSS |
| --- | --- | --- | --- | --- |
| source | 462-468 ms | 112-113 ms | 751-757 ms | 294-296 MB |
| `dist/dev` | 453-458 ms | 171-177 ms | 793-801 ms | 298-303 MB |

The dts pass takes 1.03 times as long, against the fallback's limit of 2. Both rows run this bundler, because the old one reports no per-pass time. The old bundler's own prod build emitted the same `index.d.ts` and `package.json` byte for byte.

What the result rests on:

- **cli-kit alone cannot fail this test.** Its public types are explicit, so its declarations stay byte-identical with every sibling link removed. A probe with inferred types crossing a sibling boundary is what discriminates: from source it emits `import("@effected/env").AudienceKind`, and with the links gone the same source emits `any`.
- **A kit-wide sweep agrees.** 48 of the 49 package directories with a `src/` built from source with no `.d.ts` byte difference from the old bundler. `pnpm-plugin-effected` was not compared, since it needs a virtual-module plugin the sweep did not pass. The sweep was a one-off, reading each package's build options from its config of the time by pattern.
- **API Extractor's output does not move, within what the sweep measured.** A second sweep with the meta pass on built the same 48 packages, and every `.api.json`, meta `package.json`, `tsconfig.json` and `tsdoctor.json` matched the old bundler byte for byte, with no errors. That sweep ran with `ci: false` and no suppressions, so `ae-forgotten-export` could not be fatal in it. Only cli-kit is proven under `ci: true`, with its own suppressions. `kit` and `mcp-kit` also list a stale `engine.api.json` and `mcp.api.json` in the old dist, which neither bundler wrote.
- **A symlinked `src/` would have answered the wrong question.** tsgo and rolldown realpath it, and its siblings then resolve through the main checkout's links.

**A sibling's source is accounted as suppressed.** 23 of the 48 packages reported `ae-wrong-input-file-type` once, naming a file in a sibling's `src/`, because API Extractor's diagnostics run follows a sibling import to its `.ts` source. It does not reach the model. The handler classifies that message as suppressed when the file's realpath lies outside the package's own, so `issues.json` stays clean; the same message about a file inside the package stays a warning, since that means its own declarations reached its source. The suppression also hides a file reached through a tsconfig `paths` alias that resolves outside the package.

Inlining is the other edge: **tsgo declares only the package's own project, so `bundledPackages` naming a sibling inlines the sibling's built declarations rather than its source.** The partition's dts-emit tsconfig maps that sibling, and only that sibling, to `dist/prod/<canonical group>/pkg`, the one case that writes `paths`, and a sibling with no build fails `ConfigValidationError` before any pass. A package inlining a sibling therefore needs `dependsOn: ["^build"]`, the single exception to the no-`^build` verdict. The spike pins both halves, and no kit package sets `bundledPackages`; [vitest-agent](../consumers/vitest-agent.md) does, for its reporter and UI API docs.

The edge this leaves: **a sibling's public function whose return type its entry point does not export gives a consumer's inferred declaration a silent `any` from source**, with no warning, no error and `buildOk: true`. The rolled-up `dist` gave a different wrong answer for the same site, a dangling name or a copied structure. The kit cannot grow such a site while it stays clean: the sibling's own API Extractor gate makes a public function returning an unexported type fatal in CI. A package outside that gate gets no such report.

## Action bundle spike

**Verdict, measured 2026-11-06, spike closed: rolldown bundles silk-release-action's five entries, one self-contained ESM file each, smaller than rspack and with the same runtime behaviour as far as a run can get. It takes one setting that its default gets wrong silently: `resolve.mainFields` must lead with `module`.** The spike is `packages/bundler/__test__/e2e/action-spike.e2e.test.ts`, opt-in through `EFFECTED_ACTION_SPIKE`.

It ran silk-release-action 5.10.6 on rolldown 1.2.16 and Node 26.13.0, with `platform: "node"`, `format: "esm"`, treeshake and minify on, `codeSplitting: false`, `node:` builtins external, and `supports-color` and `kerberos` aliased to a virtual throwing stub. The rspack column is that repository's committed `dist/`:

| Entry | rolldown | rspack | Build |
| --- | --- | --- | --- |
| `pre` | 348,634 B | 406,590 B | 161-174 ms |
| `main` | 2,368,768 B | 2,452,915 B | 324-352 ms |
| `post` | 348,553 B | 406,398 B | 115-152 ms |
| `changelog-silk` | 1,072,406 B | 1,095,259 B | 149-155 ms |
| `changelog-default` | 1,072,413 B | 1,095,266 B | 144-149 ms |

Every bundle imports from a directory outside the checkout with no `GITHUB_*` variable set, carries no build-machine path, and is byte-identical from a second build. With `GITHUB_ACTIONS` set, `pre`, `main` and `post` exit as the rspack bundles do and report the same `::error::` lines. `main` stops at the missing `INPUT_APP-CLIENT-ID`, so nothing past the input read has run in either bundle.

**Warnings.** With rolldown's default checks a build logs nothing: not for `import.meta`, not for a `require` of a builtin, not for the computed `import()` in `@changesets/apply-release-plan`, and not for the broken UMD bundle below. With `checks.circularDependency` on it logs only `CIRCULAR_DEPENDENCY`: 17 for `pre`, 18 for `main`, 17 for `post` and 2 for each worker, all in third-party packages (apache-arrow, `@redis/client`, semver, jju).

`ActionBundle` carries all of this, and each setting has a test that fails without it. What the action builder carries:

- **Module-first resolution, a requirement of the action bundler.** Rolldown's node default is `["main", "module"]`, which takes jsonc-parser's UMD build. Its factory receives `require` as a value, so its relative requires stay runtime calls: `Cannot find module './impl/format'` at import, in `main` and both workers, and a clean build. Set `resolve.mainFields` to `["module", "main"]`.
- **An import check.** That break shows up only when the bundle loads, so a clean rolldown run does not show a bundle works. It runs in a temporary directory with a scrubbed environment and a hard bound, and `build.importCheck = false` turns it off for an action with no `GITHUB_ACTIONS` guard.
- **`__dirname` and `__filename`.** Rolldown leaves them bare, and they die with a `ReferenceError` when called, not at import, so an import check misses them. No bundle here references either. A fixture shows `transform.define` to `import.meta.dirname` and `import.meta.filename` works.
- **`process.env.NODE_ENV` defined as `"production"`.** Rspack's production mode did this, and rolldown does not.
- **A real path for the cwd.** In unminified output rolldown names each module relative to its cwd, so a cwd reached through a symlink writes the machine's layout into the bundle and breaks byte-identical builds.
- **One build per entry**, with `codeSplitting: false`, plus `dist/package.json` holding `{ "type": "module" }`.
- **`ignore` as a `resolveId` and `load` plugin.** A virtual module needs no stub file on disk. Both stubs reached `main` and neither loaded at import. A package imported statically rather than through a guarded `require` or `import()` would throw at load.
- **`comments: { legal: true, annotation: false, jsdoc: false }`.** It keeps license banners inline, 4 `/*!` blocks in `main` against rspack's 3, with no sidecar file to fold back. `legalComments` is deprecated in favor of it. Comments marked `@preserve`, such as `v8 ignore` ones, stay too, as they do under rspack.
- **Circular-dependency checks off, or filtered to first-party modules.** Turned on, they report only third-party cycles here.

Three rspack workarounds have no counterpart. A CJS `require` of a builtin goes through `createRequire(import.meta.url)` and has real CommonJS semantics, `import.meta.url` stays a runtime expression, and a computed `import()` stays native, which is why `[action.build]` has no `nativeDynamicImports`. The fixture runs all three.

Not measured: `build.externals`, `build.sourceMap`, Windows, and any path through `main` past its inputs.

## Accepted debt

The ported internals keep their shape: mostly plain async code over `node:fs`, ported module for module because that code is tested and proven. Only the public boundary (`Bundler.build`, `ActionBuilder.build` and every error) is Effect with typed failures. That is a known departure from [requiring core in `R`](../conventions/require-in-r-default.md), accepted to keep the port honest. A follow-up issue is to be filed against that convention; it does not exist yet.

## Decisions

- [One build target from source links](../decisions/one-build-target-from-source-links.md)
- [The bundler bootstraps from source](../decisions/bundler-bootstraps-from-source.md)
- [`effected.toml` is the build config](../decisions/effected-toml-is-the-build-config.md)
- [Build logs are journals](../decisions/build-logs-are-journals.md)

[^issue-1224]: Issue 1224, `bundler: create @effected/bundler`.
[^issue-1225]: Issue 1225, `bundler: move @tsdoctor/manifest's schema into the kit`.
[^issue-1227]: Issue 1227, `plugin: build GitHub Actions through the effected CLI`.
[^spec]: `docs/superpowers/specs/2026-11-06-bundler-research.md`, sections 1, 2, 5 and 12.
[^spike]: `packages/bundler/__test__/e2e/kit-leaf.e2e.test.ts`.
