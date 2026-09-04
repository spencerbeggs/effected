---
name: bootstrapping-an-action
description: >-
  Use ONLY when the user explicitly asks to bootstrap a fresh copy of the GitHub Action template
  into their own action — "bootstrap this template", "turn this template into my action", "start a
  new action from the template". Runs a fixed eight-question interview, writes a plan file, and
  hands off to designing-an-action. Never load for ordinary action work; for that, start at
  building-a-github-action.
---

# Bootstrapping an action

A user-invoked interview that turns a fresh copy of the `github-action-template` repository into a planned action. It asks eight questions, one per message, each mapped to a decision the canon already forces; writes one plan file; presents it; and on approval dispatches the `action-engineer` agent to run `designing-an-action` from Phase 0. The interview covers the decision half of Phase −1 recon; the recon obligations below cover the verification half, and the engineer agent still verifies the resulting dossier at Phase 0.5 before any contract is frozen.

This skill edits no source file, runs no build, and never touches the builder configuration. Those belong to the engineer agent and the repository's own gates.

## Precondition

Before the first question, confirm the working directory is a template-shaped repository. All four must hold:

- `action.yml` exists at the root.
- `package.json` lists `@effected/github-actions` under `dependencies`.
- `src/program.ts` and `src/schema/inputs.ts` exist.
- `__test__/unit/structure.test.ts` exists.

If any is missing, say which and stop — this skill has nothing to do in a repository that is not the template. Then record the installed `@effected/github-actions` version (`node -p "require('@effected/github-actions/package.json').version"` from the repo root, or read `node_modules/@effected/github-actions/package.json`); every recon claim in the plan cites it.

## The interview

Ask the eight questions in [references/questions.md](references/questions.md) in order, **one per message**, leading with the recommended default. Do not batch them. Do not skip one because the answer seems obvious; a defaulted answer is still an answer the plan records. Each answer maps to a named decision:

| # | Question | Decides |
| --- | --- | --- |
| 1 | Identity | the rename list |
| 2 | Phases | main-only / main+post / pre+main+post |
| 3 | GitHub access | none / token input / App auth (adds `pre.ts` and `@effected/github`) |
| 4 | Inputs | each input line-list or JSON; any JSON input publishes an input schema |
| 5 | Outputs | scalars only, or a structured `result` for a downstream consumer (publishes a versioned output schema) |
| 6 | Runner capabilities | which kit packages the steps will import |
| 7 | Reporting | job summary / check run / sticky comment / managed document |
| 8 | Self-dogfood | the workflow that runs the action against its own repository |

## Recon obligations

After question 7 — reporting can add `@effected/github` even when question 3 chose no GitHub access, so the package list is not final until then — and before writing the plan, do three things and record each in the plan:

- **Check every derived package against the installed tree.** For each package the answers imply, read `node_modules/<package>/package.json` and record its version, or record it as absent. The plan's dependency table carries an "Installed" column; a memorised capability-to-package mapping is not evidence.
- **Open a known-unknowns row for every enabling surface you could not confirm.** A capability whose kit construct you have not seen in the installed package's export map is a claim to verify, not a fact; name the construct, the package and where the engineer will check it.
- **Surface a checked-absent surface as a decision, never an assumption.** When the installed kit genuinely lacks something an answer requires, ask the user whether to contribute it upstream or write a tracked local shim, and record the choice; either way the plan lists the gap so an issue can be filed against the kit.

## The artifact

Write one plan file to the plans directory your host configures for this repository — Claude Code reads `plansDirectory` from `.claude/settings.json` and defaults to `.claude/plans/`; Copilot uses the plans location its own settings name and defaults to `.copilot/plans/` — named `<YYYY-MM-DD>-bootstrap-<slug>.md`, where `<slug>` is the action name lowered to `a-z`, `0-9` and hyphens with everything else dropped, so a name carrying a path separator or `..` can never place the file outside that directory. Write it in the shape of [references/plan-template.md](references/plan-template.md). It carries the frozen I/O contract as counts plus `INPUT_NAMES` / `OUTPUT_NAMES` tuples, the phase decision, the derived dependency list with the honesty rule applied, the rename list with file paths, a known-unknowns ledger, and the ordered build steps. Present the plan in chat and **stop**. Do not begin implementation in the same turn.

## The handoff

On the user's approval, dispatch the `action-engineer` agent with this brief, substituting the path:

> Run the `designing-an-action` loop from Phase 0 against the plan at `<plan path>`. Phase −1 recon is complete: the plan's I/O contract, phase decision and dependency list are frozen inputs, and its known-unknowns ledger lists what still needs verifying against the installed kit before the walking skeleton. Build the skeleton, then fill step by step. Report what you built, what you verified and with which commands, and any kit gap you hit.

When subagent dispatch is unavailable, tell the user to load `designing-an-action` inline with the plan as its input.

## Standards

- **One question per message, default first.** A batched questionnaire produces guesses; the interview exists to surface the decision behind each default.
- **Every answer becomes a named decision in the plan.** An answer that changes nothing is still recorded, so a later reader knows it was asked.
- **Dependency honesty from the first commit.** The dependency list is derived from the capabilities the answers imply, and a package enters only when a step will import it. No pre-declared "common set".
- **The plan freezes the contract numerically.** Inputs and outputs as counts plus tuples, so every later reviewer cross-checks names mechanically.
- **Cite the installed kit version** on every recon claim, never memory.

## Footguns

- Asking the outputs question as "do you want outputs?" — every action has outputs; the decision is whether one of them is a structured document a downstream consumer parses, because that is what triggers schema publication. See [references/questions.md](references/questions.md).
- Answering the App-auth question by adding `@effected/github` to the plan's dependency list before a step imports it. The dependency lands with the edit that creates `pre.ts`, not before. See [references/questions.md](references/questions.md).
- Writing the plan into `docs/` or the repository root instead of the configured plans directory, where the template's tooling and the executing skills expect it. See [references/plan-template.md](references/plan-template.md).
- Continuing into implementation after presenting the plan. The approval gate is the point; the engineer agent is the executor. See [references/plan-template.md](references/plan-template.md).

## Additional resources

- [references/questions.md](references/questions.md) — the eight questions verbatim, each with its recommended default, the options, and what each answer adds to the plan. Load when: running the interview.
- [references/plan-template.md](references/plan-template.md) — the plan file's sections and the exact shape of the frozen contract, the dependency derivation table and the known-unknowns ledger. Load when: writing the plan file.
