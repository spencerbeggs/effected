# @effected/pnpm-plugin-effect

The kit's **companion** package: published and installable, but **not a library** — it exposes no API, so there is nothing to import and nothing to call. It has **no tier**. Companion is a *category, not a fourth tier*: the three tiers (pure / boundary / integrated) sit on one axis, dependency surface, and that axis is meaningless for a package nothing can depend on. See [effect-standards.md](../../.claude/design/effected/effect-standards.md#companion-packages-published-but-not-a-library).

It is not a library migration either — it has no tests and no source repo it was ported from. **Do not call it "repo infrastructure"**: that phrase names its relationship to this repo, reads as internal-only tooling, and twice produced documented errors claiming it does not publish or is exempt from the release. It is neither.

It **is a public package and it is published to npm** — `@effected/pnpm-plugin-effect` is at `0.4.0`, released alongside the rest of the kit, not outside it. **Do not infer from `"private": true` that it will not publish**: every source manifest in this repo is `"private": true` and the bundler's `publishConfig` transform emits the publishable one at build time (see below).

For consumers it is **optional but real**: installing it holds their `effect` versions and peer floors at exactly the values this kit was built and tested against, rather than leaving them to resolve their own. That is the payoff once `@effected/app` ships — an application wiring up the kit can adopt the same calculated versions in one step. It mattered most under Effect v3, where computing peer floors by hand was painful; under v4 it is a convenience rather than a necessity, but it is a shipped, supported one.

**For full design rationale:**
→ `@../../.claude/design/effected/packages/pnpm-plugin-effect.md`

Load when changing catalog strategy, advancing the Effect pin, or debugging workspace peer resolution.

## What it is

A pnpm **config dependency** (installed with `pnpm add --config`, not as a normal dependency), built with `rolldown-pnpm-config`. Source is two one-line re-exports over `rolldown-pnpm-config` virtual modules:

- `src/index.ts` → `catalogs`
- `src/pnpmfile.ts` → `hooks`

All real configuration lives in `savvy.build.ts`, where `PnpmConfigPlugin` declares each `effect` / `@effect/*` package with a `range` (pinned version), a `peer` (input to the floor computation), and a `strategy` — `lock` throughout, now that the v3 `interop` catalogs are retired. The build uses `bundleNodeModules: true` and `looseFiles` to emit `pnpmfile.mjs` / `pnpmfile.cjs`.

## What it publishes

Two catalogs, consumed by every `@effected/*` package:

- **`catalog:effect`** — pinned current Effect v4 prerelease, under the `lock` strategy. Used in `devDependencies` (and `peerDependencies` for `effect` itself).
- **`catalog:effect:peers`** — the same v4 package set as the advertised peer range. Under `lock` its `peer` inputs equal the pinned versions, so it holds the same exact pin, not a caret floor.

The Effect **v3** interop catalogs (`effect3` / `effect3:peers`, `interop` strategy) and the camelCase `effectPeers` alias are **removed** from the generator — retired on the rc.109 advance, ahead of the `1.0.0` sunset originally planned. Do not reintroduce them; the design doc records the retirement.

