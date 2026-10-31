---
name: effect-upgrade
description: Use when advancing the kit to a new Effect 4.x release — the user runs /effect-upgrade <version>, or asks to move effected onto a newer effect, repin .repos/effect, or adopt a new Effect patch or minor across the kit.
argument-hint: <effect-version, e.g. 4.0.5>
---

# Effect upgrade

Target version: `$ARGUMENTS`. Read `okf/runbooks/advance-the-effect-pin.md` first; it is the authority on the pin mechanics, and this skill is the end-to-end session around it. Work through the phases in order and do not skip a gate.

## Ground rules

- **The user runs the catalog commands, not you.** That means `pnpm pnpm:up`, `pnpm pnpm:export` and the install, and also any `okfit verify`.
- **Never use raw git on `.repos/`.** Use `repos_manage` (pin, note). A guard blocks `git reset` there.
- **You cannot edit `.husky/*`.** If a hook breaks, show the user the exact fix and stop.
- **Never use `git checkout`, `git restore` or `git stash`** to clean up surprise changes. Another process may own them (a concurrent `pnpm:export` rewrote `pnpm-workspace.yaml` mid-session once). Ask the user.
- **A probe settles semantics, not reasoning.** Install the old and new `effect` side by side in the scratchpad (`npm i effect@<v>` in one directory per version) and run both before writing any claim about behaviour.
- **Keep the ledger as you go.** Every phase that learns something a downstream project needs writes it to the ledger in the same step. Do not reconstruct it from the diff at the end.

## The upgrade ledger

`.claude/upgrades/effect-$ARGUMENTS.md` is a prompt for the agent that upgrades a downstream project onto this release. It covers two things: the Effect changes, and every `@effected/*` change that ships in the same release. That includes kit work beyond the advance, such as other unreleased changesets on `main` or on this branch. Model it on the newest ledger in `.claude/upgrades/` (`effect-4.0.7.md` is the reference shape), and read it before you start this one.

- **Address the downstream agent, in the imperative.** Open with "You are moving this repository to Effect `$ARGUMENTS`, from `<previous>` or earlier", say what else the release carries, and say whether it breaks. Then give the work order: repin and install, find the changes, get green, and only then adopt and align.
- **Keep the section order** of the reference ledger, and drop any section the release has nothing for:
  1. Versions in this release: a table of each package's planned version, plus the catalog plugin and the `@effected/ai-plugin` versions.
  2. Repin vendored Effect source.
  3. Bump the catalog plugin and reinstall, including new packages and moved dependency or peer edges.
  4. Find the Effect changes in your code: one `git grep` covering every touched API, then a subsection per area.
  5. The kit's changes from the advance.
  6. The kit's other breaking changes, one numbered subsection per package, opening with their own `git grep`.
  7. Security fixes.
  8. New surfaces worth adopting: Effect's, then the kit's, then known consumer notes. Each entry names the hand-rolled pattern to search for.
  9. Verify the upgrade.
  10. Clear your tracking tickets: a table of the effected issues closed this round.
  11. Align on the kit and on Effect.
- **Name shapes, not signatures**, and tell the reader to check every claim against their installed `.d.ts` or the vendored source.
- **A stated behaviour must be probed on both versions** (the old and new `effect`, or the old and new kit package). Something you could not probe goes in as "check", not as fact.
- **Say how each break shows itself:** typed (the compiler finds it) or behavioural (only tests do). Section 9 lists both kinds, so the reader knows what each gate catches.
- **Unlike skills, the ledger names versions.** That is its job, and it is not consumer-facing skill text.
- **Write no claim the branch doesn't back.** Every kit entry traces to a changeset or a commit on the branch, and every Effect entry to the changelog, the source diff or a probe.

## Phases

1. **Preflight**
   - Run `npm view effect@$ARGUMENTS version` from the scratchpad, not the repo, because devEngines breaks `npm view` inside it. Core itself must resolve, not only its satellites.
   - Create the branch `feat/effect-$ARGUMENTS`.
   - Start the ledger: write the opening and the section headings, and record the previous `effect` version.
   - List the other kit work this release will carry: `ls .changeset/` and `git log <last release commit>..HEAD`. Each pending changeset becomes a ledger entry in phase 5.
2. **Catalog (user)**
   - Check whether `packages/pnpm-plugin-effect/savvy.build.ts` already names `$ARGUMENTS`. If not, ask the user to run `pnpm pnpm:up`, then `pnpm pnpm:export`, then install, and to add the changesets (catalog sync plus their bump policy for the packages).
   - When they're done, confirm the lockfile resolves `effect@$ARGUMENTS`, and compare the platform-binary lines against `HEAD:pnpm-lock.yaml`:
     `grep -cE "^  '?@?(turbo|biomejs/cli|typescript/native-preview)[^:]*(darwin|linux|win32)"`
     The counts must match.
   - Ledger section 3: the catalog plugin bump, new packages, and any dependency or peer edge that moved (`git diff HEAD -- 'packages/*/package.json'`).
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
   - **Ledger:** add each changelog item that could change a downstream project's types, output or behaviour to section 4, with its search term in the section's `git grep`. Add new Effect APIs to section 8. Add each kit change the advance forces (a dropped workaround, a changed default, a re-exported shape) to section 5.
