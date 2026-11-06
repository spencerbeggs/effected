---
type: Decision
title: The kit has one build target, and workspace links point at package roots
description: "dist/dev disappears: every workspace link resolves to a package root whose exports already name ./src/index.ts, so no sibling is built for typecheck or test, while dist/prod/<group>/{pkg,meta}, targets.json and issues.json stay byte-stable because silk-release-action hardcodes dist/prod. No source exports condition is added."
status: draft
tags:
  - architecture
  - dx
  - release
sources:
  - id: spec
    resource: ../../docs/superpowers/specs/2026-11-06-bundler-research.md
    title: "The bundler research report and the owner's rulings"
  - id: plan
    resource: ../../docs/superpowers/plans/2026-11-06-bundler-branch.md
    title: "Decisions this plan takes, items 1 and 3"
generated:
  by: "okfit/claude-code"
  at: 2026-11-06T17:08:05Z
integrity:
  generated:
    body: 2cbb2cc56a9dafd7
---

# The kit has one build target, and workspace links point at package roots

## Context

The current pipeline has two targets running the same passes, and the dev target exists for one reason: pnpm linking. `publishConfig.directory: dist/dev/pkg` with `linkDirectory: true` makes every sibling link resolve to built output, which is why every package carries a `prepare` build, why `types:check` depends on `^build:dev`, why the vitest setup builds before tests, and why an unbuilt sibling is a dangling symlink.[^spec]

## Decision

- **One target.** `dist/dev` goes away. Dropping `publishConfig.directory` and `linkDirectory` makes every workspace link point at the package root, which is all the dev build ever did.
- **Source manifests keep `"exports": { ".": "./src/index.ts" }`** as they do today. tsgo, vitest, rolldown and API Extractor's bundled TypeScript 6 are expected to resolve a `.ts` export target natively, so none of them needs a setting.[^plan]
- **`dist/prod/<group>/{pkg,meta}`, `dist/prod/targets.json` and `dist/prod/issues.json` stay byte-stable on this branch.** The kit's own releases run through `silk-release-action`, which hardcodes `dist/prod`, and tsdoctor reads the meta directory.
- **Turbo `build` depends on `types:check` and not on `^build`**, so the kit builds in parallel. The spike took this path for the declaration pass: it holds from source at 1.03 times the `dist/dev` time, so it needs neither the `paths` fallback nor `^build`; the numbers and the edge they leave are in [the module's spike section](../modules/bundler.md#source-sibling-spike). API Extractor over source siblings is the one piece not yet proven, and its result can still change this clause.[^plan]

## Alternatives rejected

- **A `source` exports condition.** The probe showed a custom condition lets raw Node run a sibling's source, and that tsgo and vitest honour it once configured.[^spec] The owner first ruled the name would be `source` or `development`. The condition still does not earn its place: the kit's source imports its own files as `./x.js`, which Node's type stripping does not rewrite, so raw Node cannot run the kit's source either way. It would add dist paths to 47 manifests and a conditions setting to four tools, for no consumer.[^plan]
- **Keeping the dev target beside prod.** That keeps every cost above, and in-workspace resolution would keep hiding what a consumer sees. The packed-install e2e is where consumer behaviour is proven.
- **Collapsing to `dist/<group>` on this branch.** The owner floated it and it remains the likely end state, but it moves a path three external readers depend on. It is a follow-up sequenced with `silk-release-action`, not part of this switch.

## Related

- [The bundler bootstraps from source](bundler-bootstraps-from-source.md) depends on these links.
- [`@effected/bundler`](../modules/bundler.md) emits the outputs this Decision holds stable.
- [The workspace module](../modules/workspace.md) and [build through turbo](../conventions/build-through-turbo-only.md) describe the two-target pipeline until the switch lands.

[^spec]: `docs/superpowers/specs/2026-11-06-bundler-research.md`, sections 2, 4, 5 and 12.
[^plan]: `docs/superpowers/plans/2026-11-06-bundler-branch.md`, the section "Decisions this plan takes".