Currently `effect` pins `4.0.0-rc.109` — **exact, never a caret** (Effect's release line renamed beta → rc at rc.108). A caret on a prerelease floats across the release line and desynchronizes the installed `effect` from the `.repos/effect` submodule that is meant to be the authority on what v4 exports. `@effect/tsgo` sits at an exact `0.36.5` under the same `lock` strategy as the rest of the catalog. No workspace package consumes it anymore — d0599438 moved every package to `tsc --noEmit` with `typescript` (`catalog:build`, injected by the `@savvy-web/pnpm-plugin-silk` configDependency, not declared in `pnpm-workspace.yaml`) — but the catalog entry remains; do not reintroduce it as a typechecker devDependency.

## Maintenance scripts (human-run only)

**Agents must not invoke these.** They mutate the lockfile and the root `pnpm-workspace.yaml`. Surface the right command to the user and let them run it.

Root scripts, each delegating to this package via `pnpm --filter '@effected/pnpm-plugin-effect' run …`:

- `pnpm pnpm:up` → `rolldown-pnpm-config upgrade savvy.build.ts` — pin each package to its latest v4 release and recompute the `effect:peers` floor. This is how the pin advances.
- `pnpm pnpm:preview` → `rolldown-pnpm-config preview` — print the generated catalogs without writing.
- `pnpm pnpm:export` → `rolldown-pnpm-config export` — write the catalogs and the derived allowed-versions table (below) into the root `pnpm-workspace.yaml`, and surface drift between the plugin's definitions and what the workspace pins.

Advancing the pin is `pnpm pnpm:up` then `pnpm pnpm:export`.

## The derived allowed-versions table

`savvy.build.ts` **declares** the table rather than containing it: a
`peerDependencyRules.allowedVersionsFromCatalogs` block (`catalog: "effect"`,
`peer: "effect"`, `prefix: null`) tells `rolldown-pnpm-config export` to derive
one version-qualified rule per v4 lock-catalog package — `"<satellite>@<its
pin>>effect"`, valued at the effect pin — straight into the root
`pnpm-workspace.yaml`. That retires the recurring warning class where an
`@effect/*` satellite sits at a different release than the installed `effect`.

**There is no generator script and no checked-in table.** An earlier design had
`allowed-versions.gen.ts` writing literals between sentinel comments, guarded by
a drift tripwire at `__test__/allowed-versions.test.ts`; both files are gone,
replaced by the declarative block above — the package has no `__test__/`
directory at all. Do not restore either: regeneration is now just
`pnpm pnpm:export`, and there is nothing to drift.

The version qualifier keeps a same-named v3 satellite's genuine unmet peer
warning alive, and the kit's own `@effected/*` artifacts are deliberately not
covered — their post-advance stranding is repaired by the toolchain republish
cycle. Edit the generated table in `pnpm-workspace.yaml` by hand and the next
export overwrites it.

## Peer discipline this package exists to hold

Root `pnpm-workspace.yaml` sets exactly one resolver-relevant key: `autoInstallPeers: true`. There is no `dedupeDirectDeps` key, no `dedupePeerDependents` key and no `.npmrc` in this repo. Do not reintroduce any of them.

- **`autoInstallPeers: true`** — lets root `devDependencies` collapse to a small set, with the rest auto-installed as peers.

## Peer warnings

The v3/v4 peer-resolution defect is fixed in pnpm 11.12.0; there is no expected-residual set to ignore. The `@effect` satellite-drift class is retired structurally by the derived allowed-versions table above — **shipped, no longer the "proposed remedy"** earlier notes called it, though it binds only this checkout until `pnpm-plugin-effect` publishes and the toolchain adopts that release.

**The root `CLAUDE.dependencies.md` context file is the authority on the live expected state — read it rather than trusting a count here.** As of the rc.109 advance the toolchain graph (`rolldown-pnpm-config` — this package's own build tool — plus the `@savvy-web` and `@vitest-agent/*` packages) still pins beta.107, bridged onto rc.109 by a temporary spec-scoped `overrides` block in the root `pnpm-workspace.yaml` until it republishes against the rc.109 kit. The discipline it enforces is in [effect-standards.md](../../.claude/design/effected/effect-standards.md#peer-dependency-discipline) and the mechanism in [pnpm-plugin-effect.md](../../.claude/design/effected/packages/pnpm-plugin-effect.md). Do not silence it or treat it as license to tolerate a second: any peer warning outside that toolchain graph is a genuine closure defect to fix upstream.

**The direct `effect` (`catalog:effect`) devDependency here is load-bearing — do not remove it as unused** (347ca229). It gives the resolver the right version to bind: without it, pnpm bound bundler 2.0's `@effected/*` peers to the v3 `effect` that `rolldown-pnpm-config` carries, loading v4 code against v3 at build time. The companion still ships no `effect`-importing code.

## Hazards

- A plain `pnpm install` once stripped turbo / biome / tsgo platform binaries from the lockfile. **Always check the lockfile diff after an install.**
- Source `package.json` is `"private": true`. Never set it false — `publishConfig` (`directory: dist/dev/pkg`, `linkDirectory: true`) produces the publishable manifest at build time.
- Never write to `.repos/effect` (read-only vendored Effect source).
