---
name: upgrade
description: "Use when the user runs /effected:upgrade, or asks to move a repository onto a new @effected kit release or a new Effect version, even if they only say \"upgrade effected\" or \"renovate the kit\". Runs unattended end to end and adopts what the release offers. Also use when: upgrade the effected kit, adopt a new @effected release, bump pnpm-plugin-effected, move to a new Effect patch or minor, repin the vendored Effect submodule after an upgrade, silk-update-action stuck on a breaking kit release, regenerate the lockfile after a catalog bump, what changed in this effected release"
disable-model-invocation: true
argument-hint: "[--no-upgrade] [--stop-after <step>] [--base <git-ref>]"
---

# /effected:upgrade

Move this repository onto the newest `@effected` kit release and adopt what it offers: `$ARGUMENTS`

The kit reaches a repository through its catalog plugin, a pnpm config dependency that carries every `@effected/*` version, the Effect family's versions and graph-wide Effect pins. Bumping that one dependency is most of the upgrade. Everything else is finding where the release changed something this repository uses, and the release's **upgrade ledger** says exactly that: one entry per breaking change, behaviour change, security fix, tooling change or new surface worth adopting, each with the search that finds it in your code.

## This run is unattended

**Invoking this skill is consent to every repository-local step below.** That covers rewriting `pnpm-workspace.yaml` and other config, dropping the lockfile, reinstalling, repinning a vendored Effect submodule, editing manifests and source, applying every applicable ledger entry including `adopt` entries, bumping direct dependencies within their major, and writing changesets. Do not ask before any of them: do them, and report what you did at the end. Past runs stopped to ask "shall I apply the adopt entries?" or "OK to bump this?". Those questions are already answered: yes.

It is not consent to commit, push or open a pull request. Finish, report, and offer those.

**Hold back an adoption or a fix only for a serious issue**, which is one of these:

1. It would change the public API or the observable behaviour of a package this repository publishes.
2. It conflicts with an explicit instruction in this repository's `CLAUDE.md`, or with a pin the repository documents as deliberate.
3. It cannot be made green (build and tests) without one of the moves "Fixing breakage" forbids.
4. It needs a design decision that has more than one reasonable answer.

Anything else is not serious: an adoption that touches many files, a refactor you would not have chosen, an entry whose benefit seems small. Do those. A held-back item goes in the final report with its reason and the one question the user must answer. Do not stop the run for it: skip that one item, finish every other step, and report it at the end.

`--no-upgrade` skips step 8's direct-dependency bump, `--stop-after <n>` halts after step n, and `--base <ref>` names the pre-upgrade commit for step 5.

Run every command from the repository root.

## Before you start

