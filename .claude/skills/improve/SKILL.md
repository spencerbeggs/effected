---
name: improve
description: Use when maintaining the "effective" plugin's skills in plugin/skills/ — harvesting falsified skill claims from a finished migration into GitHub tickets, or draining those tickets by verifying each claim against the vendored Effect v4 source and amending the skill. Enforces the evidence ladder (docs settle renames, source settles existence, only a probe settles semantics) and the probe preconditions that make a probe non-vacuous.
---

# Improving the plugin's skills

This skill maintains `${CLAUDE_PROJECT_DIR}/plugin/skills/`. It is a **project-level** skill and lives outside the plugin on purpose: the plugin carries no machinery for grading itself, and this skill is free to assume the layout of this repo — most importantly the vendored source at `${CLAUDE_PROJECT_DIR}/repos/effect-smol`, which a published plugin could never rely on.

It has two modes. **Harvest** turns a finished migration into tickets. **Tune** turns tickets into skill edits. Together they close the loop the plugin's ethos already implies: migrations falsify skill claims, and something has to carry the falsifications back.

## The problem this exists to solve

Every skill in `${CLAUDE_PROJECT_DIR}/plugin/skills/` was written from Effect's own documentation. Every serious error found in those skills was a place where the documentation was *right* and the skill's inference from it was wrong — or where the documentation was silent and v3 memory filled the gap.

Re-reading the docs harder cannot find those errors. That is the whole reason for the ladder below.

## The evidence ladder

Three rungs, ordered by cost. Each answers a strictly different class of question. This ordering is empirical — it was established on 2026-07-09 by testing the corpus against facts this repo had already won by probing.

