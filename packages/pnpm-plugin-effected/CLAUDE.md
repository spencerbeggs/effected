# @effected/pnpm-plugin-effected

The kit's **companion** package: published and installable, but **not a library** — it exposes no API, so nothing can import it and it has **no tier**. Companion is a *category, not a fourth tier* ([the companion-package glossary entry](../../okf/glossary/companion-package.md)).

**Do not call it "repo infrastructure"** — that reads as internal-only tooling and twice produced errors claiming it does not publish. It **is public and published to npm**, released alongside the rest of the kit. **Do not infer from `"private": true` that it will not publish**; every source manifest here is private and the bundler's `publishConfig` transform emits the publishable one at build time.

It replaces `@effected/pnpm-plugin-effect` and continues that package's version line; the old name gets no further release. It needs its own npm trusted publisher before its first release.

**For full design rationale:**
→ `@./okf/modules/pnpm-plugin-effected.md`

Load when changing catalog strategy, advancing the Effect pin, or debugging workspace peer resolution.

## What it is

A pnpm **config dependency**, built with `rolldown-pnpm-config`. All catalog configuration lives in `lib/build/pnpm-config.plugin.ts`, where `PnpmConfigPlugin` declares each catalogued package with a `range`, a `peer` and a `strategy`. Source is two small files over the virtual modules:

- `src/pnpmfile.ts` re-exports the generated `updateConfig` unchanged; it serves every declared catalog, the `:peers` twins included.
- `src/index.ts` exports the declared `effected` catalog as `catalogs`.

## What consumers see: two catalogs, their peers twins, and `effected:exact`

A consumer sees **`effected`** (the Effect family plus every publishable `@effected/*` package but this one) and `effected:build`, each with its `:peers` twin, plus **`effected:exact`**: the `effected` catalog with every operator stripped, which `rolldown-pnpm-config` derives from `exact: true` on the declaration. A tool package writes `catalog:effected:exact` to pin the kit exactly (the carrier closure, `plugin/skills/design-patterns/references/carrier-closure.md`); libraries never do. The variant follows the frozen family versions, derives no override, and moves with every catalog rewrite, so `upgrade` never reports it. `effected:build` also carries `ink`, the CLI layer's renderer, beside React. Dependencies write `catalog:effected`; peers write `catalog:effected:peers`, the same split this repo's manifests use. The generated merge lets a consumer's own entries win. The twins were once hidden; that made consumers spell peers `catalog:effected`, which packs an exact version once the family is frozen. `__test__/catalog.test.ts` pins this against the built `dist/prod/npm/pkg/pnpmfile.mjs`. Why → `@./okf/decisions/consumer-catalog-fold.md`, `@./okf/decisions/one-declared-effected-catalog.md`.

