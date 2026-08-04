---
name: designing-an-action
description: Use when designing a NEW GitHub Action, rebuilding or porting an existing action onto the @effected suite, or planning any multi-step action build, before writing the spec, the plan, or any module. For a single feature added to an existing action, load the matching actions-* skill instead; for capability routing, load building-a-github-action.
when_to_use: design a new action, rebuild an action, port an action to effected, greenfield action rebuild, action walking skeleton, contracts-first build, parity contract, action.yml parity, replace a legacy Actions toolkit wholesale
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
3. **Read the repository contracts before deciding anything.** Every package
   you will touch or consume has a `CLAUDE.md`, and the host repo may carry
   design docs — read them BEFORE the decision list exists, not after an
   architecture is chosen. A recon that picks a shape first and meets the
   package's constraints later re-litigates its own decisions.
4. **Present the human 2–4 real decisions with recommended defaults**: where
   the legacy code goes, the dependency link posture, how strict the parity
   contract is, and — when the action needs GitHub App auth — token scope
   verification and lifecycle placement, decided now rather than discovered
   while wiring `main.ts` (`github-app-tokens` carries the complete
   provision/read/dispose recipe; this is the decision to name it here, not
   to restate it). Get them answered before writing a line of design.
   Everything else is not a decision — do not pad the list.
5. **A recon that finds a checked-absent kit surface is a decision point, not
   a workaround license.** "Wait for the kit" silently produces the raw
   subprocess calls and copy-pasted regexes recon exists to prevent
   (effected#193, effected#194). When step 2 turns up a capability the
   installed kit genuinely does not ship, ask the user whether to dogfood the
   fix upstream now or write a local shim — never decide silently either way
   — and either way file an issue against `effected` plus a linked tracking
   ticket wherever the shim lands.

## Phase 0: Spec with a frozen parity contract

- **Freeze the interface inventory numerically.** "16 inputs, 16 outputs,
  byte-compatible `action.yml`" — a count plus a frozen file lets every later
  reviewer cross-check names mechanically instead of trusting prose. For a
  new action, freeze the inventory you just designed; the point is that
  Phase A and every review after it compare against a fixed artifact.
- **Every uncertainty becomes a numbered known unknown with a verification
  obligation — against the evidence source the claim actually has.** A
  package-API claim is settled by the installed `.d.ts` with `file:line`
  cites; a claim about action metadata belongs to the frozen `action.yml`;
  runner behavior belongs to upstream source/documentation or a probe; a
  legacy-behavior claim belongs to the stashed oracle. No upstream ask, no
  design commitment, until the unknown is checked against its source.
  Expect most to dissolve on verification — the ones that survive are the
  real asks.

## Phase 0.5: The API dossier

Dispatch **one** research agent to read the installed `.d.ts` files and real
consumer call sites, producing a signature-level dossier with a per-claim
`file:line` cite and a verdict per known unknown: `VERIFIED-YES` /
`VERIFIED-NO` / `PARTIAL`.

**Persist it as a file.** Implementer subagents cannot see the coordinator's
context; the dossier is what stops N downstream agents from re-deriving — or
hallucinating — the same API surface N times. It is also the artifact that
survives context loss between sessions.

**No subagent dispatch available? The dossier is still mandatory** — the
coordinator performs the same research inline, same verdict format, same
persisted file. Dispatch is the delivery mechanism; the artifact is the
requirement.

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
   **exactly once**: a recording emitter (or spy) counting one write per
   name, THEN the emitted names compared against the frozen inventory. A
   map-shaped assertion alone collapses duplicate writes and proves only
   presence.
4. **Cross-phase state** — `Schema.Class` state records keyed by a
   `STATE_KEYS` const; any pid field uses the kit's validating `ProcessId`
   brand so a truncated state file fails typed
   (`actions-state-and-secrets`). **Every field's encoded form must survive
   `JSON.stringify` → `GITHUB_STATE` → `JSON.parse` intact**: an `Option`
   field is `Schema.OptionFromNullOr`, never `Schema.Option` — the latter's
   encoded form is an `Option` *instance*, and a `main` phase that "saved
   successfully" leaves `post` unable to decode it. Apply this at design
   time, proactively, for every field — do not wait to discover it as a
   test-time trap.
5. **Step contracts** — one module per pipeline step, each exporting: a
   result type, a tagged error with a `reason` literal union (plus stored
   `message`, optional `cause`), a declared requirement channel `R`, and a
   stub that succeeds with a documented inert value. **Stubs never fail.**

   **Decide failure posture per step, now, not while wiring `main.ts`.**
   Three tiers: fail-the-job (the tagged error propagates and the run goes
   red), degrade-to-warning (the step logs and the program continues with a
   documented fallback), or double-netted (`post` and summary writes: wrap in
   both `catch` and `catchDefect`, because **a `post` phase must never turn a
   green run red** — `GitHubToken.dispose`'s belt-and-braces in
   `actions-state-and-secrets` is the worked example, and the rule
   generalizes to every `post` step, not only token cleanup). Record the
   tier per step alongside its contract; fail the effect itself when the
   tier says fail-the-job — never `setFailed` followed by a plain `return`,
   which reports success to the runner's own exit-code channel while the
   log says otherwise.

   **The R channel.** The asymmetry: a too-narrow `R` is a breaking change
   to the composing program the moment Phase B needs the missing service,
   while a too-wide `R` costs only what it honestly costs — every composer
   and every test must keep providing the extra services. Widening is the
   cheaper error, so widen at contract time, not fill time — but it is a
   real obligation, not free. Derive each step's `R` from the legacy
   oracle's actual service usage, never from intuition — review-audit any
   `R` an implementer judgment-called. And when two implementation
   strategies are both still live options, declare the **union** of their
   requirements, so Phase B can pick either without touching the contract.
6. **Program, entries, layers** — the real `Action.run` bootstraps, the real
   layer composition, steps composed under `ActionLogger.group`, outputs
   emitted from the fold of stub results. Build every bundle through the
   repo's sanctioned build entry (in the kit's world:
   `pnpm build --filter <pkg>` — **never** `node savvy.build.ts --target
   prod`, which skips `build:dev` and leaves a truncated gate shaped like a
   clean one); smoke-run.

   **The logging contract is part of this step, not an afterthought.** A
   run-context opening block; every skipped step logs `Step: X — SKIPPED:
   <reason>`, not silence; warnings reserved for acceptance signals rather
   than routine status; a closing result block. Test-enforce it by asserting
   on the captured log stream — the log is the decision record a human (or
   the next agent) reads first, and an assertion on it is the only thing
   that catches a skip that silently stopped logging.

   **Compose layers minimally, and check it.** Add only what
   `ActionRuntime.layer` doesn't already provide (`actions-runtime`'s "one
   line, not a default" section is the reference for what's already there);
   `Layer.unwrap` only when the layer is genuinely config-dependent, a bound
   `const` otherwise. Prove no over-provision with a typed test double: a
   program typed against `ActionServices` plus only the extra services it
   actually needs should fail to *compile*, not merely fail a runtime
   assertion, the moment an unused requirement is added.

   **Bundle truth is a design step, not a discovery.** `vitest` runs source
   and can never see a bundler failure, so the skeleton needs its own
   verification that the *built* artifact works: a dist-freshness check
   (rebuild and diff) and, wherever the bundle needs one, a guard proving a
   native dynamic import actually survives the bundler pass. Non-compilable
   guard scripts like this live in `lib/scripts/` per the repo's own
   convention (changes under `lib/` invalidate the build cache, which is the
   point — a stale guard silently passing is worse than no guard). The slot
   for this checkpoint is canon even when the action has nothing to assert
   yet; a no-op guard is not. Pair this with a load-bearing rule for any
   build-time data your action bakes in: a decode failure at that stage is a
   **defect**, never degraded to an empty result — `Effect.orElseSucceed(()
   => [])` turned one real broken bundle into a truthful-sounding "no
   versions found" (update#187).

   **Dependency honesty is checked here, not assumed.** Every declared
   `@effected/*` dependency must be imported by `src/`, or be a required
   peer dependency of another declared dependency — a structural
   import-walker test that flags an "unused" dependency must resolve the
   peer closure first; a required peer is a legitimate un-imported
   dependency, not a stale one to delete on sight.
