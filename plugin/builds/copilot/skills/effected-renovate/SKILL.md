---
name: effected-renovate
description: "Use when the user runs /effected-renovate, or asks to move a repository onto a new @effected kit release or a new Effect version — bump the catalog plugin and the other config dependencies, regenerate the lockfile, get the build and tests green, then work through the release's upgrade ledger and align the remaining dependencies. Also use when: upgrade the effected kit, adopt a new @effected release, bump pnpm-plugin-effected, move to a new Effect patch or minor, silk-update-action stuck on a breaking kit release, regenerate the lockfile after a catalog bump, what changed in this effected release"
disable-model-invocation: true
argument-hint: "[--no-upgrade] [--stop-after <step>] [--base <git-ref>]"
---

# /effected-renovate

Move this repository onto the newest `@effected` kit release: `$ARGUMENTS`

The kit reaches a repository through its catalog plugin, a pnpm config dependency that carries every `@effected/*` version, the Effect family's versions and graph-wide Effect pins. Bumping that one dependency is most of the upgrade. Everything else is finding where the release changed something this repository uses, and the release's **upgrade ledger** says exactly that: one entry per breaking change, behaviour change, security fix, tooling change or new surface worth adopting, each with the search that finds it in your code.

Invoking `/effected-renovate` is consent to rewrite `pnpm-workspace.yaml`, drop the lockfile, reinstall and edit manifests and source in this repository. It is not consent to commit, push or open a pull request; stop and report instead. `--no-upgrade` skips step 7's direct-dependency bump, `--stop-after <n>` halts after step n, and `--base <ref>` names the pre-upgrade commit for step 4.

Run every command from the repository root.

## Before you start

- **Work on a branch.** On the default branch, create `chore/effected-renovate-<YYYY-MM-DD>` first. Leave any uncommitted changes alone: never stash or stage them.
- **Check for an update already in flight** with `gh pr list`. If an update bot opened a dependency pull request, say so; building on its branch may beat duplicating it.
- **The repository's own instructions win.** Read its `CLAUDE.md` for build, test and lint commands and their traps.
- **Read [traps.md](references/traps.md) once.** It holds the traps this process has hit in real repositories.

## Step 1: bump the config dependencies

```bash
node "<skill base directory>/scripts/bump-config-deps.mjs" pnpm-workspace.yaml --dry-run   # what moves
node "<skill base directory>/scripts/bump-config-deps.mjs" pnpm-workspace.yaml             # rewrite
```

It rewrites every `configDependencies` pin to the latest release as a plain version, drops a legacy `+sha512-…` integrity suffix, and applies the renames the ledger declares, such as a catalog plugin republished under a new name. Exit 2 means the repository has no config dependencies; skip to step 2. Report each `old -> new`. A `0.x` minor on the catalog plugin is where the release's breaking changes come from, so name it.

## Step 2: regenerate the lockfile and install

```bash
pnpm clean --lockfile --yes && pnpm install --ignore-scripts
```

Dropping the lockfile is load-bearing. Its first document pins each config dependency independently of `pnpm-workspace.yaml`, and its body pins every resolved version, so a bumped pin plus a plain `pnpm install` reports the lockfile up to date and keeps the old versions. A `clean` script in the root `package.json` overrides the built-in `pnpm clean`: check `jq -r '.scripts.clean // empty' package.json` first, and if it does not remove `pnpm-lock.yaml` and every `node_modules`, delete them directly.

Verify by resolution, not by reading manifests: `node -p "require('effect/package.json').version"` must print the catalog's Effect version.

## Step 3: confirm one `effect`

```bash
grep -nE "^  effect@[0-9]" pnpm-lock.yaml
```

Exactly one `effect` version must resolve. Two copies make every `Context.Service` tag two distinct tags, and the failure reads like an API change rather than a duplicate. A second copy usually comes from a build tool (a bundler, a test plugin, a linter) still published on an older Effect minor. Find which package pulls it with `pnpm why effect`, and check the ledger's tooling entries before you bridge anything by hand.

## Step 4: find what the release changed for you

```bash
node "<skill base directory>/scripts/applicable.mjs"            # --base <ref> if the pre-upgrade lockfile is not on the merge-base
```

It compares the lockfile on the merge-base with the default branch against the working tree's, and lists only the ledger entries whose threshold your upgrade crossed. Each entry comes with the files where its search matched, in priority order: security fixes, then breaking changes the compiler finds, then ones only tests find, then behaviour, tooling and adoptions. A repository several releases behind gets every round it crossed; the script fetches earlier rounds from the plugin's release tags with `gh` (`--offline` skips the fetch and names the tag instead).

Read each listed entry before you touch the code it names. An entry states a shape, not a signature: check it against the installed `.d.ts` under `node_modules/<pkg>/` before relying on it.

## Step 5: build

```bash
pnpm build
```

Work the typed entries first; the compiler confirms them. Then check each package's `dist/prod/issues.json` when the repository builds with `effected package build`: read `buildOk` first, because a crashed build's empty buckets look like a clean one, then treat every `errors` entry and every `warnings` entry marked `ciFatal: true` as a failure. API Extractor findings are warnings locally and errors in CI.

## Step 6: test

```bash
pnpm test
```

Then the behavioural entries: a test that fails here is often one of them, and an entry with hits and no failing test is a gap in the suite, worth a test.

## Fixing breakage (steps 5 and 6)

Loop: read the first error, fix it, re-run only what it affects, repeat.

- **Verify every changed API against the installed source**, never memory: the package's `.d.ts`, its `CHANGELOG.md`, and any vendored reference tree the repository keeps. Kit releases ship as `0.x` minors, so "minor" does not mean compatible.
- **Fix the call site** to match the new API. Never pin a dependency back, add `@ts-ignore` or `as any`, skip or delete a test, or loosen lint or `tsconfig` to get green; if a fix seems to need one, stop and ask.
- **A failure that also fails on the default branch is not the upgrade's.** Say so and move on.

## Step 7: align the rest

```bash
node "<skill base directory>/scripts/outdated-direct.mjs"
```

It lists outdated dependencies pinned directly in a manifest, not through `catalog:` or `workspace:` (those already moved with step 1). Upgrade routine ones by editing the range and keeping its operator, then install once. Leave a deliberately held pin alone: check the repository's instructions and the line's history before bumping across a major, and ask when unsure.

Then the ledger's `adopt` entries: each names a hand-rolled pattern the kit or Effect now covers. Offer them; do not apply them unasked. When the repository uses `@savvy-web/silk`, run `pnpm savvy init --yes` after the last install and keep what it rewrites.

## Step 8: changesets

When the repository versions with changesets: `pnpm savvy changeset deps regen` (or the repository's equivalent) once build and tests are green, so the dependency changesets describe the final manifests. Then one prose changeset for each published package whose own code changed, sized by what its consumers see: a call-site port that keeps the package's API is a patch.

## Finish

Report concisely:

- Config dependencies bumped and renamed, direct dependencies upgraded, and pins left alone with why.
- The ledger entries that applied, and for each what you changed, or why nothing needed to.
- Build and test results with the real counts, and every code change made to fix breakage (file and one line of why).
- Anything still failing, with its first error.
- Adoptions offered and not applied.

Then offer the next step, a commit and a pull request, rather than taking it.

## Additional resources

- [traps.md](references/traps.md): traps this process hit in real repositories. Load when: starting a run, or when a step behaves differently from what it describes.
- [ledger/](references/ledger/BASELINE.md): the release's upgrade entries, one file each; `applicable.mjs` selects them. Load when: `applicable.mjs` lists an entry, or it cannot run.
