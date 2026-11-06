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
  at: 2026-11-06T17:47:56Z
integrity:
  generated:
    body: 8b2ac6191e359762
---

# @effected/bundler

## Purpose

`@effected/bundler` builds a package, or a GitHub Action, from its source and its config. It ports `@savvy-web/tsdown-plugins` and the thin orchestration of `@savvy-web/bundler`,[^issue-1224] takes in the `BundleManifest` schema of `tsdoctor.json` from `@tsdoctor/manifest`,[^issue-1225] and rewrites `@savvy-web/github-action-builder` on rolldown.[^issue-1227]

It exists to end a loop. The kit built with a tool that depended on the kit, so an Effect minor advance had to pass through a kit release, two builder releases and a tsdoctor release before the kit could build on it.[^spec] `@savvy-web/rspress-builder` is not ported, because the [website](website.md) is frozen.

## Tier and dependency posture

[Integrated tier](../glossary/library-tier.md): it imports tsdown, rolldown, `rolldown-plugin-dts`, `@microsoft/api-extractor` and `@tsdown/exe` at runtime. It stands on kit libraries rather than hand-rolling what they own, among them [`config-file`](config-file.md) and [`toml`](toml.md) for its config and [`jsonl`](jsonl.md) for its journals.

- [`@effected/changesets`](changesets.md) is a `workspace:*` dependency, published exact, and so is this package under [`@effected/engine`](engine.md), per [the pin chain](../conventions/peer-dependency-discipline.md#cross-effected-dependencies).
- `effect` is a peerDependency from `catalog:effected:peers` with a devDependency from `catalog:effected`, like every kit package; the systems bundler's regular-dependency choice is not carried over, because [the one-resolved-effect-copy rule](../conventions/one-resolved-effect-copy.md) needs the consumer's copy.
- `typescript` is a peerDependency, from `catalog:build:peers`. This package is [the only one in the kit that peers it](../conventions/typescript-stays-in-the-bundler.md). API Extractor keeps its own bundled TypeScript 6.

## Module layout

Module-per-concept under planned `src/` groups, with `Bundler.ts` the orchestrator over them:

| Group | Owns |
| --- | --- |
| `config/` | the `EffectedConfig` schema, `effected.toml` discovery and merge, plugin module loading |
| `entries/` | the package's entry points |
| `manifest/` | the emitted `package.json` |
| `targets/` | publish targets and `targets.json` |
| `passes/`, `dts/` | the JS pass and the declaration pass |
| `meta/` | API Extractor, the API models, the `BundleManifest` schema of `tsdoctor.json`, the Open Graph image |
| `exe/` | single-executable (SEA) builds |
| `report/` | the issue collector and `issues.json` |
| `journal/` | the two `.cache/effected/*.jsonl` journals |
| `changesets/` | optimistic next versions through `@effected/changesets` |
| `action/` | GitHub Action builds on rolldown |

## What it does not own

- **Rendering and exit codes.** The bundler returns typed results and fails with typed errors. Turning them into human lines, JSON, an MCP result or a process exit code belongs to [`@effected/engine`](engine.md) and the [`effected` command](cli.md) and [`effected-mcp` server](mcp.md) in front of it, under the shape [`engine/schema`](../interfaces/schema-commands.md) already sets.
- **The website.** It writes no docs pages, and it has no `meta.localPaths` copy into `website/lib/models`.
- **Release.** It emits what the release action packs. Publishing stays with the action.

## Load-bearing outputs

Other tools read these, so a change to one moves with its readers:

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

**Verdict, measured 2026-11-06: the declaration pass holds with siblings resolved to source across the kit, and API Extractor holds for cli-kit under CI's rules and across the kit outside them. Neither shows a need for a `paths` fallback or a `^build` dependency.** A `ci: true` sweep of the whole kit belongs to Phase 6, when the links move.[^spike]

`packages/cli-kit` was built in a scratch workspace of its `@effected/*` closure, with no sibling `dist` anywhere. Three alternating runs each, one fresh process per run:

| Siblings resolve to | dts pass | js pass | Whole build | Peak RSS |
| --- | --- | --- | --- | --- |
| source | 462-468 ms | 112-113 ms | 751-757 ms | 294-296 MB |
| `dist/dev` | 453-458 ms | 171-177 ms | 793-801 ms | 298-303 MB |

The dts pass takes 1.03 times as long, against the fallback's limit of 2. Both rows run this bundler, because the old one reports no per-pass time. The old bundler's own `build:prod` emits the same `index.d.ts` and `package.json` byte for byte.

What the result rests on:

- **cli-kit alone cannot fail this test.** Its public types are explicit, so its declarations stay byte-identical with every sibling link removed. A probe with inferred types crossing a sibling boundary is what discriminates: from source it emits `import("@effected/env").AudienceKind`, and with the links gone the same source emits `any`.
- **A kit-wide sweep agrees.** 48 of the 49 package directories with a `src/` built from source with no `.d.ts` byte difference from the old bundler. `pnpm-plugin-effected` was not compared, since it needs a virtual-module plugin the sweep did not pass. The sweep was a one-off and read each package's build options from its `savvy.build.ts` by pattern.
- **API Extractor's output does not move, within what the sweep measured.** A second sweep with the meta pass on built the same 48 packages, and every `.api.json`, meta `package.json`, `tsconfig.json` and `tsdoctor.json` matched the old bundler byte for byte, with no errors. That sweep ran with `ci: false` and no suppressions, so `ae-forgotten-export` could not be fatal in it. Only cli-kit is proven under `ci: true`, with its own suppressions. `kit` and `mcp-kit` also list a stale `engine.api.json` and `mcp.api.json` in the old dist, which neither bundler wrote.
- **A symlinked `src/` would have answered the wrong question.** tsgo and rolldown realpath it, and its siblings then resolve through the main checkout's links.

**A sibling's source is accounted as suppressed.** 23 of the 48 packages reported `ae-wrong-input-file-type` once, naming a file in a sibling's `src/`, because API Extractor's diagnostics run follows a sibling import to its `.ts` source. It does not reach the model. The handler classifies that message as suppressed when the file's realpath lies outside the package's own, so `issues.json` stays clean after the switch; the same message about a file inside the package stays a warning, since that means its own declarations reached its source.

Inlining is the other edge: **`bundledPackages` naming a sibling that resolves to source fails the build** with `tsgo did not generate a declaration file`, since tsgo declares only the package's own project. It is loud, the spike pins it, and no kit package sets `bundledPackages`.

The edge this leaves: **a sibling's public function whose return type its entry point does not export gives a consumer's inferred declaration a silent `any` from source**, with no warning, no error and `buildOk: true`. The rolled-up `dist` gave a different wrong answer for the same site, a dangling name or a copied structure. The kit cannot grow such a site while it stays clean: the sibling's own API Extractor gate makes a public function returning an unexported type fatal in CI. A package outside that gate gets no such report.

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
