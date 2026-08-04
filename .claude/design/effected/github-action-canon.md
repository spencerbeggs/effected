---
status: current
module: effected
category: architecture
created: 2026-08-04
updated: 2026-08-04
last-synced: 2026-08-04
completeness: 90
related:
  - plugin.md
  - effect-standards.md
  - releases.md
  - packages/github-actions.md
  - packages/github.md
  - packages/sbom.md
  - packages/schemastore.md
  - consumers/README.md
  - consumers/silk-release-action.md
  - consumers/silk-runtime-action.md
  - consumers/silk-update-action.md
---

# GitHub Action repository canon

## Overview

This is the canonical shape of a GitHub Action repository built on `@effected` — its file layout, the order its pieces are designed in, the rules that are settled, and the hazards that must be considered before building. It is the register for **why** each rule exists; the teaching surface is the plugin's Actions skill suite ([plugin.md](plugin.md#skill-catalog)), entered through [`building-a-github-action`](../../../plugin/skills/building-a-github-action/SKILL.md) for capability routing and [`designing-an-action`](../../../plugin/skills/designing-an-action/SKILL.md) for the build sequence.

The canon was derived on 2026-08-03 from the three actions that had actually completed the migration onto `@effected/github-actions` — **silk-release-action v4.0.4**, **silk-runtime-action v1.3.2** and **silk-update-action v4.3.2** — audited construct by construct against their shipped source, incidents and issue trails, and ratified the same day. Their migration maps (what came from where) live under [consumers/](consumers/README.md); this document records what the three of them, taken together, prove a fourth action should look like.

**Every rule here is anchored to an incident.** Nothing in the canon is a style preference: each item cites the run, issue or file where its absence cost something. Where three actions disagreed, the disagreement is resolved below with the evidence that settled it — and where the resolution was a judgement call rather than a forced one, that is marked as revisable rather than silently hardened.

