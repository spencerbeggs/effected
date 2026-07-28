---
name: designing-an-action
description: Use when designing a NEW GitHub Action, rebuilding or porting an existing action onto the @effected suite, or planning any multi-step action build — before writing the spec, the plan, or any module. Triggers include design a new action, rebuild an action, port an action to effected, greenfield action rebuild, action walking skeleton, contracts-first build, parity contract, action.yml parity, replace @actions/* or @savvy-web/github-action-effects wholesale. For a single feature added to an existing action, skip this and load the matching actions-* skill; for capability routing load building-a-github-action; this skill sequences the whole build.
---

# Designing an action

The build process for an action-shaped program on the `@effected` suite: recon
→ frozen spec → API dossier → contracts-first walking skeleton → TDD fill.
Companion to `building-a-github-action` (which routes capabilities to packages
and skills) and `effect-v4-planning` (which gates the design of any individual
module). This skill owns the sequence; those own the content.

The core commitment: **the whole pipeline exists as typed contracts with inert
stub implementations before any business logic is written.** Everything before
the skeleton exists to make the contracts trustworthy; everything after fills
them in one step at a time against a frozen interface.

## When to use

- A new action, from `action.yml` up.
- A greenfield rebuild of an existing action (replacing `@actions/*` or a
  legacy effects library wholesale) under a parity contract.
- A port of an action onto `@effected/github-actions` where more than one
  pipeline step changes.

**Not** for adding one input, one step, or one report to an action that
already has this shape — load the matching `actions-*` skill and work within
the existing contracts.

## Phase −1: Recon before design

Cheap, wide, evidence-only. No design decisions yet.

1. **Inventory three surfaces**: what is installed
   (`node_modules/@effected/*` — versions and `exports` maps), what exists
   upstream but is not installed (the kit's `packages/` listing), and what
   prior consumers did — a sibling migrated action's `package.json`
   dependency set is a diff-able record of which suite packages that action
   shape needed.
2. **Locate the hard parts first** and confirm their enabling surfaces exist
   before anything else. An embedded server needs `DetachedProcess` and a
   `BlobStore` backend; a toolchain step needs `ToolInstaller`. A missing
   enabler changes the whole plan, so it must be found before the plan
   exists — not during implementation.
3. **Present the human 2–4 real decisions with recommended defaults**: where
   the legacy code goes, the dependency link posture, how strict the parity
   contract is. Get them answered before writing a line of design. Everything
   else is not a decision — do not pad the list.

## Phase 0: Spec with a frozen parity contract

- **Freeze the interface inventory numerically.** "16 inputs, 16 outputs,
  byte-compatible `action.yml`" — a count plus a frozen file lets every later
  reviewer cross-check names mechanically instead of trusting prose. For a
  new action, freeze the inventory you just designed; the point is that
  Phase A and every review after it compare against a fixed artifact.
- **Every uncertainty becomes a numbered known unknown with a verification
  obligation.** No upstream ask, no design commitment, until the unknown is
  checked against installed `.d.ts` with `file:line` cites. Expect most to
  dissolve on verification — the ones that survive are the real asks.

## Phase 0.5: The API dossier

Dispatch **one** research agent to read the installed `.d.ts` files and real
consumer call sites, producing a signature-level dossier with a per-claim
`file:line` cite and a verdict per known unknown: `VERIFIED-YES` /
`VERIFIED-NO` / `PARTIAL`.

**Persist it as a file.** Implementer subagents cannot see the coordinator's
context; the dossier is what stops N downstream agents from re-deriving — or
hallucinating — the same API surface N times. It is also the artifact that
survives context loss between sessions.

## Phase A: Contracts-first walking skeleton

Build these seven, in order, with stub implementations that are inert but
**succeed** — the skeleton runs end-to-end green from day one, and failure to
stay green is a wiring bug found while wiring is the only thing that exists.

1. **Domain schema** — the config vocabulary: branded/refined versions,
   literal unions. Delegate validation to suite packages where they exist
   (`@effected/semver` exact-parse, never a hand-rolled regex).
2. **Inputs module** — every action input modeled over `ActionInput` `Config`
   composition; defaults matching `action.yml` exactly; secrets `Redacted`;
   normalization in one `Config.map`. (`actions-inputs-outputs` teaches the
   absence rule and the `Config.withDefault` trap.)
3. **Outputs module** — the output names as a `const` tuple, a typed model,
   defaults, and **one** emitter — with a test proving it writes every name
   exactly once, by sorted-key comparison against the frozen inventory.
4. **Cross-phase state** — `Schema.Class` state records keyed by a
   `STATE_KEYS` const; any pid field uses the kit's validating `ProcessId`
   brand so a truncated state file fails typed
   (`actions-state-and-secrets`).
5. **Step contracts** — one module per pipeline step, each exporting: a
   result type, a tagged error with a `reason` literal union (plus stored
   `message`, optional `cause`), a declared requirement channel `R`, and a
   stub that succeeds with a documented inert value. **Stubs never fail.**

   **The R channel.** For a succeeding stub, a too-wide `R` costs nothing;
   a too-narrow `R` is a breaking change to the composing program the
   moment Phase B needs the missing service — so widen at contract time,
   not fill time. Derive each step's `R` from the legacy oracle's actual
   service usage, never from intuition — review-audit any `R` an
   implementer judgment-called. And when two implementation strategies are
   both still live options, declare the **union** of their requirements,
   so Phase B can pick either without touching the contract.
6. **Program, entries, layers** — the real `Action.run` bootstraps, the real
   layer composition, steps composed under `ActionLogger.group`, outputs
   emitted from the fold of stub results. Build all bundles; smoke-run.
7. **Only then, Phase B** — fill each step's business logic in TDD
   red/green/refactor against the frozen contract, one step per plan, using
   the legacy implementation as a behavioral oracle: stashed verbatim,
   excluded from tooling, **never imported**.

## Execution discipline

What makes the multi-agent execution smooth rather than chaotic:

- **Plan tasks carry verbatim code, with v4-spelling uncertainty marked
  inline** plus an authority chain to resolve it: plugin skill → vendored
  Effect source → installed `.d.ts`. Implementers verify-then-write and
  report every correction with cites. Plan code is a strong draft, not a
  contract — the installed types are the contract.
- **Fresh subagent per task; task-scoped reviewer per task** with an explicit
  constraint lens ("cross-check all 16 names against `action.yml`
  yourself"); scoped re-reviews for fix rounds; a ledger file that survives
  context loss.
- **Reviewers verify against primary sources, not reports** — re-run the
  reject matrix, re-read the source line by line. A reviewer that reads the
  implementer's summary reviews the summary.
- **A convention decision made mid-build supersedes plan text**: record it
  at the top of the plan with a mapping for stale paths, ledger it as a
  ruling, and restate it in every later dispatch — task briefs are
  extracted from the plan, so a fresh subagent cannot know a decision made
  after its brief's text was written.
- **Checkpoints**: per-task gates (own tests → full suite → typecheck → lint
  → validated conventional commit), and milestone end-to-end runs after the
  skeleton and after designated Phase B steps.

## Red flags

- Business logic appearing before every step contract exists — the skeleton
  is being skipped.
- A stub that fails, or a skeleton that is not green — stubs succeed; red
  belongs to Phase B's TDD.
- An upstream ask, or a design commitment, resting on an unverified known
  unknown — the ledger exists to prevent exactly this.
- Two implementer agents independently reading the same `.d.ts` — the
  dossier was not persisted, or not handed to them.
- A reviewer approving from the implementer's report without opening the
  primary source.
- An `R` channel declared from intuition rather than the oracle's actual
  service usage.

## Where the depth lives

| Need | Load |
| --- | --- |
| which package owns a capability | `building-a-github-action` |
| designing one module's data/errors/services | `effect-v4-planning` |
| inputs, outputs, the absence rule | `actions-inputs-outputs` |
| state, secrets, pids across phases | `actions-state-and-secrets` |
| cache, artifacts, tool installs | `actions-cache-and-artifacts` |
| test seams, doubles, discriminating mutants | `testing-actions` |
| schema vocabulary for the domain module | `effect-v4-schema` |
