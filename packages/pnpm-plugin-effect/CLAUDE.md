# @effected/pnpm-plugin-effect

The kit's **companion** package: published and installable, but **not a library** — it exposes no API, so there is nothing to import and nothing to call. It has **no tier**. Companion is a *category, not a fourth tier*: the three tiers (pure / boundary / integrated) sit on one axis, dependency surface, and that axis is meaningless for a package nothing can depend on. See [effect-standards.md](../../.claude/design/effected/effect-standards.md#companion-packages-published-but-not-a-library).

It is not a library migration either — it has no tests and no source repo it was ported from. **Do not call it "repo infrastructure"**: that phrase names its relationship to this repo, reads as internal-only tooling, and twice produced documented errors claiming it does not publish or is exempt from the release. It is neither.

It **is a public package and it publishes to npm with the rest of the kit at `0.1.0`** — it sits on the release gate like every other package, not outside it. Nothing here has published yet, but that is true of every package in the workspace and says nothing special about this one. **Do not infer from `"private": true` that it will not publish**: every source manifest in this repo is `"private": true` and the bundler's `publishConfig` transform emits the publishable one at build time (see below).

For consumers it is **optional but real**: installing it holds their `effect` versions and peer floors at exactly the values this kit was built and tested against, rather than leaving them to resolve their own. That is the payoff once `@effected/app` ships — an application wiring up the kit can adopt the same calculated versions in one step. It mattered most under Effect v3, where computing peer floors by hand was painful; under v4 it is a convenience rather than a necessity, but it is a shipped, supported one.

**For full design rationale:**
→ `@../../.claude/design/effected/packages/pnpm-plugin-effect.md`

Load when changing catalog strategy, advancing the Effect beta, or debugging workspace peer resolution.

## What it is

A pnpm **config dependency** (installed with `pnpm add --config`, not as a normal dependency), built with `rolldown-pnpm-config`. Source is two one-line re-exports over `rolldown-pnpm-config` virtual modules:

- `src/index.ts` → `catalogs`
- `src/pnpmfile.ts` → `hooks`

All real configuration lives in `savvy.build.ts`, where `PnpmConfigPlugin` declares each `effect` / `@effect/*` package with a `range` (pinned version), a `peer` (input to the floor computation), and a `strategy` — `lock` for the v4 `effect` catalog, `interop` for the v3 `effect3` catalog. The build uses `bundleNodeModules: true` and `looseFiles` to emit `pnpmfile.mjs` / `pnpmfile.cjs`.

## What it publishes

Four catalogs, consumed by every `@effected/*` package:

- **`catalog:effect`** — pinned current Effect v4 beta, under the `lock` strategy. Used in `devDependencies` (and `peerDependencies` for `effect` itself).
- **`catalog:effectPeers`** — the same v4 package set as the advertised peer range. Under `lock` its `peer` inputs equal the pinned versions, so it holds the same exact beta, not a caret floor.
- **`catalog:effect3` / `catalog:effect3Peers`** — the latest Effect **v3** releases, under the `interop` strategy (caret-ranged, downlevelled to the widest safe floor), for testing a package against both v3 and v4 in one workspace. Transitional: removed at this plugin's `1.0.0` once Effect `4.0.0` ships.

Currently `effect` pins `4.0.0-beta.98` — **exact, never a caret**. A caret on a prerelease floats across the beta line and desynchronizes the installed `effect` from the `.repos/effect-smol` submodule that is meant to be the authority on what v4 exports. `@effect/tsgo` is the one asymmetric entry in the v4 catalog, caret on both sides: `range ^0.19.0` in `effect`, `peer ^0.16.2` in `effectPeers`. No workspace package consumes it anymore — d0599438 moved every package to `tsc --noEmit` with `typescript` (`catalog:silk`) — but the catalog entries remain; do not reintroduce it as a typechecker devDependency.

## Maintenance scripts (human-run only)

**Agents must not invoke these.** They mutate the lockfile and the root `pnpm-workspace.yaml`. Surface the right command to the user and let them run it.

Root scripts, each delegating to this package via `pnpm --filter '@effected/pnpm-plugin-effect' run …`:

- `pnpm pnpm:up` → `rolldown-pnpm-config upgrade savvy.build.ts` — pin each package to its latest v4 release and recompute the `effectPeers` floor. This is how the beta advances.
- `pnpm pnpm:preview` → `rolldown-pnpm-config preview` — print the generated catalogs without writing.
- `pnpm pnpm:export` → `rolldown-pnpm-config export` — write the catalogs into the root `pnpm-workspace.yaml` and surface drift between the plugin's definitions and what the workspace pins.

Advancing the beta is `pnpm pnpm:up` then `pnpm pnpm:export`.

## Peer discipline this package exists to hold

Root `pnpm-workspace.yaml` sets exactly one resolver-relevant key: `autoInstallPeers: true`. There is no `dedupeDirectDeps` key, no `dedupePeerDependents` key and no `.npmrc` in this repo. Do not reintroduce any of them.

- **`autoInstallPeers: true`** — lets root `devDependencies` collapse to a small set, with the rest auto-installed as peers.

## Peer warnings

The v3/v4 peer-resolution defect is fixed in pnpm 11.12.0; there is no expected-residual set to ignore. `pnpm peers check` currently reports **exactly one issue, and it lives in this package's context**: `rolldown-pnpm-config`'s Effect **v3** satellites (`@effect/platform`, `@effect/rpc`, `@effect/sql`, `@effect/cluster`) want `effect@^3.21.x` and get the v4 beta — a consequence of the bundler 2.0 upgrade; the candidate fix is upstream in the external rolldown-pnpm-config repo. Recorded as the open defect in [effect-standards.md](../../.claude/design/effected/effect-standards.md#open-defect-one-peers-check-issue) — do not silence it or treat it as license to tolerate a second: any other peer warning is a genuine closure defect to fix upstream.

**The direct `effect` (`catalog:effect`) devDependency here is load-bearing — do not remove it as unused** (347ca229). It gives the resolver the right version to bind: without it, pnpm bound bundler 2.0's `@effected/*` peers to the v3 `effect` that `rolldown-pnpm-config` carries, loading v4 code against v3 at build time. The companion still ships no `effect`-importing code.

## Hazards

- A plain `pnpm install` once stripped turbo / biome / tsgo platform binaries from the lockfile. **Always check the lockfile diff after an install.**
- Source `package.json` is `"private": true`. Never set it false — `publishConfig` (`directory: dist/dev/pkg`, `linkDirectory: true`) produces the publishable manifest at build time.
- Never write to `.repos/effect-smol` (read-only vendored Effect source).