| Rung | Source | Settles | Cost |
| --- | --- | --- | --- |
| 1 | `${CLAUDE_PROJECT_DIR}/repos/effect-smol/migration/*.md`, `ai-docs/`, `LLMS.md`, [Effect-TS/skills](https://github.com/Effect-TS/skills) references | **Renames** | seconds |
| 2 | `${CLAUDE_PROJECT_DIR}/repos/effect-smol/packages/*/src` | **Existence and signature** | a grep |
| 3 | A probe compiled and run from inside a package | **Semantics** | minutes |

**Rung 1 is prescriptive, not exhaustive.** It documents the recommended path, not the surface. Verified failures of rung 1, each of which cost real work:

- `migration/services.md` migrates `Context.Tag` → `Context.Service` and **never mentions `Context.Key`** — yet `Context.Key` was the primitive the `config-file` port needed, and its `out Shape` covariance sank an already-approved compile-error design.
- `migration/forking.md` names `Effect.fork` → `Effect.forkChild` in a table, and never mentions that `Effect.makeSemaphore` is gone and `Semaphore` is now a top-level module.
- `migration/cause.md` gives `Cause.isFailure` → `Cause.hasFails`, and never mentions `Exit.causeOption` → `Exit.getCause`.

Nothing short of source settles a **removal**. Nothing short of a probe settles **behaviour** — that `Effect.cached` memoizes the `Exit` *including interrupts*, or that `it.effect` always installs a virtual `TestClock`.

### The citation rule

**A skill edit must cite the highest rung that actually settles its claim.**

- A rename may cite rung 1.
- "X exists" / "X has this signature" / "X was removed" must cite rung 2.
- Any claim about *what happens when you run it* must cite rung 3.

Citing a doc passage for a semantic claim is how these skills acquired their errors. Reject the edit; go get a probe.

## Probe protocol

A probe that cannot fail is worse than no probe. Each precondition below was learned by being burned.

1. **Run from inside the package, never the repo root.** The workspace root resolves `effect@3.21.4` and will describe the v3 surface with total confidence. The pnpm fix in [pnpm/pnpm#12847](https://github.com/pnpm/pnpm/pull/12847) addresses lockfile poisoning; it does **not** change which `effect` a root-relative `require` resolves.
2. **Print the resolved version inside every probe.** If it does not say `4.0.0-beta.<n>`, the probe is measuring v3 and every conclusion from it is void.
3. **Probe files live at the package root.** The tsconfig `include` is `${configDir}/*.ts` and does **not** match subdirectories. A probe in a subdirectory silently leaves the compilation program, and its control error never fires — it false-passes.
4. **Run the control first.** Write a line you *know* must fail to compile or must throw. Watch it fail. Only then write the real assertion. If the control passes, the harness is broken, not the claim.
5. **Delete by absolute path** when done.

```bash
cd packages/<pkg>
node -e 'console.log("resolved effect:", require("effect/package.json").version)'
# type-level probe: write packages/<pkg>/probe.ts, then
pnpm exec tsgo --noEmit          # the package's own types:check script
rm -f "$PWD/probe.ts"
```

A control that works, verified 2026-07-09 against `effect@4.0.0-beta.94`:

```ts
import { Effect } from "effect";
const control = Effect.catchAll; // v3 name; must fail
// probe.ts(3,24): error TS2339: Property 'catchAll' does not exist on type 'typeof Effect'
```

Two further traps, both real:

- `Effect.catchCause` swallows interrupts, so a probe built on it will report success where the real code hangs. Use `catchDefect` when the exposure is a defect.
- The vitest `AgentPlugin` reporter can swallow module-resolution errors and report "0 tests passed". For red-phase runs use the `run_tests` MCP tool, not a bare `vitest` invocation.

## Mode: harvest

Run at the end of a migration, before the branch is forgotten.

1. Read `.superpowers/sdd/progress.md` for the cycle's **retractions** — every entry where a stated belief turned out false. Read the PR review threads for the same.
2. For each, ask the discriminating question: **is this a skill defect, or a one-off mistake?** A skill defect is a claim the skill makes, or a gap the skill should have covered, that would mislead the *next* migration. Only those become tickets. This step is judgment; do not automate it away.
3. File one ticket per defect on `spencerbeggs/effected`:
   - Title: `<skill-name>: <the claim, or the gap>`
   - Body opens `## Rough edge (plugin dogfooding)`, names the package and the `effect` beta it surfaced against, quotes the skill's current text, and **states the artifact that falsified it** — the probe, the failing test, the review comment.
4. Do not amend the skill during harvest. Harvest files; tune fixes.

## Mode: tune

Run against open skill tickets.

1. List them: `gh issue list --repo spencerbeggs/effected --state open`. Skill tickets are titled `<skill-name>: …`.
2. For each ticket, classify the claim — rename, existence, or semantics — and climb to exactly that rung. No further, no less.
3. Amend the skill in `plugin/skills/<name>/SKILL.md`. State the corrected fact **and the trap it replaces**, so a future reader recognises the error rather than re-deriving it.
4. Close the ticket citing the evidence. Rung 2 cites a file and line under `repos/effect-smol`. Rung 3 pastes the probe and its output, including the resolved version line.
5. Reload plugins so the edit takes effect in-session.

## Red flags

Stop if you catch yourself doing any of these. Each has happened.

- **Editing a skill to match a doc passage** when the claim is about runtime behaviour. That is the original error, repeated.
- **"Fixing" something already correct.** During the `config-file` cycle two agents nearly re-exported a deliberately-deleted internal symbol onto the public API because they trusted a stale reference over the current tree. Read the current code before you believe a ticket.
- **Widening a suppression to make a gate green.** The `_base` suppression in each `savvy.build.ts` is narrow and four packages depend on it staying narrow.
- **Spreading `repos/effect-smol` across the plugin.** While the plugin is dogfooded from this repo alone, its agents and skills *may* assume the vendored tree — but exactly one file names the path: `${CLAUDE_PROJECT_DIR}/plugin/skills/effect-v4-source-lookup/SKILL.md`. Everything else consults that skill. If you find a second hardcoded reference, collapse it. See [pre-publish debt](#pre-publish-debt).
- **Trusting a green build you did not run correctly.** `node savvy.build.ts --target prod` run directly skips `build:dev`, produces no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate. Build with `pnpm build --filter <pkg>` from the repo root.
- **Pointing a *writing* tool at the vendored tree.** `${CLAUDE_PROJECT_DIR}/repos/effect-smol` is read-only reference. On 2026-07-09, running `markdownlint-cli2` against it — merely to *check* whether it was excluded — silently rewrote 19 files, among them `migration/services.md` and `migration/forking.md`, because the repo's markdownlint config sets `"fix": true`. A corrupted rung-1 source is undetectable by reading it. If you must confirm the tree is untouched, `git status ${CLAUDE_PROJECT_DIR}/repos/effect-smol` or diff against a fresh clone of the pinned tag.

## Pre-publish debt

**Status: discharged 2026-07-09 ([#20](https://github.com/spencerbeggs/effected/issues/20)).** Kept here because the invariants below still need holding.

The plugin is currently loaded only from this repo (`claude --plugin-dir plugin`), so `${CLAUDE_PROJECT_DIR}/repos/effect-smol` resolves. That substitution points at the **consuming project's** root — today the same directory, but not once the plugin is published elsewhere.

`effect-v4-source-lookup` now resolves an ordered ladder: `$EFFECT_SMOL_SRC` override → the vendored subtree → `node_modules/effect/src` → hard failure. Two facts settled it, and the second corrects what this section used to claim:

- **`effect` publishes its source.** Its `files` array is `["src/**/*.ts", "dist/**/*.js", …]`, so every consumer has the complete v4 TypeScript source, `internal/` implementations included — not merely `.d.ts`. `node_modules/effect/src/Context.ts:65` is byte-identical to the vendored tree's, same line. Rung 2 survives publication at full fidelity.
- **Rung 1 does not survive.** No `migration/`, `ai-docs/`, or `LLMS.md` ships in the package. The ladder announces this and sends the reader to rung 2, rather than papering over it.

**The version gate is the load-bearing line.** `effect@3` *also* ships `src/`, so a bare `require.resolve` from the workspace root returns a complete, confident, wrong rung-2 source. The resolver must **refuse** a non-`4.*` resolution, not report it — a printed version is a version a reader skims past. This was caught by running the resolver's own control (no tree + only v3 resolvable → must exit 1, must not serve v3), which the first draft failed.

Two invariants remain this skill's to keep:

1. Keep the path in one file. Re-verify each agent (`${CLAUDE_PROJECT_DIR}/plugin/agents/*.md`) names the ladder but not the directory:

   ```bash
   test "$(grep -rl 'repos/effect-smol' plugin/ | wc -l)" -eq 1
   ```

2. **Never trade the loud failure for a quiet fallback.** Every step of the ladder resolves to a version-exact source tree or does not resolve; no step resolves to recollection. Silent degradation to v3 memory is the precise failure the plugin exists to prevent, and it is indistinguishable from success.

## Where things are

- Skills under maintenance: `plugin/skills/*/SKILL.md`
- Migration ledger and retractions: `.superpowers/sdd/progress.md`
- Vendored v4 source, pinned to the `effect` catalog tag: `repos/effect-smol` (see `.claude/design/effected/architecture.md`)
- Migration notes (rung 1): `repos/effect-smol/migration/*.md`
- Design record for this loop: `.claude/design/effected/plugin.md`

When the `effect` catalog bumps, the subtree is re-pinned so the two never drift. This repo allows no merge commits and `git subtree pull` creates one, so the pull is followed by a squash:

```bash
git subtree pull --prefix=repos/effect-smol https://github.com/Effect-TS/effect-smol.git effect@<new-tag> --squash
git reset --soft HEAD~2   # drop the merge commit and the squashed-content commit
git commit --no-verify    # carry the git-subtree-dir / git-subtree-split trailers forward
```

Carry both `git-subtree-dir` and `git-subtree-split` trailers into the squashed message. `git subtree pull` finds the vendored tree's origin by grepping ancestor commit messages for `git-subtree-dir`; drop them and the *next* re-pin has no split point. Rationale: `.claude/design/effected/architecture.md`.