The worked example is **savvy-web/github-action-template**, regenerated to this specification (§[The template repo](#the-template-repo)). The template is the executable copy of this document; when the two disagree, this document is the register and the template is the bug — unless the template's divergence is itself a new incident, in which case it amends the canon, as the regeneration's five refinements did.

### Division of labor with the skills

| Surface | Owns |
| --- | --- |
| This document | The rules, the rationale, the incident citations, the resolved decisions and their revisability. |
| `designing-an-action` | The build sequence as a process an agent executes — recon, frozen spec, API dossier, walking skeleton, TDD fill. |
| `building-a-github-action` | Capability → package → skill routing. Rows route; they do not teach. |
| `actions-*` skills | The per-capability depth (runtime, inputs/outputs, state and secrets, reporting, cache and artifacts, testing). |
| The template repo | The scaffolding that starts a new action already conforming. |

Keep them synchronized in that order: an incident amends this document first, then the skill that teaches the affected step, then the template.

## The canonical repository

```text
action.yml                      # SINGLE SOURCE of input/output names AND defaults
action.config.ts                # builder config: entries, minify, persistLocal, per-need escape hatches
lib/scripts/                    # non-compilable scripts (turbo cache boundary) + bundle-truth guards
src/
  pre.ts                        # OPTIONAL — only when the lifecycle needs it
  main.ts                       # thin: program import + guard, nothing else
  post.ts                       # duration/cleanup; never fails the workflow
  program.ts                    # pure composition: readInputs -> steps -> output fold -> report
  steps/                        # one module per orchestration unit
  services/                     # documented convention: Context.Service classes for shared capability
  shims/                        # documented convention: blessed shims for checked-absent kit surfaces
  layers/app.ts                 # per-entry layers — only when a service must be provided OUTSIDE program
  schema/
    inputs.ts                   # INPUT_NAMES tuple + readInputs
    outputs.ts                  # OUTPUT_NAMES tuple + fold from all-disabled defaults
    domain.ts                   # domain schemas as needed
  state.ts                      # STATE_KEYS + Schema.Class bundles, JSON-safe encoded forms
  format.ts | format/           # THE single rendering surface
  CLAUDE.md                     # src conventions, kept current
__test__/
  unit/                         # mirrors src/ per module
  integration/                  # *.int.test.ts + fixtures/
  utils/                        # doubles and adapters — helper code, not tests
  CLAUDE.md                     # test conventions + the collection contract
vitest.config.ts                # AgentPlugin, strict thresholds, structural placement test, gate on the Tests: line
vitest.setup.ts                 # strips GITHUB_ACTIONS / INPUT_* / STATE_* from the test process env
docs/                           # numbered user docs
.github/workflows/              # act-test, branch-sync, claude, dco, project-listener, release, silk-update, self-dogfood
.github/actions/local/          # committed persistLocal output — the act/CI smoke target
lib/configs/                    # markdownlint-cli2, commitlint, lint-staged
CLAUDE.md                       # how to use this repo + the shim register
package.json                    # deps enter when src imports them; @effected/* at caret; effect + @effect/platform-node from catalog:effect
pnpm-workspace.yaml             # packages [.], autoInstallPeers, configDependencies
tsconfig.json                   # extends @savvy-web/github-action-builder/tsconfig/action.json — nothing else
turbo.json / biome.jsonc / .husky/ / .actrc / .changeset/
dist/                           # committed bundles + a dist-freshness CI check
LICENSE / DCO / CODE_OF_CONDUCT / CONTRIBUTING / SECURITY / README / issue templates / dependabot / devcontainer / .vscode
```

### The manifest and the build config

`action.yml` is the **single source** of input and output names *and* their defaults: `node24`, `runs.pre?`/`main`/`post` pointing at `dist/*.js`, branding, and input documentation annotated with the incidents that make a setting load-bearing (silk-release-action's `github-token` note exists because of run `30228332922`). Code mirrors those defaults; it never re-declares them.

`action.config.ts` carries the builder entries (`pre?`, `main`, `post`, `workers?`), `minify`, and `persistLocal` **enabled** (§[B6](#b6--persistlocal-is-enabled)). The bundler escape hatches — `ignore`, `nativeDynamicImports` — are added **per need, with a forensic comment explaining why that entry exists** (§[B9](#b9--bundler-escape-hatches-are-per-need)), never copied forward from another action.

### `lib/scripts/`

Non-compilable scripts live here per the silk defaults, and that is deliberate rather than incidental: changes under `lib/` invalidate turbo's build cache, which is exactly the behavior a code-generating or bundle-asserting script needs. Bundle-truth guards (§[step 13](#the-design-sequence)) live here **when there is something to assert** — silk-update-action's `assert-native-dynamic-import.mjs`, chained after `build:prod`, is the model. The *slot* is canon; a no-op placeholder in it is not. When [B4](#b4--json-schema-publication-is-conditional-canon) triggers, schema generation is `lib/scripts/generate-schema.ts`.

### `src/`

- **Entries are uniform.** Every entry point ends with the same idiom — `if (process.env.GITHUB_ACTIONS) { /* v8 ignore next */ await Action.run(program, { layer }) }` — so the program stays importable without executing. One idiom on all entries, not one for main and another for post. The idiom only holds if the **test process** does not look like a runner: see [the test-process environment](#the-test-process-environment).
- **Entries are layer-less by default.** The template's entries pass no `layer` at all: `DryRun` and anything else configuration-derived is provided *inside* `program` from the decoded inputs, through `makeAppLayer(value)`. An entry grows a `layer` argument back only when a service must be provided **outside** `program` — before the inputs are decoded, or across a boundary `program` does not own. Starting layer-less and growing on demand is what keeps the "add only what `ActionRuntime.layer` omits" rule honest; starting with a populated `MainLive` invites provisioning that nothing requires.
- **`main.ts` is thin**: a program import and the guard. Nothing else belongs in it.
- **`post.ts` is double-netted**: `catch` *and* `catchDefect`. Post never fails the workflow.
- **`program.ts` is pure composition**: `readInputs` → steps in order → output fold → report. It holds only cross-step joins — no I/O, no formatting, no step bodies.
- **`steps/` are orchestration units, not services.** One module per step, each declaring a result type, a `Data.TaggedError` with a `reason` literal union, and an **explicitly annotated** `R`. Pure decision tables are split from their effectful halves.
- **`services/` is for shared capability only.** A `Context.Service` class earns its place by being used across steps or across actions; a step used once does not become a service.
- **`services/` and `shims/` are documented conventions, not tracked empty directories.** An action that needs neither ships neither; the convention lives in `src/CLAUDE.md` and the shim register lives in the root `CLAUDE.md`, so the slot is discoverable without an empty directory pretending the repo has something in it. (A `.gitkeep` under a convention directory is the same fossil as a no-op guard script.)
- **`layers/app.ts` holds per-entry layers when there are any** — `PreLive`/`PostLive` minimal, `MainLive` full. Add only what `ActionRuntime.layer` omits; require the rest, never rebuild it. `Layer.unwrap` over `ActionInput` only when the layer is genuinely config-dependent; a static `const` otherwise. Configuration passes as values through `makeAppLayer(value, options)` so the layers themselves stay config-free.
- **`schema/inputs.ts`** exports an `INPUT_NAMES` const tuple (names as data) and `readInputs`, decoded **once** and exported separately, carrying cross-field interaction validation. Defaults mirror `action.yml`.
- **`schema/outputs.ts`** exports an `OUTPUT_NAMES` tuple and the fold from **all-disabled defaults**, so every output is emitted exactly once on **every** abort path.
- **`state.ts`** holds `STATE_KEYS` and `Schema.Class` bundles whose every field's *encoded* form is JSON-safe (`Schema.OptionFromNullOr`, never `Schema.Option`), with branded ids where a zero value would be invalid (`ProcessId`).
- **`format.ts` or `format/`** is **the** rendering surface — module or directory, the invariant is that there is one place. Every rendered string, pure and service-free; the log line and the panel row call the same function so they cannot disagree. Built on the kit reporting suite.
- **`shims/`** holds blessed local shims for checked-absent kit surfaces (§[B8](#b8--blessed-shims-live-in-srcshims)).
- **`src/CLAUDE.md`** documents src conventions and must be **current**: silk-release-action's stale one taught the dead predecessor API to the next agent after the migration had already landed.

### `__test__/`

Tests live in `__test__/` only (§[B1](#b1--tests-live-in-__test__-only)): `unit/` mirroring `src/` module for module, `integration/` holding `*.int.test.ts` with real `fixtures/` (silk-update-action's real tarballs and before/after lockfiles are the realism bar), and `utils/` holding doubles — recording wrappers over the kit's `layerTest` (wrapped in `Effect.suspend` so an eager recorder cannot lie), `ScriptedSpawner` adapters. `utils/` is helper code, not tests.

`vitest.config.ts` uses the `AgentPlugin` with strict thresholds and `include: ["src/**/*.ts"]` for coverage, so a never-imported file scores zero rather than vanishing from the report.

**How the collection contract is enforced depends on the runner.** Under the `AgentPlugin`'s project discovery there is no root include glob to narrow, so a config-level include list cannot be the enforcement point. The realization is a **structural placement test** — any `*.test.ts` outside `unit/` or `integration/*.int.test.ts` fails the suite — paired with gating on the `Tests:` line rather than the exit code. Same guarantee as the include-glob form, reached the way the runner actually works: a test file in a place nothing collects becomes a failure instead of a silence.

#### The test-process environment

`vitest.setup.ts` **strips `GITHUB_ACTIONS`, every `INPUT_*` and every `STATE_*` from the test process environment.** This is what lets the uniform entry-guard idiom coexist with running tests inside a runner: without it, a CI test process that imports a guarded entry module satisfies `process.env.GITHUB_ACTIONS` and **executes the action** as an import side effect. The guard is not wrong — the ambient environment is — and the setup file is where that is fixed, once, for the whole suite. Stripping `INPUT_*` and `STATE_*` alongside it keeps a test from silently reading the *host* workflow's inputs or state when a fixture forgets to seed its own.

### Repository scaffolding

`.github/workflows/` carries `act-test.yml` (running `.github/actions/local`, which `persistLocal` produces), `branch-sync`, `claude`, `dco`, `project-listener`, `release`, `silk-update`, and a **self-dogfood workflow** in which the action runs itself, as silk-update-action does in its own repo. `dist/` holds the committed bundles and CI gates their freshness by rebuilding and diffing.

The root `CLAUDE.md` is general "how to use this repo" context **plus the shim register**. The effected Claude Code plugin is installed by default and carries the system knowledge through its skills and agents; the root context file must not duplicate skill content.

## The design sequence

Order matters — this is the sequence in which an action's design decisions are actually forced. Steps 0–2 are `designing-an-action`'s recon and contract phases; the rest fold in the steps the three migrated actions proved were missing.

- **0. Recon against the installed kit.** Inventory the needed capabilities at **construct** level, not package level (effected#188: four capabilities were declared absent in one migration; none of them were). Verify against installed versions, not memory — silk-update-action fossilized a "the kit ships no successor" comment long after `GitHubMarkdown`, `CheckState`, `ManagedDocument` and `CheckDocument` had landed. Record what genuinely *is* absent; those become shims. Re-run this step on every kit bump.
- **1. Freeze the I/O contract.** Inputs and outputs as data: `NAMES` const tuples, defaults written once in `action.yml` and mirrored — never duplicated — in code. Line-list inputs first; a JSON input only for genuinely nested structure (§[B5](#b5--line-list-inputs-first)), which then triggers the schema-publication machinery (§[B4](#b4--json-schema-publication-is-conditional-canon)). Design the cross-field interaction validation now (enum-or-range, disjointness, "at least one active"; silk-update-action's `readInputs` is the model), and plan the three-way sync test between `action.yml`, `INPUT_NAMES` and the decoded shape.
- **2. Choose phases deliberately.** pre/main/post is not a default — silk-runtime-action ships main plus post, silk-update-action all three. `pre` exists to fail fast on credentials; `post` exists for cleanup that must never fail the workflow. A layer-less entry is legitimate when `pre` provisions everything `main` reads back.
- **3. Design cross-phase state as schemas.** `Schema.Class` bundles under `STATE_KEYS`; every field's encoded form must survive `JSON.stringify` → `GITHUB_STATE` → `JSON.parse` (`OptionFromNullOr`, never `Schema.Option` — otherwise main reports a successful save that post cannot decode). Brand ids whose zero value is invalid.
- **4. Place the token lifecycle, if the action uses App auth.** `GitHubToken.provision` in `pre` **with required-scope verification**, so a misconfigured installation fails in pre rather than as a 403 halfway through main; the envelope persists to `ActionState`; `clientLayer()` in main; **unconditional revoke** in post, under `catchDefect`.
- **5. Set the secret-masking policy.** Mask everything supplied *before* any decision about whether it will be used (silk-runtime-action's `maskSuppliedSecrets`). A plaintext appears only through a named `Secret.*` member; a new declassification need is a new member, never an inline `Redacted.value`.
- **6. Decide failure posture per step.** Three tiers: fail the job; degrade to a warning (the tagged error is "the shape a failure takes before it is logged"); or double-net with `catch` plus `catchDefect` (post, summary writes). **Fail the effect — never `setFailed` and return**: silk-release-action's `errors.ts` cites the incident by run id where 4 of 8 targets failed and the run reported green. Outputs are emitted on every abort path.
- **7. Audit the error taxonomy.** The mirror rule: **no error class without a constructor site, and no `new Error` where a step failure needs a tag.** silk-update-action shipped 5 dead classes out of 8 while its real failures used untyped `Error`; silk-runtime-action carried a phantom `reason` literal with no producer.
- **8. Compose layers minimally.** Start layer-less — provide configuration-derived services inside `program` from the decoded inputs — and grow a per-entry layer only when a service must be provided outside `program`. Add only what `ActionRuntime.layer` omits; `Layer.unwrap` only when config-dependent; bind shared layers to a single `const`, because memoization is by reference. Prove there is no over-provision with a typed `ActionServices` test double — an added requirement must fail to compile (silk-runtime-action's `layers.test.ts`).
- **9. Design reporting on one stack.** The kit suite — `GitHubMarkdown`, `CheckState`, `CheckDocument`, `ManagedDocument` — conditioned on what the installed kit actually covers; a genuine gap goes through a shim, not a hand-rolled namespace object. (silk-release-action accreted three and a half markdown stacks; silk-update-action re-implemented one the kit already shipped.) Check conclusions include `neutral`. Sticky comments follow silk-release-action's five managed-section rules: write the running state before doing the work, never blank a section, sha-stamp staleness, keep sections independent, and write monotonically. **Payload budgets are a design step**: the 65535-byte check-body cap forced silk-release-action to strip release notes at runtime — design the truncation instead of discovering it.
- **10. Write the logging contract.** A run-context opening block; the detect-headline pattern (what was detected first, evidence at debug); every skipped step logging `Step: X — SKIPPED: <reason>`; warnings reserved for acceptance signals; a closing Result block. Enforce it with a test that asserts on the captured log stream — the log **is** the decision record.
- **11. Compose steps into a pipeline.** One module per step; `program.ts` is pure composition holding only cross-step joins; the output fold starts from all-disabled defaults so a feature that never ran still reports its default. silk-update-action's 550-line comment-divider `innerProgram` is the recorded anti-pattern; silk-runtime-action's `steps/` is the model.
- **12. Plan the tests with the structure.** The doubles convention (unstubbed members die loudly); the realism gradient — real detectors over temp fixtures, kit in-memory layers, faked domain services with spies; the three-way input sync test; log-stream assertions; mutate the edges before declaring green. On a migration: **doubles first, runner conversion separately** (effected#185) — the passing suite is the characterization gate, and converting the runner installs a `TestClock` at the epoch, so doing both at once rewrites the gate alongside the thing it gates.
- **13. Verify bundle truth.** `dist` is the artifact, and vitest runs source, so the suite can never see a bundle failure. Guard native dynamic imports (silk-update-action's assert script fails the build when the magic comment is deleted). Build-time data decode failures are **defects**, never degraded to empty: update#187 turned a broken bundle into a truthful-sounding "no versions found" via `orElseSucceed(() => [])`. Prefer bundle-safe standalone functions to post-class static aliases (`Range.parse` and tree-shaking). CI does a rebuild-and-diff dist-freshness check.
- **14. Refresh the docs — it is in the definition of done.** All three tiers of `CLAUDE.md` (root, `src/`, `__test__/`) current; kit-surface claims re-verified against the installed version; the shim register re-audited. silk-release-action's stale docs taught the dead predecessor API to the next agent that read them.

### Cross-cutting invariants

- **Dependency honesty.** Every declared `@effected/*` dependency is either imported by `src/` **or** is a required peer dependency of another declared dependency — peer closures are legitimate un-imported dependencies. The structural import-walker test must resolve the peer closure before flagging anything; silk-runtime-action appeared to declare 10 unused dependencies out of 16, and which of those were peer-required had to be established before deleting any.
- **Dependency honesty outranks any suggested starting set.** A scaffold declares only what its own `src/` imports — the template ships `@effected/github-actions`, `effect` and `@effect/platform-node` and nothing else. There is no "common set" of `github`/`commands`/`semver` to pre-declare: a dependency enters when a step imports it, and the optional App-auth chapter documents adding `@effected/github` as part of the edit that lands `pre.ts`. A pre-declared dependency is an unused one on day one, which is exactly the state the invariant exists to forbid — and it teaches the scaffold's first reader that unused declarations are normal.
- **Kit-static seams are defaulted parameters, not service wrappers.** silk-runtime-action's `DetachedProcessOps` is the shape: a seam that keeps `R` — and therefore every consumer's layer stack — unchanged.
- **`ActionEnvironment` is the only environment authority.** Ambient `process.env` appears only at named bridge sites (release#192: duplicate `GITHUB_SHA` reads with divergent fallbacks).
- **No `as never` on the `R` channel** (release#192). A dropped layer must fail to compile, not die at runtime; production entry points are zero-arg by construction.
- **Known kit workarounds stay documented until they are fixed.** `CheckRun.withCheckRun` requires `R = never`, so the app layer ends up provided twice (an upstream fix is wanted); the `env.isDebug → References.MinimumLogLevel` bridge is a named snippet every action repeats.

## Resolved rules

### B1 — Tests live in `__test__/` only

`unit/` plus `integration/*.int.test.ts`. Rider: the collection contract is enforced executably and the gate is the `Tests:` line, never the exit code. Evidence: silk-release-action carried three coexisting test layouts, and `__test__/utils/*.test.ts` was silently never collected — a green exit code over tests that never ran.

The rider's *form* follows the runner. Under the `AgentPlugin`'s project discovery there is no root include glob to narrow, so the template realizes it as a **structural placement test** (any `*.test.ts` outside the two sanctioned locations fails the suite) rather than an include list plus a collected-count assertion. What is canon is that an uncollected test file must produce a failure; which mechanism produces it is the runner's business.

### B2 — `it.effect` plus `assert.*` is template canon

Migrations convert doubles first and the runner later (effected#185). Rider: a structural test asserts that `@effect/vitest` is actually **imported**, because declared-but-never-imported is otherwise invisible — silk-update-action shipped exactly that.

### B3 — Token-minimal core, App auth as a complete optional module

Ratified 2026-08-03. The default path needs no App credentials: silk-runtime-action legitimately ships no `pre`, and the predecessor template's mandatory app inputs made the simplest possible action un-scaffoldable. The App-auth module is a **working** `pre`/`post` pair plus the `action.yml` block (following silk-release-action), with the exact recipe documented in both directions — add: create `pre.ts` and `PreLive`, add the two inputs, swap the token input for `clientLayer()`; remove: the inverse. Rider: because the default path no longer demonstrates it, the skill side must carry a strong, complete "implement tokens the right way" recipe covering the full lifecycle — hence the depth in [`github-app-tokens`](../../../plugin/skills/github-app-tokens/SKILL.md).

### B4 — JSON Schema publication is conditional canon

Mandatory whenever a JSON contract crosses the action boundary, input or output: Effect Schema → [`@effected/schemastore`](packages/schemastore.md) → committed, ajv-validated, drift-tested files. silk-release-action's `generate-schema` proves the value, but it predates the package — new work uses `StoreDocument`, not a hand-rolled lowering. Flat, line-list actions skip this entirely.

### B5 — Line-list inputs first

JSON inputs only for genuinely nested structure, which then triggers B4. silk-update-action's line-lists read better in workflow YAML; silk-release-action's `SilkReleaseConfig` earned its JSON.

### B6 — `persistLocal` is enabled

It feeds `.github/actions/local` and the `act`-test smoke loop. Disabled by default, local verification is dead on arrival; two of the three migrated actions enable it.

### B7 — Caret ranges for `@effected/*` until the kit reaches 1.0

silk-update-action automates the bump. Rider: every kit bump's definition of done includes re-verifying kit-surface claims — comments, shims, `CLAUDE.md` — against the new version. The fossilized "no successor" comment is the failure mode this rider exists to prevent.

### B8 — Blessed shims live in `src/shims/`

One module per missing contract, named for it (`shims/git-mutations.ts`), with a **mandatory header contract**: which kit surfaces were checked absent and at which versions, a tracking issue link, and the removal condition. The shim directory is re-audited on every kit bump.

"Wait for the kit" fails silently, which is why the shim slot exists: effected#193 found 15+ raw git spawns in the *most* migrated repo, and effected#194 found two drifting copies of the same closes-keyword regex.

**Upstream-migration protocol (ratified).** Agents watch for code that should migrate upstream into `@effected/github-actions` or another kit package. When such code is spotted, **ask the user** whether to dogfood the change upstream now or write a shim; either way, file an issue in `effected` plus a linked tracking ticket in the source repo.

*Revisable:* the alternative placement considered was colocate-by-role (shims living beside the code that uses them, rather than in one directory). It is recorded and not adopted; the directory form wins on auditability, since a register of missing kit surfaces is only useful if it is in one place.

### B9 — Bundler escape hatches are per-need

`ignore` and `nativeDynamicImports` entries enter an `action.config.ts` only when that action's graph requires them — the cyclonedx trio enters only when `sbom` is in the graph. The **forensic comments** explaining why each entry exists (silk-release-action's and silk-update-action's configs) are preserved as the reusable asset in `docs/` and in the skills: the pattern is canon, an inert copy of someone else's entries is not.

*Revisable:* the alternative considered was baking a standard entry set into the template. It is recorded and not adopted; a copied escape hatch outlives the reason it was added, and nothing fails when it is wrong.

## Hazards

Consider each of these before building; none of them produces a compile error, which is why they are written down.

1. **effected#198 — the macOS npm cache.** GitHub's macOS runners ship a partly root-owned `~/.npm/_cacache` and `npm pack` dies with `EACCES`. The predecessor's `npmCacheArgs()` splice was lost in the port and 11 of 11 publish targets failed on the first real run. Until `NpmExecutor` grows `cacheDir`/`extraArgs`, the redirect must be visible **at the call site** — never an invisible environment variable.
2. **effected#195 — three silent failures.** `PullRequest.list({ head })` wants `owner:ref` and the projection hands back a bare ref, so it returns nothing without erroring; `GitTag.latestSemver` orders by version rather than recency, pinning a monorepo boundary backwards and silently; `Schema.Redacted` encodes to the literal `<redacted>`, so persisting through it round-trips something useless.
3. **effected#193 and #194 — missing-kit-surface residue.** Raw git spawns and copy-pasted regex drift are what "wait for the kit" produces in practice. Route through B8 shims with tracking issues.
4. **effected#188 — capability discoverable only by name.** Four surfaces were declared absent in one migration and none of them were. Recon (step 0) is construct-level against installed source; the plugin's generated construct index is the systemic fix.
5. **effected#185 — testing-migration ordering.** Doubles first, runner conversion separately. A characterization gate rewritten alongside the thing it gates is not a gate.
6. **update#187 — bundle-time silent-empty.** Never degrade a build-time data decode: `orElseSucceed(() => [])` turned a broken bundle into truthful-sounding emptiness. Prefer bundle-safe standalone functions to class-static aliases.
7. **release#192 — `R`-channel erasure and environment shadowing.** No `as never` casts; one environment authority; published schemas must match the declared struct; no silent `provenance: false` downgrade on a retry path.
8. **Structural — the template itself is unmigrated.** Zero open issues is not readiness: the template still advertises the predecessor, ships empty entry files and has no tests. Treat it as greenfield and import its requirements from the consumers' record rather than from its own contents.

## The template repo

`savvy-web/github-action-template` is the worked example, **regenerated to this specification on branch `feat/effected-migration` as one coherent commit**, with every verification gate green — including a runner-style smoke test of the built bundles, which is the only check that sees what `vitest` structurally cannot. The regeneration produced five refinements that are folded into the rules above rather than kept as a template-only appendix: the dependency set, layer-less entries, the placement-test realization of B1's rider, `services/`/`shims/` as conventions rather than tracked empty directories, and the test-process environment rule (which is new canon, not a restatement). The plan it executed was keep / kill / build.

**Keep — verified current:** `pnpm-workspace.yaml` exactly as it stands (its `configDependencies` already match all three migrated actions); `tsconfig`, `turbo`, `biome`, `husky` and `lib/configs`; the devDependency trio (builder, silk, vitest-agent); repository hygiene (LICENSE, DCO, code of conduct, contributing, security, issue templates, dependabot, devcontainer, `.vscode`, `.actrc`); the `branch-sync`, `claude`, `dco`, `release` and `silk-update` workflows; `.changeset/config.json` with a templated `repo` field; the `action.yml` skeleton (node24, dist entries, branding); and the vitest `AgentPlugin` shape, upgraded to the config described above.

**Kill:** `@savvy-web/github-action-effects` ^3.1.0 (the dead predecessor); the three zero-byte `src` entries; `lib/scripts/generate-schema.ts` (a commented-out corpse leaked from silk-release-action) along with the broken `generate:schema` script and the `ajv` devDependency; `.github/workflows/branch-sync copy.yml` (tracked junk); the stale `types/global.d.ts`; every "github-action-effect" wording in the README, `action.yml` and description; the coverage `none` thresholds; and `--pass-with-no-tests` on `ci:test`.

**Build, to the structure above:** `@effected/github-actions`, `effect` and `@effect/platform-node` as the **whole** runtime dependency set, plus `@effect/vitest` — dependency honesty decides the list, so nothing else is declared until `src/` imports it; the working skeleton — layer-less uniform-guard entries, `program.ts`, one demo step in `steps/` that exercises a SKIPPED path, `state.ts` demonstrating a start-time → duration round trip, `schema/inputs.ts` and `outputs.ts` with the three-way sync test, and `format.ts`; `__test__/unit` with real `it.effect` tests (program log stream, state round-trip, input sync) plus the structural tests (dependency honesty, `@effect/vitest` imported, test placement); `vitest.setup.ts` scrubbing the runner variables; `act-test.yml`, `project-listener.yml` and the self-dogfood workflow; `persistLocal: enabled`; the effected Claude Code plugin installed by default via marketplace config, matching the migrated actions, with the three-tier `CLAUDE.md` written as general how-to-use-this-repo docs that lean on the plugin's skills and agents, and carrying the `services/`/`shims/` conventions and the shim register; `docs/` including the App-auth optional chapter (B3, which documents adding `@effected/github` as part of landing `pre.ts`) and the forensic-comment library (B9); the `ci:version` and `claude` scripts; and the dist-freshness check.

`package.json` scripts settle at `ci:version` (savvy changeset version), `claude` (with `--plugin-dir`), `validate`, and `ci:test = vitest run --coverage` with **no** `--pass-with-no-tests`.

**Delivery rule.** The regeneration landed as **one coherent commit**, and any future one does the same. The half-migrated state it replaced — a current `pnpm-workspace.yaml` sitting next to dead dependencies — had two auditors reading opposite conclusions from adjacent files. The template is never patched incrementally across the old/new boundary.