5. **Kit changes → ledger**
   - For every pending changeset from phase 1, and every one the branch adds, read the changeset and its diff. Write the entry: a break goes to section 6, a security fix to section 7, a new surface to section 8, and a closed issue (`Closes #N` in the commits, or `gh issue view`) to section 10.
   - Probe any behaviour change on the old and new package before you state it.
6. **Build and test**
   - Run `pnpm build`, the workspace tests, and `pnpm catalog:check`.
   - A turbo cache hit replays old output, so check `dist/*/issues.json` `generatedAt`.
   - **Ledger:** every kit break the build or tests surface goes in sections 5 or 6, along with what a downstream project sees (a type error or a test failure).
7. **Plugin**
   - Run `node plugin/scripts/rederive-anchors.mjs`. It relocates every manifest anchor by its symbol and prints each `MOVED` line with the text it landed on; read those. It refuses with `MISSING` (the symbol is gone: re-read the source and rewrite the citation and its manifest entry), `AMBIGUOUS` (add an `after` naming the nearest enclosing member line) or `COLLISION`, and then writes nothing. Once the dry run refuses nothing, run it again with `--write`.
   - Then `node plugin/__test__/helpers/skill-anchors.mjs` must report 0 failures. It covers every skill file, so a citation the manifest lacks, a token cited more times than its entry's `occurrences`, a bare `:NNN` with no file, or a prose citation beside a named file (`` `src/Logger.ts` ``: `consoleJson` at 992) fails there. The prose lint sees only "at", "line" or "lines" plus three or more digits next to a file in a code span; any other way of writing a line number goes unchecked, so write every line citation as a `File.ts:N` token.
   - For each changelog item, grep `plugin/skills` and `plugin/agents`. Re-probe any skill example whose output a changed module produces; JSON Schema output (`effect-v4-schema/references/11-generation-and-tooling.md`) drifts most.
   - Add new modules or namespaces to `effect-v4-module-index`.
   - Skill text states current behaviour only: no version numbers and no "since" history.
   - Then `pnpm build --filter @effected/ai-plugin` and `pnpm test:bats`.
8. **OKF**
   - Grep `okf/` for the old version string and for "today". Body text describing the catalog goes stale on every patch, so reword it to name no patch version.
   - Run `okfit sync --yes` and `okfit validate` (0 errors).
   - Add a `repos_manage` note recording the advance: kit breaks, workarounds kept or dropped and why, and anything that looked like a bug but isn't.
9. **Commit** (load `silk:commit-create`, and commit only through its `commit.sh`):
   - **(a) repin:** lockfile, catalogs, `.repos/`, `EFFECT_PIN` and changesets, in one commit, as the runbook requires.
   - **(b) code:** kit adoptions or dropped workarounds, if any.
   - **(c) plugin:** skills, anchors and `builds/`.
   - **(d) OKF.**
   - **(e) ledger:** `.claude/upgrades/effect-$ARGUMENTS.md`. Before you commit it, check that section 1 matches the release plan (`changeset_preview`, or `pnpm changeset status --verbose`): every package that bumps, at its planned version. Check too that every changeset has an entry.
   - Never commit `plugin/builds/` without its source.
10. **PR** (load `silk:pr-body`): push and open the PR.
    - In the summary, say what was verified and how, which workarounds were kept and why, and what you ruled out.
    - Link the ledger. Then write the PR number into the ledger's opening and commit that.
    - Validate the squash fence with `validate-message.sh`.
11. **Review loop**
    - Read the reviews: `gh pr view <n> --json reviews` plus `gh api repos/{owner}/{repo}/pulls/<n>/comments`.
    - Verify each finding against source before fixing it, fix the valid ones in one commit, and tell the user which you skipped and why.
    - If a fix changes a shape or a behaviour the ledger states, update the ledger in the same commit.
    - If the effected catalog in `pnpm-workspace.yaml` lags `savvy.build.ts`, ask the user to re-run `pnpm pnpm:export`.

## Known traps

| Looks like | Actually |
| --- | --- |
| String `isMinLength(n)` exports `minLength: ceil(n/2)` | Deliberate: UTF-16 units vs code points (upstream #6336, #8358) |
| Pre-commit fails with "Unexpected positional argument" | okfit CLI drift in the managed OKF hook section; compare it with silk-core's `SavvyOkfSection.js` template and hand the fix to the user |
| `plugin:check` fails right after a rebuild | Its `git diff --exit-code plugin/builds` step fails on uncommitted builds; run `pluginfinity build --check` for the real answer |
| `okfit validate` shows `generated-at-drift` after an OKF edit | Expected until commit: the pre-commit `okfit sync --staged` re-stamps it |
| A verified concept shows `verified-drift` | Only the user's `okfit verify <id>…` clears it; hand them the command |
