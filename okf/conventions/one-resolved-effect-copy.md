---
type: Convention
title: Keep the tree resolved to one effect copy
description: The whole workspace and its build toolchain must resolve to exactly one installed copy of effect, the version the catalog names and the derived family pins hold.
status: stable
stale_after: 2027-03-13T00:00:00Z
tags:
  - architecture
  - compat
sources:
  - id: pnpmfile
    resource: ../../.pnpmfile.cjs
    title: "The readPackage bridge for the Effect 4.1 advance"
  - id: okfit-split
    resource: "Observation 2026-10-31, feat/effect-4.1.1: node_modules/.bin/okfit (okfit 0.15.1) binds effect@4.1.1 for @okfit/* and 4.0.7 for its @effected/* dependencies, and crashes on every command"
  - id: satellite
    resource: "Observation 2026-10-31, feat/effect-4.1.1: pnpm install of the toolchain-wide hook resolved @effect/platform-node-shared@4.1.1(effect@4.0.7) under the bridged @effect/platform-node@4.0.7; every prepare build:dev failed with ERR_MODULE_NOT_FOUND for effect/dist/process/CommandLine.js"
generated:
  by: "okfit/claude-code"
  at: 2026-10-31T18:50:20Z
integrity:
  generated:
    body: 58e163ed40688458
---

# Keep the tree resolved to one effect copy

Always treat a second resolved `effect` copy anywhere in the tree — this workspace or its build toolchain (`@savvy-web/*`, rolldown-pnpm-config, okfit, tsdoctor, vitest-agent) — as a defect to fix at its entry point (the pin, the catalog, or upstream), never as something to route around locally.

This is a correctness requirement, not hygiene. A `Context.Service` tag is an identity: two resolved copies of the same package are two distinct tags, so a layer built from one copy does not satisfy a requirement expressed against the other, and the type system is right to reject it even though the diagnostic rarely says so in those terms. A duplicated `effect` inside one Schema decode pipeline has crashed every package's build with a type error surfacing deep inside a parser (`TypeError: text.charCodeAt is not a function`), and a stale caret across a consumer's own packages has produced `Layer<…> is not assignable to Layer<…>` diagnostics that read like a signature change but are duplicate identity — checking the `.d.ts` diff first (finding it clean) is what points at duplication instead. Never chase this class of error as an API signature bug before ruling out a second resolved copy: the tell is a stack or a lockfile entry naming two different `effect@…` paths.

**Decide whether an `effect` advance strands anything before you make it.** The answer depends on the peer the previously-published closure advertises:

- **A tilde peer (`~4.<minor>.0`)**, which every release since [the effect catalog holds one minor](../decisions/effect-catalog-minor-lock.md) advertises, accepts a new patch on the same minor and is stranded by a new minor.
- **A caret peer (`^4.0.0`)**, which releases under [the stable-line decision](../decisions/effect-catalog-tracks-stable-minor.md) and [the derived-overrides decision](../decisions/effect-overrides-derived-from-catalog.md) advertised, accepts any newer `4.x` on paper. On a minor advance that acceptance is the danger: the derived `effect@^4.0.0` pins move such a closure onto the new minor, and if the minor removed something it imports at load time, it dies at import ([the catalog crossed an Effect minor](../incidents/catalog-crossed-effect-minor.md)).
- **An exact peer**, which releases under [the exact-lock decision](../decisions/effect-catalog-locked-exact.md) and every release-candidate release advertised, is stranded by any advance.

A patch advance strands nothing a tilde or caret peer covers; the risk left is a `@stability unstable` API the kit imports, and the advance's own rebuild and retest is the guard. Otherwise, pick the bridge shape by asking one question: does the previously-published `@effected/*` closure still run on the new `effect`?