- **Work on a branch.** On the default branch, create `chore/effected-upgrade-<YYYY-MM-DD>` first. Leave any uncommitted changes alone: never stash or stage them.
- **Check for an update already in flight** with `gh pr list`. If an update bot opened a dependency pull request, build on its branch rather than duplicating it, and say so in the report.
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
NODE_OPTIONS= pnpm clean --lockfile --yes && NODE_OPTIONS= pnpm install --ignore-scripts
```

The empty `NODE_OPTIONS` is load-bearing too. A session started through a `pnpm run` script (a repository's `claude` script, say) inherits the workspace's `nodeOptions` as `NODE_OPTIONS`. With `--import=tsx` in it, an install with no `node_modules` dies before tsx is installed.

Dropping the lockfile is load-bearing. Its first document pins each config dependency independently of `pnpm-workspace.yaml`, and its body pins every resolved version, so a bumped pin plus a plain `pnpm install` reports the lockfile up to date and keeps the old versions. A `clean` script in the root `package.json` overrides the built-in `pnpm clean`: check `jq -r '.scripts.clean // empty' package.json` first, and if it does not remove `pnpm-lock.yaml` and every `node_modules`, delete them directly.

Verify by resolution, not by reading manifests:

```bash
pnpm why effect --depth 0
```

It must print the catalog's Effect version as an `effect@<version>` heading, with what depends on it beneath. It reads the installed graph of every workspace project, so it works from the root whichever package declares `effect`. `node -p "require('effect/package.json').version"` resolves from the current directory instead: it works only from a package that declares `effect`, and from a root that does not, it fails with `Cannot find module` after a good install.

## Step 3: confirm one `effect`

```bash
grep -nE "^  effect@[0-9]" pnpm-lock.yaml
```

Exactly one `effect` version must resolve. Two copies make every `Context.Service` tag two distinct tags, and the failure reads like an API change rather than a duplicate. A second copy usually comes from a build tool (a bundler, a test plugin, a linter) still published on an older Effect minor. Find which package pulls it with `pnpm why effect`, and check the ledger's tooling entries before you bridge anything by hand.

**Two versions of a kit package can be correct.** A tool installed here (a test plugin, a linter, a bundler) that was released on the previous kit release keeps its own copies of the kit packages it pinned. That is the tool owning its closure, and it is harmless: the tool shares no service, schema or brand with this repository. Do not override it onto the new versions.

It breaks only when a kit package resolved inside the tool takes a **peer** from the other release line. The tell is `does not provide an export named …` when the tool loads (a test run that cannot start, a CLI that dies at import). That happens when the tool publishes caret ranges on the kit, so a newer patch of one kit library lands beside an older peer. Bridge it at the stale parent edge only, never with a global pin:

1. List the split packages, the edges that pull each stale copy, and the override lines:

   ```bash
   node "<skill base directory>/scripts/stale-edges.mjs"          # --json for the same report as data
   ```

   It reads `pnpm-lock.yaml` (or a path you pass) and exits 0 when no kit package resolves at two versions, 2 when one does. The newest copy of each package is the target; every lower one is stale.
2. Read the edges. A **tool** parent gets an override line. A parent that is itself an `@effected/*` package gets none. When the stale child is its peer, it resolved inside the tool and the tool's line covers it. When it is a regular dependency, no printed line does: read the parent's manifest, and add a `"<parent>><child>"` override yourself if the split breaks it. An importer edge is this repository's own range on the old release; raise the range instead of overriding it.
3. Paste the override lines the tool edges need into `pnpm-workspace.yaml`'s `overrides`, leaving out any tool whose second copy is harmless.
4. Drop the lockfile and reinstall, as in step 2. Changing `overrides` in place can report the lockfile up to date.
5. Check that no kit package now resolves at two versions where it broke, and run each bridged tool once (its CLI, its test run). Forcing a newer kit release onto a tool can hit that release's breaking changes.
6. Comment the block as temporary, naming the tools, and delete each tool's lines once it releases on the new kit.

A tool that pins the kit exactly never needs this; when the tool is one this repository publishes, step 8 fixes it.

## Step 4: repin the vendored Effect source

**Run this step every time the repository vendors Effect, on every upgrade, a patch included.** Repositories on the kit commonly keep Effect's source as a git submodule, typically at `.repos/effect`, so agents can read what Effect really exports. When the installed `effect` moves and the submodule does not, the two drift apart silently: every source lookup then answers for a version this repository no longer runs, with nothing to say so.

Find the submodule. It is any entry in `.gitmodules` whose `url` is `Effect-TS/effect` or `Effect-TS/effect-smol`:

```bash
git config -f .gitmodules --get-regexp '^submodule\..*\.url$' | grep -E 'Effect-TS/effect(-smol)?(\.git)?$'
```

When the repository uses `@savvy-web/silk`, `.repos/config.json` also lists it: the entry whose `url` is the Effect repository, with its pin in `ref`. No match in either file means there is nothing to repin; go to step 5.

The target is the tag of the version step 2 resolved: `effect@<version>`, as in `effect@4.1.6`. Repin to it:

- **With silk's tooling present**, use it: it updates `.repos/config.json`'s `ref`, keeps the sparse checkout and stages the change. Pass the entry's key in `.repos/config.json` (usually `effect`):

  ```bash
  pnpm savvy repos pin effect effect@<version>
  ```

  The `repos_manage` MCP tool with action `pin` does the same. Do not write under `.repos/` by any other route in a silk repository; its guards deny it.
- **Otherwise, plain git.** A fetch and a checkout keep a sparse checkout's patterns, so do not re-run `sparse-checkout set`:

  ```bash
  git -C <path> fetch --depth 1 origin tag effect@<version> --no-tags
  git -C <path> checkout --detach effect@<version>
  git add <path>
  ```

  If the submodule is not initialized, run `git submodule update --init --depth 1 <path>` first.

Then verify. The first command must print `effect@<version>`, and the second the same commit with no leading `+` or `-`:

```bash
git -C <path> describe --tags --exact-match HEAD
git submodule status <path>
```

If the repository keeps anything else naming the old pin, such as an `EFFECT_PIN` constant or a line in its own docs, update it too. `git grep -n 'effect@<old version>' -- ':!pnpm-lock.yaml' ':!**/CHANGELOG.md'` finds them; the old version is the tag the submodule pointed at before this step.

## Step 5: find what the release changed for you

```bash
node "<skill base directory>/scripts/applicable.mjs"            # --base <ref> if the pre-upgrade lockfile is not on the merge-base
```