7. **Only then, Phase B** — fill each step's business logic in TDD
   red/green/refactor against the frozen contract, one step per plan, using
   the legacy implementation as a behavioral oracle: stashed verbatim,
   excluded from tooling, **never imported**.

   **Porting onto new test infrastructure: doubles first, runner conversion
   separately.** When Phase B is also migrating a test suite onto
   `@effect/vitest`, port the ported service's test doubles before
   converting the harness itself — converting the runner first installs a
   `TestClock` at the epoch across the whole suite, so a real `Effect.sleep`
   still living in `src` hangs to the real vitest timeout, naming nothing.
   The suite mid-port is the characterization gate the port depends on
   staying green (effected#185); a gate rewritten alongside the thing it
   gates is not a gate.

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
  → validated conventional commit carrying the host repo's full commit
  contract — in the kit's world that is a conventional type, a DCO
  Signed-off-by trailer, and a plain-prose body with no markdown), and
  milestone end-to-end runs after the
  skeleton and after designated Phase B steps. **Doc-refresh belongs in the
  same milestone gate**: the package's `CLAUDE.md` (or the action repo's own
  three-tier `CLAUDE.md`) and any shim register stay current as part of the
  definition of done, not a follow-up — a stale doc teaches the next agent
  the dead API it describes.

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
- **An error class with no test that constructs it.** `actions-state-and-secrets`
  names the rule in full ("audit every ported error channel for whether it
  can actually fire"); this is the checkpoint in the one skill that walks
  the whole build where that audit actually happens. The mirror form is
  just as real: a step failure reported through an untyped `new Error`
  where a tagged error belongs is the same defect from the other side.

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
| logs, summaries, check runs, sticky PR comments | `actions-reporting` |
| the GitHub REST/GraphQL client itself | `github-api` |
| App auth, the token lifecycle, `GitHubToken`'s recipe | `github-app-tokens` |
| subprocesses, tool discovery, redaction | `running-commands-and-tools` |
| npm publish, release tags, versioning strategy | `release-and-publish` |
| SBOM, attestation, Sigstore signing | `supply-chain-attestation` |