- **Runtime-compatible:** bridge old→new with a `pnpm-workspace.yaml` `overrides` block, one entry per stranded package (`effect`, and any platform packages such as `@effect/platform-node` / `@effect/sql-sqlite-node` also stranded at the old spec), rewriting the old spec to the new one. This collapses the tree back to one copy immediately. The plugin ships a scoped example: its `platform-node-shared` overrides, one per release-candidate parent (see [the scoped overrides](../modules/pnpm-plugin-effected.md#the-derived-family-pins-and-the-scoped-platform-node-shared-overrides)).
- **Runtime-incompatible, toolchain on its own `effect`:** an `overrides` block would run old-pin-built code against the new `effect` and crash at module initialization. Bridge instead with a `packageExtensions` block that pins the **toolchain's own peers** (the `@effected/*` packages the toolchain takes as peers, for example via `@savvy-web/tsdown-plugins`) to regular dependencies on the toolchain's still-old `effect`, so the toolchain runs a homogeneous old-pin world while it compiles new-pin source it never executes. Accept two `effect` copies in the lockfile for this window.
- **Runtime-incompatible, published kit at the workspace's own versions:** when the published closure's versions equal the workspace packages' unbumped versions, a `packageExtensions` key would select the workspace's own packages too. Bridge with a root `.pnpmfile.cjs` `readPackage` hook instead, keyed on `private !== true`, since every source manifest here is `private: true`.[^pnpmfile] The hook bridges three sets of packages: every published `@effected/*` package and anything that depends on or peers on one; the toolchain families themselves (`@savvy-web/*`, `@okfit/*`, `@tsdoctor/*`, `@vitest-agent/*`, `@pluginfinity/*`, `rolldown-pnpm-config`, `rspress-plugin-api-extractor`); and every `effect`-line package at exactly `<old>`. For each, it turns `effect` and every `@effect/*` on the 4.x line (peer or dependency) into a regular dependency on `npm:<name>@<old>`. The npm alias slips past the version-selector override `effect@^4.0.0: <new>`; a plain `<old>` dependency does not, because the override rewrites it. The Effect 4.1 advance used this shape with `<old>` = 4.0.7. Remove it once the toolchain republishes on an `@effected` release built on the new minor; then no lockfile `packages:` entry names the old `effect`.

Each of the three sets closes a crash the narrower hook hit:

- **The tools, not only the kit they load.** Bridging `@effected/*` alone left a tool's own packages on the new `effect` while their `@effected/*` dependencies bound the old one. okfit 0.15.1 ran two copies and crashed on every command with `TypeError: Cannot convert a Symbol value to a string`.[^okfit-split]
- **The old satellites' own satellites.** A bridged `@effect/platform-node@<old>` still depends on `@effect/platform-node-shared`. The derived override `@effect/platform-node-shared@^4.0.0: <new>` caught that edge and produced `@effect/platform-node-shared@<new>(effect@<old>)`, a new-minor satellite bound to the old core, which failed to import `effect/process/CommandLine` and broke every `prepare` build in the install.[^satellite]

After each install, confirm: every importer's `effect` resolves `<new>`; no `packages:` snapshot pairs a `<new>` satellite with `effect@<old>` (or the reverse); the `importers:` section's `link:` edge count is unchanged; and each tool (okfit, the bundler through a `pnpm build`, vitest-agent) runs once.

Never let a `packageExtensions` key match a workspace package's own current version — pnpm applies extensions to local packages too, and an extension matching a workspace package's exact version has silently rewritten that package's own `workspace:*` edge to a published version, or added a dependency it should not have. Diff the lockfile's `importers:` section against the pre-bridge copy on every edit to the block; it must be empty. Retire any bridge only once the packages-section-scoped count of the old spec reaches zero with the block removed — a bare `grep -c` across the whole lockfile is not sufficient, because an `overrides` block's own redirect line (`effect@<old>: <new>`) matches the old spec string without being a second copy.

Full re-pin mechanics are in [advance the effect pin](../runbooks/advance-the-effect-pin.md).

[^pnpmfile]: `.pnpmfile.cjs` at the repository root.
[^okfit-split]: Observed 2026-10-31 on feat/effect-4.1.1.
[^satellite]: Observed 2026-10-31 on feat/effect-4.1.1, the first install of the toolchain-wide hook.
