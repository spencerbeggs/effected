# @effected/pnpm-plugin-effect

The kit's **companion** package: published and installable, but **not a library** — it exposes no API, so there is nothing to import and nothing to call. It has **no tier**. Companion is a *category, not a fourth tier*: the three tiers (pure / boundary / integrated) sit on one axis, dependency surface, and that axis is meaningless for a package nothing can depend on. See [effect-standards.md](../../.claude/design/effected/effect-standards.md#companion-packages-published-but-not-a-library).

It is not a library migration either — it has no tests and no source repo it was ported from. **Do not call it "repo infrastructure"**: that phrase names its relationship to this repo, reads as internal-only tooling, and twice produced documented errors claiming it does not publish or is exempt from the release. It is neither.

It **is a public package and it publishes to npm with the rest of the kit at `0.1.0`** — it sits on the release gate like every other package, not outside it. Nothing here has published yet, but that is true of all sixteen packages and says nothing special about this one. **Do not infer from `"private": true` that it will not publish**: every source manifest in this repo is `"private": true` and the bundler's `publishConfig` transform emits the publishable one at build time (see below).

For consumers it is **optional but real**: installing it holds their `effect` versions and peer floors at exactly the values this kit was built and tested against, rather than leaving them to resolve their own. That is the payoff once `app-kit` ships — an application wiring up the kit can adopt the same calculated versions in one step. It mattered most under Effect v3, where computing peer floors by hand was painful; under v4 it is a convenience rather than a necessity, but it is a shipped, supported one.

**For full design rationale:**
→ `@../../.claude/design/effected/packages/pnpm-plugin-effect.md`

Load when changing catalog strategy, advancing the Effect beta, or debugging workspace peer resolution.

## What it is

A pnpm **config dependency** (installed with `pnpm add --config`, not as a normal dependency), built with `rolldown-pnpm-config`. Source is two one-line re-exports over `rolldown-pnpm-config` virtual modules:

- `src/index.ts` → `catalogs`
- `src/pnpmfile.ts` → `hooks`

All real configuration lives in `savvy.build.ts`, where `PnpmConfigPlugin` declares each `effect` / `@effect/*` package with a `range` (pinned version), a `peer` (input to the floor computation), and usually `strategy: "interop"`. The build uses `bundleNodeModules: true` and `looseFiles` to emit `pnpmfile.mjs` / `pnpmfile.cjs`.

## What it publishes

Two catalogs, consumed by every `@effected/*` package:

- **`catalog:effect`** — pinned current Effect v4 beta. Used in `devDependencies` (and `peerDependencies` for `effect` itself).
- **`catalog:effectPeers`** — the same package set at a computed shared floor, the widest peer range libraries can safely advertise.

Currently `effect` pins `4.0.0-beta.94` — **exact, never a caret**. A caret on a prerelease floats across the beta line and desynchronizes the installed `effect` from the `repos/effect-smol` subtree that is meant to be the authority on what v4 exports. `@effect/tsgo` is the one asymmetric entry, and the only one carrying carets: `range ^0.18.1` in `effect`, `peer ^0.16.2` in `effectPeers`.

## Maintenance scripts (human-run only)

**Agents must not invoke these.** They mutate the lockfile and the root `pnpm-workspace.yaml`. Surface the right command to the user and let them run it.

Root scripts, each delegating to this package via `pnpm --filter '@effected/pnpm-plugin-effect' run …`:

- `pnpm pnpm:up` → `rolldown-pnpm-config upgrade savvy.build.ts` — pin each package to its latest v4 release and recompute the `effectPeers` floor. This is how the beta advances.
- `pnpm pnpm:preview` → `rolldown-pnpm-config preview` — print the generated catalogs without writing.
- `pnpm pnpm:export` → `rolldown-pnpm-config export` — write the catalogs into the root `pnpm-workspace.yaml` and surface drift between the plugin's definitions and what the workspace pins.

Advancing the beta is `pnpm pnpm:up` then `pnpm pnpm:export`.

## Peer discipline this package exists to hold

Root `pnpm-workspace.yaml` sets exactly one resolver-relevant key: `autoInstallPeers: true`. There is no `dedupeDirectDeps` key, no `dedupePeerDependents` key and no `.npmrc` in this repo — `dedupeDirectDeps: false` was dropped once pnpm 11.11.0 landed the upstream peer-resolution fix. Do not reintroduce either key.

- **`autoInstallPeers: true`** — lets root `devDependencies` collapse to a small set, with the rest auto-installed as peers.
- **Libraries declare `@effect/tsgo` (`catalog:effect`) as their typechecker devDependency, not `@typescript/native-preview` (`catalog:silk`).** What matters is the *declaration*, not the binary: `@effect/tsgo` ships `effect-tsgo`, while the `tsgo` each package's `types:check` script runs resolves from the root `.bin` (supplied by `@typescript/native-preview`). Declaring the v4-aligned package makes the typechecker's own `effect` peer ride the v4 catalog rather than the silk (v3-tooling) catalog, so under `autoInstallPeers: true` the auto-installed `effect` peers in the tooling chain no longer resolve the workspace-preferred v4 into v3-wanting importers. Upstream patch pnpm/pnpm#12847 **landed in pnpm 11.11.0**, so this declaration may no longer be load-bearing. It stays until someone verifies that removing it keeps `pnpm peers check` clean.
- **This package is the exception**: it depends on `@typescript/native-preview` at `catalog:silk`. It is infra riding the silk toolchain and sits deliberately outside the v4 split. Do not "fix" it to use `@effect/tsgo`.

## Expected vs. real warnings

`pnpm peers check` reports residual unmet `effect` peer warnings from transitive v3-wanting dependencies (e.g. `@effect/platform-node`, `@effect/sql-sqlite-node`). Those are **expected** under the interim setup — do not chase them.

A peer warning **outside that known set** is a genuine closure defect. Fix it upstream rather than silencing it.

## Hazards

- A plain `pnpm install` once stripped turbo / biome / tsgo platform binaries from the lockfile. **Always check the lockfile diff after an install.**
- Source `package.json` is `"private": true`. Never set it false — `publishConfig` (`directory: dist/dev/pkg`, `linkDirectory: true`) produces the publishable manifest at build time.
- Never write to `repos/effect-smol` (read-only vendored Effect source).
