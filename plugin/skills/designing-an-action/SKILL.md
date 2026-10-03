---
name: designing-an-action
description: Use when designing a NEW GitHub Action, rebuilding or porting an existing action onto the @effected suite, or planning any multi-step action build, before writing the spec, the plan, or any module. For a single feature added to an existing action, load the matching actions-* skill instead; for capability routing, load building-a-github-action.
when_to_use: design a new action, rebuild an action, port an action to effected, greenfield action rebuild, action walking skeleton, contracts-first build, parity contract, action.yml parity, replace a legacy Actions toolkit wholesale
---

# Designing an action

The build process for an action-shaped program on the `@effected` suite: recon → frozen spec → API dossier → contracts-first walking skeleton → TDD fill. Companion to `building-a-github-action` (routes capabilities to packages and skills) and `effect-v4-planning` (gates the design of any individual module) — this skill owns only the sequence.

The core commitment: the whole pipeline exists as typed contracts with inert stub implementations before any business logic is written. Everything before the skeleton exists to make the contracts trustworthy; everything after fills them in, one step at a time, against a frozen interface.

Use this for a new action from its metadata file up, a wholesale rebuild replacing a legacy toolkit under a parity contract, or a port where more than one pipeline step changes. **Not** for adding one input, one step, or one report to an action that already has this shape — load the matching `actions-*` skill and work within the existing contracts instead.

## The sequence

**Phase −1: Recon.** Cheap, wide, evidence-only — no design decisions yet.

1. Inventory three surfaces: what's actually installed (package versions and their export maps), what exists in the kit but isn't installed yet, and what a sibling action already using this suite depends on — a diff-able record of which packages a shape like this one needs.
2. Locate the hard parts first and confirm their enabling surfaces exist before anything else — an embedded server needs a detached-process contract and a blob-store backend; a toolchain step needs a tool installer. A missing enabler changes the whole plan, so find it before the plan exists.
3. Read every touched package's own documentation and this repository's own conventions before deciding anything — a recon that picks a shape first and meets constraints later re-litigates its own decisions.
4. Present 2–4 real decisions with recommended defaults: where legacy code goes, the dependency posture, how strict the parity contract is, and — when the action needs GitHub App auth — token scope verification and lifecycle placement, decided now rather than discovered while wiring the entry point (`github-app-tokens` carries the complete recipe). Everything else is not a decision; don't pad the list.
5. A checked-absent kit surface is a decision point, not a workaround license. When recon turns up a capability the installed kit genuinely doesn't ship, ask whether to contribute the fix upstream now or write a local, tracked shim — never decide silently either way — and record the gap as an issue against the kit regardless of which path is chosen.

**Phase 0: Spec with a frozen parity contract.** Freeze the interface inventory numerically, and track every uncertainty as a known unknown with a verification obligation. See [references/porting.md](references/porting.md) for both in full.

**Phase 0.5: The API dossier.** Persist a signature-level dossier of the packages this build depends on before writing a skeleton against them. See [references/porting.md](references/porting.md).

**Phase A: The contracts-first walking skeleton.** Build seven pieces in order, each an inert stub that succeeds: domain schema, inputs module, outputs module, cross-phase state, step contracts, program/entries/layers, and only then the TDD fill. See [references/walking-skeleton.md](references/walking-skeleton.md) for each step in full, and [references/design-checkpoints.md](references/design-checkpoints.md) for the correctness rules that make each one non-negotiable.

**Phase B: Fill.** Fill each step's business logic in red/green/refactor cycles against the now-frozen contract, one step at a time. See [references/porting.md](references/porting.md) for treating a legacy implementation as the test oracle, and for the doubles-before-runner-conversion ordering when this phase also migrates test infrastructure.

## Standards

- **A plan task carries verbatim draft code, not a contract.** Mark any uncertain API spelling inline with an authority chain to resolve it — a plugin skill first, then the vendored reference source, then the installed types — and let the implementer verify against the installed types before writing, reporting every correction.
- **One fresh subagent per task, with a task-scoped reviewer carrying an explicit constraint lens** ("cross-check every name against the frozen inventory yourself"), and a ledger file that survives context loss across the whole build.
- **A reviewer verifies against the primary source, not the implementer's report.** Re-read the source line by line; a reviewer who reads only the summary reviews the summary, not the work.
- **A convention decision made mid-build supersedes whatever the plan already says.** Record it once, ledger it as a ruling, and restate it in every later dispatch — a task brief was extracted from the plan before the decision existed, so nothing else carries it forward.
- **Gate every task and every milestone.** Per-task: its own tests, then the full suite, then typecheck, then lint, then a properly formatted commit. Per milestone: an end-to-end run after the skeleton lands and after each designated fill step. Refresh the package's own documentation in the same gate — see [references/design-checkpoints.md](references/design-checkpoints.md).

## Footguns

- Business logic appearing before every step contract exists means the skeleton discipline is being skipped. See [references/walking-skeleton.md](references/walking-skeleton.md).
- A stub that fails, or a skeleton that isn't green, is a wiring bug — stubs always succeed; red belongs only to the fill phase's TDD cycle. See [references/walking-skeleton.md](references/walking-skeleton.md).
- An upstream ask or a design commitment resting on an unverified known unknown, or two implementers independently re-deriving the same API surface, both mean the dossier wasn't persisted or wasn't handed down. See [references/porting.md](references/porting.md).
- A requirement channel declared from a guess rather than from a reference implementation's actual usage is a contract that will need reopening. See [references/walking-skeleton.md](references/walking-skeleton.md).
- An error class with no test that constructs it is a documented lie; the mirror form — a step failure reported through a bare, untagged error — is the same defect from the other side. See [references/design-checkpoints.md](references/design-checkpoints.md).

## Additional resources

- [references/porting.md](references/porting.md) — the frozen parity contract and known-unknowns ledger in full, persisting an API dossier, treating a legacy implementation as a behavioral oracle, deriving a step's requirement channel from real usage, and the doubles-before-runner-conversion migration order. Load when: rebuilding or porting an existing action, or planning Phase 0 through Phase B of any build with a legacy reference implementation.
- [references/walking-skeleton.md](references/walking-skeleton.md) — each of the seven skeleton pieces in full, in order, with the reasoning behind the ordering and a named worked example to read alongside it. Load when: building Phase A of a new or rebuilt action.
- [references/design-checkpoints.md](references/design-checkpoints.md) — the correctness rules behind cross-phase state, failure posture, the logging contract, layer minimalism, bundle truth, dependency honesty, and error-taxonomy auditing. Load when: writing or reviewing any of these six specific mechanisms, not only when building a skeleton from scratch.
