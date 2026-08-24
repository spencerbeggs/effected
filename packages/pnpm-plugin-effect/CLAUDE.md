# @effected/pnpm-plugin-effect

The kit's **companion** package: published and installable, but **not a library** — it exposes no API, so nothing can import it and it has **no tier**. Companion is a *category, not a fourth tier*: the three tiers sit on the dependency-surface axis, meaningless here ([effect-standards.md](../../.claude/design/effected/effect-standards.md#companion-packages-published-but-not-a-library)).

**Do not call it "repo infrastructure"** — that reads as internal-only tooling and twice produced errors claiming it does not publish. It **is public and it is published to npm**, released alongside the rest of the kit. **Do not infer from `"private": true` that it will not publish**; every source manifest here is private and the bundler's `publishConfig` transform emits the publishable one at build time.

For consumers it is **optional but real**: installing it holds their `effect` versions, peer floors and `@effected/*` versions at the values this kit was built and tested against.

**For full design rationale:**
→ `@../../.claude/design/effected/packages/pnpm-plugin-effect.md`

Load when changing catalog strategy, advancing the Effect pin, or debugging workspace peer resolution.

## What it is

A pnpm **config dependency** (installed with `pnpm add --config`), built with `rolldown-pnpm-config`. Source is two one-line re-exports over its virtual modules: `src/index.ts` → `catalogs`, `src/pnpmfile.ts` → `hooks`.

All real configuration lives in `savvy.build.ts`, where `PnpmConfigPlugin` declares each catalogued package with a `range`, a `peer` and a `strategy`.

## What it publishes

**Four catalogs**, two pairs with different jobs.

The Effect pair, consumed by every `@effected/*` package:

- **`catalog:effect`** — the pinned current Effect v4 prerelease, `lock` strategy, used in `devDependencies`.
- **`catalog:effect:peers`** — the same package set as the advertised peer range. Under `lock` it holds the same exact pin, not a caret floor.

The kit pair, for consumers only — internal edges stay `workspace:*` and these are **not** exported into the root `pnpm-workspace.yaml`:

- **`catalog:effected` / `catalog:effected:peers`** — every publishable kit package but one, object form, `strategy: "lock-minor"`, `source: "workspace"`, holding each package's **next release** version.

Four properties are load-bearing ([reasoning](../../.claude/design/effected/packages/pnpm-plugin-effect.md#the-effected-catalog-the-kits-own-version-surface)):

- **`@effected/pnpm-plugin-effect` is deliberately absent from its own catalog, and must stay absent.** Catalogue it and every rewrite bumps the plugin, invalidating the catalog and writing another changeset — a release loop with no termination condition. The omission *is* the termination condition; `__test__/catalog.test.ts` pins it.
- **Publishability is `publishConfig.access === "public"`, never `private === false`.** A membership check written against `private` classifies the whole kit as unpublishable and silently emits an empty catalog.
- **The literal must stay inline at the `PnpmConfigPlugin(...)` call site** — the `upgrade` CLI finds it by statically walking that call argument; hoisting it into an exported `const` makes it invisible to the rewriter.
- **`lock-minor` floors peer patches**, so a first sync normalizing `^0.11.1` down to `^0.11.0` is correct, not drift.

Currently `effect` pins `4.0.0-rc.109` — **exact, never a caret**. A caret on a prerelease floats across the release line and desynchronizes the installed `effect` from the `.repos/effect` submodule, the authority on what v4 exports. `@effect/tsgo` keeps an exact `lock` entry although no workspace package consumes it — do not reintroduce it as a typechecker devDependency.

The Effect **v3** interop catalogs (`effect3` / `effect3:peers`) and the camelCase `effectPeers` alias were removed on the rc.109 advance. Do not reintroduce them.

## Two script classes — do not merge them

**User-run only. Agents must not invoke these**; they rewrite this package's `savvy.build.ts` and the root `pnpm-workspace.yaml`, which moves every resolved version on the next install. Surface the right command and let the user run it:

- `pnpm pnpm:up` → pin each Effect package to its latest v4 release and recompute the peer floor.
- `pnpm pnpm:preview` → print the generated catalogs without writing.
- `pnpm pnpm:export` → write the catalogs and the derived allowed-versions table into the root `pnpm-workspace.yaml`, and surface drift.

Advancing the pin is `pnpm pnpm:up` then `pnpm pnpm:export`.

**Agents may run** the root `pnpm catalog:check` (read-only gate) and `pnpm catalog:sync` (rewrites only this package's `savvy.build.ts` plus one fixed-name changeset). CI syncs on every **PR** to `main` and to `changeset-release/main` (plus `workflow_dispatch`) — there is no push trigger — so opening the release PR is itself the trigger and no hand-run sync is needed before a release. Mechanics → `@../../.claude/design/effected/catalog-sync.md` — Load when: touching the sync scripts, the catalog literal, or the workflow.

**Builds must never write the catalog** — an earlier seam rewrote it from the build's freeze path, making every `build:dev` and CI build mutate the repo.

## The derived allowed-versions table

`savvy.build.ts` **declares** the table rather than containing it: a `peerDependencyRules.allowedVersionsFromCatalogs` block tells `rolldown-pnpm-config export` to derive one rule per v4 lock-catalog package — `"<satellite>@<its pin>>effect"` — into the root `pnpm-workspace.yaml`, retiring the `@effect/*` satellite-drift warning class. The rules are version-qualified so a genuine v3 unmet peer still warns, and the kit's own `@effected/*` artifacts are deliberately out of scope. Hand-edit the table and the next export overwrites it.

**There is no generator script and no checked-in table.** `allowed-versions.gen.ts` and its tripwire `__test__/allowed-versions.test.ts` are gone; do not restore either — regeneration is just `pnpm pnpm:export`, and there is nothing to drift. (`__test__/` does exist: it holds `catalog.test.ts`, which pins the `effected` catalog's membership.)

## Peer discipline this package exists to hold

Root `pnpm-workspace.yaml` sets exactly one resolver-relevant key: `autoInstallPeers: true`. There is no `dedupeDirectDeps` key, no `dedupePeerDependents` key and no `.npmrc` in this repo. Do not reintroduce any of them.

The v3/v4 peer-resolution defect is fixed in pnpm 11.12.0; there is no expected-residual set to ignore. **The root `CLAUDE.dependencies.md` is the authority on the live expected state — read it rather than trusting a count here.** Any peer warning outside the toolchain graph it describes is a genuine closure defect to fix upstream — do not silence it.

**The direct `effect` (`catalog:effect`) devDependency here is load-bearing — do not remove it as unused** (347ca229). It gives the resolver the right version to bind; without it pnpm bound `@effected/*` peers to the v3 `effect` that `rolldown-pnpm-config` carries, loading v4 code against v3 at build time. The companion itself ships no `effect`-importing code.

## Hazards

- **Always check the lockfile diff after an install** — a plain install once stripped turbo / biome / tsgo platform binaries from it.
- Never set `"private": false` — `publishConfig` (`directory: dist/dev/pkg`, `linkDirectory: true`) produces the publishable manifest at build time.
- Never write to `.repos/effect` (read-only vendored Effect source).
