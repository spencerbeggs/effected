---
name: effect-upgrade
description: Use when advancing the kit to a new Effect 4.x release — the user runs /effect-upgrade <version>, or asks to move effected onto a newer effect, repin .repos/effect, or adopt a new Effect patch or minor across the kit. Also /effect-upgrade --record (write upgrade-ledger entries for a branch's kit changes) and /effect-upgrade --reset (close a ledger round).
argument-hint: "<effect-version, e.g. 4.0.5> | --record | --reset"
---

# Effect upgrade

`$ARGUMENTS` picks the mode:

- **A version** (`/effect-upgrade 4.1.2`): advance the kit to that Effect release. Read `okf/runbooks/advance-the-effect-pin.md` first; it is the authority on the pin mechanics, and this skill is the end-to-end session around it. Work through the [phases](#phases) in order and do not skip a gate.
- **`--record`**: write the upgrade-ledger entries for the kit changes on this branch, with no Effect advance. Run it at the end of any branch that ships a breaking, behavioural or security change, alongside the changeset pass. See [Record mode](#record-mode).
- **`--reset`**: close the current ledger round. Only when the user asks for it. See [Reset mode](#reset-mode).

## Ground rules

- **The user runs the catalog commands, not you.** That means `pnpm pnpm:up`, `pnpm pnpm:export` and the install, and also any `okfit verify`.
- **Never use raw git on `.repos/`.** Use `repos_manage` (pin, note). A guard blocks `git reset` there.
- **You cannot edit `.husky/*`.** If a hook breaks, show the user the exact fix and stop.
- **Never use `git checkout`, `git restore` or `git stash`** to clean up surprise changes. Another process may own them (a concurrent `pnpm:export` rewrote `pnpm-workspace.yaml` mid-session once). Ask the user.
- **A probe settles semantics, not reasoning.** Install the old and new `effect` side by side in the scratchpad (`npm i effect@<v>` in one directory per version) and run both before writing any claim about behaviour.
- **Keep the ledger as you go.** Every phase that learns something a downstream project needs writes it to the ledger in the same step. Do not reconstruct it from the diff at the end.

## The upgrade ledger

Downstream repositories upgrade with the plugin's `/effected-renovate` skill. Its ledger, `plugin/skills/effected-renovate/references/ledger/`, is how this repository tells them what a release changed: one file per change, which `scripts/applicable.mjs` selects by the versions a consumer's upgrade crosses and searches for in their code. The entry format and its rules are in `okf/models/renovate-ledger-entry.md`; read it before writing one. `node plugin/skills/effected-renovate/scripts/applicable.mjs --check` validates every entry.

- **One entry per change a consumer must find or act on**: a break, a behaviour change, a security fix, a tooling change (a renamed config dependency, a new catalog shape), or a new surface worth adopting. Process the skill already covers (install, build, test, align) is never an entry.
- **`applies` names the first published version carrying the change**, for every kit package that carries it; key an Effect-side change on `effect`. Take the version from the release plan (`pnpm changeset status --verbose`), never a guess. A package a consumer only reaches transitively is not worth naming.
- **`detect` finds the old shape in a consumer's code.** Prove each pattern with `git grep -nIE` against a real call site (a test fixture, a sibling consumer checkout read-only, or the pre-change kit source) and against this repository, so it neither misses nor matches everything.
- **`kind` and `shows`**: say whether the compiler finds the break (`typed`) or only tests do (`behavioural`), so the consumer knows which gate catches it.
- **The body addresses the downstream agent in the imperative**, names shapes rather than signatures, and tells the reader to check against the installed `.d.ts`.
- **A stated behaviour is probed on both versions** (the old and new `effect`, or the old and new kit package). What you could not probe goes in as "check", not as fact.
- **Entries name versions and tracking issues.** That is their job; the ledger is the one plugin text exempt from the no-versions rule (`okf/conventions/consumer-text-states-current-effect-behaviour.md`). Every other skill file stays version-free.
- **Write no claim the branch doesn't back.** Every kit entry traces to a changeset or a commit, every Effect entry to the changelog, the source diff or a probe; list the changeset names in `changesets`, which the gate in `plugin/__test__/effected-renovate.bats` checks for every pending breaking changeset.
- **A trap the upgrade process itself hit downstream** goes below the marker line in `references/traps.md`, as a `Looks like | Actually` row.
- **Rebuild the plugin** (`pnpm build --filter @effected/ai-plugins`) and run `bats plugin/__test__/effected-renovate.bats`; the entries ship in the plugin's next release, which needs an `@effected/ai-plugins` changeset.

## Phases

1. **Preflight**
   - Run `npm view effect@$ARGUMENTS version` from the scratchpad, not the repo, because devEngines breaks `npm view` inside it. Core itself must resolve, not only its satellites.
   - Create the branch `feat/effect-$ARGUMENTS`.
   - Record the previous `effect` version: it becomes the lower edge of every Effect entry's threshold.
   - List the other kit work this release will carry: `ls .changeset/` and `git log <last release commit>..HEAD`. Each pending changeset that a consumer must act on becomes a ledger entry in phase 5.
2. **Catalog (user)**
   - Check whether `packages/pnpm-plugin-effected/savvy.build.ts` already names `$ARGUMENTS`. If not, ask the user to run `pnpm pnpm:up`, then `pnpm pnpm:export`, then install, and to add the changesets (catalog sync plus their bump policy for the packages).
   - When they're done, confirm the lockfile resolves `effect@$ARGUMENTS`, and compare the platform-binary lines against `HEAD:pnpm-lock.yaml`:
     `grep -cE "^  '?@?(turbo|biomejs/cli|typescript/native-preview)[^:]*(darwin|linux|win32)"`
     The counts must match.
   - **Ledger:** a `tooling` entry for any new package, renamed config dependency, or dependency or peer edge a consumer must act on (`git diff HEAD -- 'packages/*/package.json'`).
3. **Repin**
   - Run `repos_manage` with `action:"pin"`, `name:"effect"`, `ref:"effect@$ARGUMENTS"`. It stages `.repos/`, which fixes the commit order in phase 9.
   - Set `EFFECT_PIN` in `plugin/hooks/session-start/orientation.sh`.
4. **Changelog → adoptions and dropped workarounds**
   - Read the `## $ARGUMENTS` section of `https://raw.githubusercontent.com/Effect-TS/effect/main/packages/effect/CHANGELOG.md`.
   - Read `git -C .repos/effect diff --stat <old> <new> -- packages/effect/src` for changes the changelog doesn't mention.
   - Grep `packages/*/src` and `__test__` for every API the release touches, and for `Effect-TS/effect#`. Check each cited issue with `gh issue view`; a workaround is dropped only when its issue is closed and a probe confirms the fix.
   - New APIs that would be new kit capabilities go to the user as proposals, not edits.
   - Check the kit's `@stability unstable` imports (runbook step 6).
   - Tripwire tests (`grep -rl tripwire packages/*/__test__`) fail when upstream fixes something we work around. That failure is the signal to delete the workaround, not to patch the test.
   - **Ledger:** an entry keyed on `effect` for each changelog item that could change a downstream project's types, output or behaviour, with its search term as `detect`; an `adopt` entry for each new Effect API that replaces a hand-rolled pattern; an entry keyed on the kit package for each kit change the advance forces (a dropped workaround, a changed default, a re-exported shape).
5. **Kit changes → ledger**
   - For every pending changeset from phase 1, and every one the branch adds, read the changeset and its diff, and write its entry: `breaking`, `security`, `behaviour` or `adopt`, with any closed issue (`Closes #N` in the commits, or `gh issue view`) in `closes`.
   - Probe any behaviour change on the old and new package before you state it.
6. **Build and test**
   - Run `pnpm build`, the workspace tests, and `pnpm catalog:check`.
   - A turbo cache hit replays old output, so check `dist/*/issues.json` `generatedAt`.
   - **Ledger:** every kit break the build or tests surface gets an entry, with `shows` saying what a downstream project sees (a type error or a test failure).
7. **Plugin**
   - Run `node plugin/scripts/rederive-anchors.mjs`. It relocates every manifest anchor by its symbol and prints each `MOVED` line with the text it landed on; read those. It refuses with `MISSING` (the symbol is gone: re-read the source and rewrite the citation and its manifest entry), `AMBIGUOUS` (add an `after` naming the nearest enclosing member line) or `COLLISION`, and then writes nothing. Once the dry run refuses nothing, run it again with `--write`.
   - Then `node plugin/__test__/helpers/skill-anchors.mjs` must report 0 failures. It covers every skill file, so a citation the manifest lacks, a token cited more times than its entry's `occurrences`, a bare `:NNN` with no file, or a prose citation beside a named file (`` `src/Logger.ts` ``: `consoleJson` at 992) fails there. The prose lint sees only "at", "line" or "lines" plus three or more digits next to a file in a code span; any other way of writing a line number goes unchecked, so write every line citation as a `File.ts:N` token.
   - For each changelog item, grep `plugin/skills` and `plugin/agents`. Re-probe any skill example whose output a changed module produces; JSON Schema output (`effect-v4-schema/references/11-generation-and-tooling.md`) drifts most.
   - Add new modules or namespaces to `effect-v4-module-index`.
   - Skill text states current behaviour only: no version numbers and no "since" history.
   - Then `pnpm build --filter @effected/ai-plugins` and `pnpm test:bats`.
8. **OKF**
   - Grep `okf/` for the old version string and for "today". Body text describing the catalog goes stale on every patch, so reword it to name no patch version.
   - Run `okfit sync --yes` and `okfit validate` (0 errors).
   - Add a `repos_manage` note recording the advance: kit breaks, workarounds kept or dropped and why, and anything that looked like a bug but isn't.
9. **Commit** (load `silk:commit-create`, and commit only through its `commit.sh`):
   - **(a) repin:** lockfile, catalogs, `.repos/`, `EFFECT_PIN` and changesets, in one commit, as the runbook requires.
   - **(b) code:** kit adoptions or dropped workarounds, if any.
   - **(c) plugin:** skills, anchors, ledger entries and `builds/`.
   - **(d) OKF.**
   - Before (c), check every entry's `applies` against the release plan (`changeset_preview`, or `pnpm changeset status --verbose`): each threshold is the version that package will publish. `applicable.mjs --check` and the bats gate must pass.
   - Never commit `plugin/builds/` without its source.
10. **PR** (load `silk:pr-body`): push and open the PR.
    - In the summary, say what was verified and how, which workarounds were kept and why, and what you ruled out.
    - List the ledger entries the branch adds.
    - Validate the squash fence with `validate-message.sh`.
11. **Review loop**
    - Read the reviews: `gh pr view <n> --json reviews` plus `gh api repos/{owner}/{repo}/pulls/<n>/comments`.
    - Verify each finding against source before fixing it, fix the valid ones in one commit, and tell the user which you skipped and why.
    - If a fix changes a shape or a behaviour an entry states, update the entry in the same commit.
    - If the effected catalog in `pnpm-workspace.yaml` lags `savvy.build.ts`, ask the user to re-run `pnpm pnpm:export`.

## Record mode

For a branch that ships kit changes without an Effect advance.

1. List the pending changesets (`ls .changeset/`) and read each with its diff. Skip the ones a consumer never has to act on: dependency-only, test-only, documentation-only, or an internal refactor that keeps every published shape.
2. For each that remains, write its entry by the rules in [The upgrade ledger](#the-upgrade-ledger). Update an existing entry instead when the branch extends a change the ledger already records.
3. Ask the user about any change you cannot classify, rather than guessing a `kind`.
4. Run `node plugin/skills/effected-renovate/scripts/applicable.mjs --check`, rebuild the plugin, and run `bats plugin/__test__/effected-renovate.bats`.
5. Make sure an `@effected/ai-plugins` changeset covers the new entries, and leave the commit to the user's normal flow.

## Reset mode

Closes the current round so the ledger starts empty from the release that is now out. The user decides when; never reset on your own initiative. A reset loses nothing: the closed round stays readable at its plugin release tag, and `applicable.mjs` fetches it for any consumer that predates the new baseline.

1. **Find the round's tag.** The round being closed must already be released: `git tag -l '@effected/ai-plugins@*' --sort=-v:refname | head -1` must carry every current entry (`git diff <tag> -- plugin/skills/effected-renovate/references/ledger` is empty). If it does not, stop and tell the user to release the plugin first.
2. **Review what the round learned.** Show the user every row below the marker in `references/traps.md`, and every entry, each with a proposed fate:
   - **fold**: a trap or process step that will recur on any future upgrade. It moves into `SKILL.md` or the standing traps table, written timelessly.
   - **drop**: specific to this round, or no longer true.
   Apply only the fates the user approves.
3. **Rewrite `BASELINE.md`**: `previous` becomes the tag from step 1, and `floor` becomes the versions the round's entries brought consumers to (the highest `applies` threshold per package, plus `effect`), keeping every package already in `floor` that the round did not raise: a package that leaves the floor stops triggering the chain, so a consumer lagging only on it silently misses the older rounds. Move every entry's `renames` into `BASELINE.md`'s `renames` map, keeping the ones already there: `bump-config-deps.mjs` reads renames only from the shipped ledger, never a fetched round, so a rename dropped here is lost for every consumer still on the old name.
4. **Empty the round**: delete every `NNNN-*.md` entry file, and every row below the marker in `traps.md`. Entry ids restart at `0001`.
5. Run `applicable.mjs --check` and the bats suite, rebuild the plugin, and write an `@effected/ai-plugins` changeset (a patch: the skill's process is unchanged). Do not commit.

## Known traps

| Looks like | Actually |
| --- | --- |
| String `isMinLength(n)` exports `minLength: ceil(n/2)` | Deliberate: UTF-16 units vs code points (upstream #6336, #8358) |
| Pre-commit fails with "Unexpected positional argument" | okfit CLI drift in the managed OKF hook section; compare it with silk-core's `SavvyOkfSection.js` template and hand the fix to the user |
| `plugin:check` fails right after a rebuild | Its `git diff --exit-code plugin/builds` step fails on uncommitted builds; run `pluginfinity build --check` for the real answer |
| `okfit validate` shows `generated-at-drift` after an OKF edit | Expected until commit: the pre-commit `okfit sync --staged` re-stamps it |
| A verified concept shows `verified-drift` | Only the user's `okfit verify <id>…` clears it; hand them the command |