It compares the lockfile on the merge-base with the default branch against the working tree's, and lists only the ledger entries whose threshold your upgrade crossed. Each entry comes with the files where its search matched, in priority order: security fixes, then breaking changes the compiler finds, then ones only tests find, then behaviour, tooling and adoptions. A repository several releases behind gets every round it crossed; the script fetches earlier rounds from the plugin's release tags with `gh` (`--offline` skips the fetch and names the tag instead).

Read each listed entry before you touch the code it names. An entry states a shape, not a signature: check it against the installed `.d.ts` under `node_modules/<pkg>/` before relying on it. Every listed entry is work for this run, `adopt` entries included; step 8 applies those.

## Step 6: build

```bash
pnpm build
```

Work the typed entries first; the compiler confirms them. Then check each package's `dist/prod/issues.json` when the repository builds with `effected package build`: read `buildOk` first, because a crashed build's empty buckets look like a clean one, then treat every `errors` entry and every `warnings` entry marked `ciFatal: true` as a failure. API Extractor findings are warnings locally and errors in CI.

## Step 7: test

```bash
pnpm test
```

Then the behavioural entries: a test that fails here is often one of them, and an entry with hits and no failing test is a gap in the suite. Write the test.

## Fixing breakage (steps 6 and 7)

Loop: read the first error, fix it, re-run only what it affects, repeat.

- **Verify every changed API against the installed source**, never memory: the package's `.d.ts`, its `CHANGELOG.md`, and the vendored source step 4 repinned. Kit releases ship as `0.x` minors, so "minor" does not mean compatible.
- **Fix the call site** to match the new API. Never pin a dependency back, add `@ts-ignore` or `as any`, skip or delete a test, or loosen lint or `tsconfig` to get green. If a fix seems to need one of those, stop work on that failure only: leave it unfixed, finish every other step, and put the failure and the move it seems to need in the final report. This and the serious-issue rule above are the only reasons to stop.
- **A failure that also fails on the default branch is not the upgrade's.** Say so in the report and move on.

## Step 8: align the rest and adopt

```bash
node "<skill base directory>/scripts/outdated-direct.mjs"
```

It lists outdated dependencies pinned directly in a manifest, not through `catalog:` or `workspace:` (those already moved with step 1). Bump every one within its major by editing the range and keeping its operator, then install once. Bump across a major too, unless the repository's instructions or the line's history (`git log -p -S'<name>' -- '**/package.json'`) show a deliberate hold, or the bump does not stay green. Do not ask about it mid-run: a held major goes in the report with what held it.

**Apply every `adopt` entry step 5 listed**, and every other place where a kit capability replaces a pattern this repository rolled by hand. Each entry names the pattern and what replaces it. Do not offer them and wait: make the change, build and test it, and move on. Hold one back only under the serious-issue rule.

When this repository publishes a tool built on the kit (a package with a `bin`, a CLI or MCP server, a bundler or test plugin), check how its packages take the kit. A tool package that writes `catalog:effected` or a caret on an `@effected/*` dependency floats kit patches under its own version, and is the cause of the step-3 bridge in every repository that installs it. Pin those dependencies exactly; the `design-patterns` skill's carrier-closure reference has the rule, what it seals and the test that holds it. Libraries keep their carets and peers. When the repository uses `@savvy-web/silk`, run `pnpm savvy init --yes` after the last install and keep what it rewrites.

## Step 9: changesets

When the repository versions with changesets: `pnpm savvy changeset deps regen` (or the repository's equivalent) once build and tests are green, so the dependency changesets describe the final manifests. Then one prose changeset for each published package whose own code changed, sized by what its consumers see: a call-site port that keeps the package's API is a patch.

## Finish

Report concisely:

- Config dependencies bumped and renamed, direct dependencies upgraded, and majors held with what held each.
- The vendored Effect submodule's old and new tag and the verify output, or that the repository vendors none.
- The ledger entries that applied, and for each what you changed, or why nothing needed to.
- The adoptions applied, and each one held back with its serious-issue reason and the one question for the user.
- Build and test results with the real counts, and every code change made to fix breakage (file and one line of why).
- Anything still failing, with its first error and, where a forbidden move seemed needed, which one.

Then offer the next step, a commit and a pull request, rather than taking it.

## Additional resources

- [traps.md](references/traps.md): traps this process hit in real repositories. Load when: starting a run, or when a step behaves differently from what it describes.
- [ledger/](references/ledger/BASELINE.md): the release's upgrade entries, one file each; `applicable.mjs` selects them. Load when: `applicable.mjs` lists an entry, or it cannot run.