**The served `effected` catalog names each pinned Effect-family member at its exact override version** (`effect: 4.<minor>.<patch>`), while the literal keeps the `~` range. pnpm never applies a version-selector override such as `effect@^4.0.0` to a `catalog:` specifier (pnpm/pnpm#17922), so a served tilde let a consumer resolve a second, newer `effect`. `rolldown-pnpm-config` does the freeze; the upgrade CLI and peer derivation still read the literal. A consumer's own local `catalogs.effected` block still wins, and stays exposed until it re-exports or drops the block. Why → `@./okf/decisions/effect-overrides-derived-from-catalog.md`.

**`pnpm pack` writes a `catalog:` specifier as the served catalog's value**, so a consumer peer written as `catalog:effected` publishes the exact Effect-family pin and a peer written as `catalog:effected:peers` publishes the floored `~4.<minor>.0`. Do not try to rewrite peers in a hook; the peers twin is the answer.

## What it declares: one catalog, two halves

`lib/build/pnpm-config.plugin.ts` **declares** one catalog, `effected`, with a `:peers` twin: the Effect family first, then the kit. **Do not split it again, and never widen the override filter**: the Effect family is pinned graph-wide and the kit is not, and the `overridesFromCatalogs` `include` patterns are what draw that line (see Overrides). `__test__/catalog.test.ts` asserts the catalog holds nothing but the family and the kit, and that no override pins an `@effected/*` package.

This repository does not run the hook on itself. `pnpm:export` writes `effected` and `effected:peers` into the root `pnpm-workspace.yaml`, so this repo's manifests use the consumer's names, `catalog:effected` (dev) and `catalog:effected:peers` (peer), and the kit's published `effect` peer stays floored. **`pnpm:export` keeps catalogs the plugin no longer declares**: delete a removed one from `pnpm-workspace.yaml` by hand → `@./okf/gotchas/export-keeps-removed-catalogs.md`.

**Every `effect`-family entry is `range: "~4.<minor>.<patch>"`, `peer: "~4.<minor>.0"`, `strategy: "lock-minor"`.** `@effect/tsgo` keeps a `^0.<minor>.0` caret, which on 0.x already holds the minor. **Never restore a caret on a 4.x entry**: under a caret the catalog sync's `upgrade --yes` took Effect 4.1.0 while the published kit was built on 4.0.7, and the kit died at import (`does not provide an export named 'Crypto'`). `__test__/catalog.test.ts` rejects any operator but the tilde, and requires every 4.x entry at `effect`'s own version. Why → `@./okf/decisions/effect-catalog-minor-lock.md`, `@./okf/incidents/catalog-crossed-effect-minor.md`. An Effect minor arrives only through `okf/runbooks/advance-the-effect-pin.md`.

The kit half: object form, `strategy: "lock-minor"`, `source: "workspace"`, each package at its **next release** version. `lib/scripts/catalog-sync.ts` counts only `@effected/*` names as membership. Four properties are load-bearing ([reasoning](../../okf/models/effected-catalog-literal.md)):

- **`@effected/pnpm-plugin-effected` is deliberately absent from its own catalog, and must stay absent.** Catalogue it and every rewrite bumps the plugin, invalidating the catalog and writing another changeset — a release loop with no termination condition. `__test__/catalog.test.ts` pins it; [its Decision](../../okf/decisions/plugin-never-in-its-own-catalog.md).
- **Publishability is `publishConfig.access === "public"`, never `private === false`.** A membership check written against `private` classifies the whole kit as unpublishable and silently emits an empty catalog.
- **The literal must stay inline at the `PnpmConfigPlugin(...)` call site** — the `upgrade` CLI finds it by statically walking that call argument; hoisting it into an exported `const` makes it invisible to the rewriter.
- **`lock-minor` floors peer patches**, so a first sync normalizing `^0.11.1` down to `^0.11.0` is correct, not drift.

The Effect **v3** interop catalogs (`effect3` / `effect3:peers`) and the camelCase `effectPeers` alias are retired. Do not reintroduce them.

## Overrides

`overridesFromCatalogs: { catalog: "effected", include: ["effect", "@effect/*"] }` derives one `"<name>@^4.0.0": "<catalog version>"` pin per family member (tsgo on its own 0.x line), so the whole consumer graph runs one `effect`. The patterns are core `effect/Glob`: `*` does not cross the scope `/`, so no `@effected/*` entry matches and a kit package added to the catalog gains no override. An `include` entry that matches nothing throws at build time. Never hand-write them; they move with the catalog literal. The pins also move a published kit built on an older minor onto the catalog's minor, which is why a minor advance needs the bridge in `okf/conventions/one-resolved-effect-copy.md`. The only authored `overrides` are the two release-candidate `platform-node-shared` entries. Why → `@./okf/decisions/effect-overrides-derived-from-catalog.md`.

`peerDependencyRules.allowedVersionsFromCatalogs` stays declared (`catalog: "effected"`), but it derives a rule only for an exact entry and no entry is exact, so the exported table is empty. There is no generator script and no checked-in table; do not restore `allowed-versions.gen.ts` or its test.

## Two script classes — do not merge them

**User-run only. Agents must not invoke these**; they rewrite this package's `lib/build/pnpm-config.plugin.ts` and the root `pnpm-workspace.yaml`, which moves every resolved version on the next install. Surface the command and let the user run it:

- `pnpm pnpm:up` → `rolldown-pnpm-config upgrade lib/build/pnpm-config.plugin.ts`, interactively.
- `pnpm pnpm:preview` → print the generated catalogs without writing.
- `pnpm pnpm:export` → write the catalogs and derived overrides into the root `pnpm-workspace.yaml`, and surface drift.

**Agents may run** the root `pnpm catalog:check` (read-only gate) and `pnpm catalog:sync` (rewrites only this package's `lib/build/pnpm-config.plugin.ts` plus one fixed-name changeset). Its `upgrade --yes` walks the whole literal, so it moves the Effect family to a new patch as well as the kit; the tilde stops it at the minor. CI syncs on every **PR** to `main` and to `changeset-release/main` (plus `workflow_dispatch`). Mechanics → `@./okf/interfaces/catalog-sync-cli.md` — Load when: touching the sync scripts, the catalog literal, or the workflow.

**Builds must never write the catalog** — an earlier seam rewrote it from the build's freeze path, making every local and CI build mutate the repo.

## Peer discipline this package exists to hold

Root `pnpm-workspace.yaml` sets exactly one resolver-relevant key: `autoInstallPeers: true`. There is no `dedupeDirectDeps` key, no `dedupePeerDependents` key and no `.npmrc` in this repo. Do not reintroduce any of them. **`okf/gotchas/expected-peers-check-occupant.md` is the authority on the live expected `pnpm peers check` state.**

**This package declares no `effect` and no `@effect/vitest` devDependency, and that absence is deliberate.** It ships and tests no `effect`-importing code — `catalog.test.ts` is plain vitest over the file system and the built pnpmfile. An `effect` devDependency here once steered the resolver; once `rolldown-pnpm-config` carried its own `effect`, the steering leaked the importer's newer `effect` into the tool's published `@effected/*` peers and crashed `pnpm:up` / `pnpm:export` / `catalog:check` at import. Do not reintroduce it.

## Hazards

- **After renaming this package (or any workspace package), the next `pnpm run` installs first** → `okf/gotchas/verify-deps-before-run.md`.
- **Always check the lockfile diff after an install** — a plain install once stripped turbo / biome / tsgo platform binaries from it.
- Never set `"private": false` — the build's `publishConfig` transform produces the publishable manifest.
- Never write to `.repos/effect` (read-only vendored Effect source).
