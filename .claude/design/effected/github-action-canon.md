---
status: current
module: effected
category: architecture
created: 2026-08-04
updated: 2026-09-04
last-synced: 2026-09-02
completeness: 90
related:
  - plugin.md
  - effect-standards.md
  - releases.md
  - packages/github-actions.md
  - packages/github-actions-reporting.md
  - packages/github.md
  - packages/sbom.md
  - packages/schemastore.md
  - consumers/README.md
  - consumers/silk-release-action.md
  - consumers/silk-runtime-action.md
  - consumers/silk-update-action.md
  - packages/memfs.md
---

# GitHub Action repository canon

## Overview

This is the canonical shape of a GitHub Action repository built on `@effected` — its file layout, the order its pieces are designed in, the rules that are settled, and the hazards that must be considered before building. It is the register for **why** each rule exists; the teaching surface is the plugin's Actions skill suite ([plugin.md](plugin.md#skill-catalog)), entered through [`building-a-github-action`](../../../plugins/claude-code/skills/building-a-github-action/SKILL.md) for capability routing, [`designing-an-action`](../../../plugins/claude-code/skills/designing-an-action/SKILL.md) for the build sequence, and [`structuring-an-action`](../../../plugins/claude-code/skills/structuring-an-action/SKILL.md) for the repository shape. The skills state the rules timelessly for a reader in a consumer repository; the incidents, run ids and issue numbers that justify them stay here.

The canon was derived from the three actions that completed the migration onto `@effected/github-actions` — **silk-release-action**, **silk-runtime-action** and **silk-update-action** — audited construct by construct against their shipped source, incidents and issue trails. Their migration maps (what came from where) live under [consumers/](consumers/README.md); this document records what the three of them, taken together, prove a fourth action should look like.

**Every rule here is anchored to an incident.** Nothing in the canon is a style preference: each item cites the run, issue or file where its absence cost something. This is deliberately the one place in the design docs that keeps run ids and issue numbers — the [skills that teach these rules](plugin.md#skill-catalog) strip them, because their reader is in a consumer repo and cannot act on them. Where the three actions disagreed, the disagreement is resolved below with the evidence that settled it; where the resolution was a judgement call rather than a forced one, it is marked revisable rather than silently hardened.

The worked example is **savvy-web/github-action-template**, which has been regenerated to this specification (§[The template repo](#the-template-repo)). The template is the executable copy of this document; when the two disagree, this document is the register and the template is the bug — unless the template's divergence is itself a new incident, in which case it amends the canon.

### Division of labor with the skills

| Surface | Owns |
| --- | --- |
| This document | The rules, the rationale, the incident citations, the resolved decisions and their revisability. |
| `designing-an-action` | The build sequence as a process an agent executes — recon, frozen spec, API dossier, walking skeleton, TDD fill. |
| `structuring-an-action` | The repository shape this document specifies, taught as an annotated tree with structural standards a consumer-repo reader can apply directly. |
| `building-a-github-action` | Capability → package → skill routing. Rows route; they do not teach. |
| `actions-*` skills | The per-capability depth (runtime, inputs/outputs, state and secrets, reporting, cache and artifacts, testing). |
| The template repo | The scaffolding that starts a new action already conforming. |

Keep them synchronized in that order: an incident amends this document first, then the skill that teaches the affected step, then the template.

## The canonical repository

```text
action.yml                      # SINGLE SOURCE of input/output names AND defaults
action.config.ts                # builder config: entries, minify, persistLocal, per-need escape hatches
lib/scripts/                    # non-compilable scripts (turbo cache boundary) + bundle-truth guards
schemas/<version>/<name>-<version>.json   # versioned OUTPUT contract; the version label is full SemVer (B4)
<action>.input.schema.json                # unversioned INPUT schema at root, only when B4 fires for an input
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

**Where a committed schema lives follows whether consumers pin it.** A structured `result` output that payloads reference by `$schema` is **versioned**: `schemas/<version>/<name>-<version>.json`, the directory carrying the same label as the file so a version's artifacts stay together while the file name remains the one SchemaStore resolves (silk-release-action). An input schema is unversioned at the repository root. A documentation-facing document nobody pins may live under `docs/schema/` (silk-update-action's `run-result.schema.json`). What is canon is one generator, one committed artifact, one `SchemaPipeline.check` drift test; the directory follows the pinning question.

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
- **`steps/` are orchestration units, not services.** One module per step, each declaring a result type, a typed error **only when the step can fail** — one class with a closed `reason` union when every reason carries the same fields, one class per failure behind a union alias otherwise (the shape the kit's own `ActionOutputError` moved to) — and an **explicitly annotated** `R`. **The module doc states the failure posture beside the error channel**: `fail-the-job`, `degrade-to-warning`, or `double-netted`. A `never` channel that means "this degrades" is annotated, not inferred, so a kit upgrade that widens a member's channel is a build error at that line rather than a silently failed job (silk-runtime-action `post.ts`). "Declared and never raised" is a legitimate posture when the module says so — it keeps a contract open without making today's tolerance a lie — and is distinct from a dead class with no constructor site. Pure decision tables are split from their effectful halves.
- **`services/` is for shared capability only.** A `Context.Service` class earns its place by being used across steps or across actions; a step used once does not become a service.
- **`services/` and `shims/` are documented conventions, not tracked empty directories.** An action that needs neither ships neither; the convention lives in `src/CLAUDE.md` and the shim register lives in the root `CLAUDE.md`, so the slot is discoverable without an empty directory pretending the repo has something in it. (A `.gitkeep` under a convention directory is the same fossil as a no-op guard script.)
- **`layers/app.ts` holds per-entry layers when there are any** — **`MainLive` / `PreLive` / `PostLive` are the action's own naming convention for its per-entry layers, not kit exports** — the kit ships `ActionRuntime.layer` and each service's `static readonly layer`. `PreLive`/`PostLive` minimal, `MainLive` full. Add only what `ActionRuntime.layer` omits; require the rest, never rebuild it. `Layer.unwrap` over `ActionInput` only when the layer is genuinely config-dependent; a static `const` otherwise. Configuration passes as values through `makeAppLayer(value, options)` so the layers themselves stay config-free.
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
- **7. Audit the error taxonomy.** The mirror rule: **no error class without a constructor site, and no `new Error` where a step failure needs a tag** — and pick the class shape by the two-shapes test in the `steps/` bullet above, not by habit. silk-update-action shipped 5 dead classes out of 8 while its real failures used untyped `Error`; silk-runtime-action carried a phantom `reason` literal with no producer.
- **8. Compose layers minimally.** Start layer-less — provide configuration-derived services inside `program` from the decoded inputs — and grow a per-entry layer only when a service must be provided outside `program`. Add only what `ActionRuntime.layer` omits; `Layer.unwrap` only when config-dependent; bind shared layers to a single `const`, because memoization is by reference. Prove there is no over-provision with a typed `ActionServices` test double — an added requirement must fail to compile (silk-runtime-action's `layers.test.ts`).
- **9. Design reporting on one stack.** The kit suite — `GitHubMarkdown`, `CheckState`, `CheckDocument`, `ManagedDocument` — conditioned on what the installed kit actually covers; a genuine gap goes through a shim, not a hand-rolled namespace object. (silk-release-action accreted three and a half markdown stacks; silk-update-action re-implemented one the kit already shipped.) Check conclusions include `neutral`. Sticky comments follow silk-release-action's five managed-section rules: write the running state before doing the work, never blank a section, sha-stamp staleness, keep sections independent, and write monotonically. **Two of those five are now kit mechanism rather than discipline**: `CheckDocument` takes a per-run `stamp` and drops a pass whose stamp is older than the document's, and its sink takes an optional read-back so a pass reconciles against the *live* document instead of what this process last wrote ([the guard](packages/github-actions-reporting.md#the-staleness-guard-two-runs-one-document)). So the design step is now to **decide whether the action can have two runs in flight against one document** — a re-run over a slow original, two events on one pull request — and to mint the stamp once at startup if it can; hand-rolling staleness on top is a second answer to a question the reconciler already answers. **Payload budgets are a design step**: the 65535-byte check-body cap forced silk-release-action to strip release notes at runtime — design the truncation instead of discovering it.
- **10. Write the logging contract.** A run-context opening block; the detect-headline pattern (what was detected first, evidence at debug); every skipped step logging `Step: X — SKIPPED: <reason>`; warnings reserved for acceptance signals; a closing Result block. Enforce it with a test that asserts on the captured log stream — the log **is** the decision record.
- **11. Compose steps into a pipeline.** One module per step; `program.ts` is pure composition holding only cross-step joins; the output fold starts from all-disabled defaults so a feature that never ran still reports its default. silk-update-action's 550-line comment-divider `innerProgram` is the recorded anti-pattern; silk-runtime-action's `steps/` is the model.
- **12. Plan the tests with the structure.** The doubles convention (unstubbed members die loudly); the realism gradient — real detectors over temp fixtures, kit in-memory layers, faked domain services with spies; **the filesystem double is [`@effected/memfs`](packages/memfs.md), never a hand-rolled `FileSystem.layerNoop` over a `Map`** ([the rule and its three riders](effect-standards.md#the-filesystem-double-is-a-real-volume)); the three-way input sync test; **the three legs are the manifest, the names tuple, and a recorded scan of what `src/` actually reads and writes — the two declaration legs drift together, so only the recorded legs find anything** (silk-release-action `__test__/utils/manifest.ts`: a dead `build-command` read and a no-op `custom-registries` input each survived for months with two legs agreeing); log-stream assertions; mutate the edges before declaring green. On a migration: **doubles first, runner conversion separately** (effected#185) — the passing suite is the characterization gate, and converting the runner installs a `TestClock` at the epoch, so doing both at once rewrites the gate alongside the thing it gates.
- **13. Verify bundle truth.** `dist` is the artifact, and vitest runs source, so the suite can never see a bundle failure. Guard native dynamic imports (silk-update-action's assert script fails the build when the magic comment is deleted). Build-time data decode failures are **defects**, never degraded to empty: update#187 turned a broken bundle into a truthful-sounding "no versions found" via `orElseSucceed(() => [])`. Prefer bundle-safe standalone functions to post-class static aliases (`Range.parse` and tree-shaking). Minifier-aware source is part of bundle truth: a shell string carrying `${…}` inside a template literal survived `tsc` and vitest and died at module load in the minified bundle (silk-runtime-action `install-bats.ts`); the fix is a targeted lint suppression on a plain literal, never a workaround that the minifier can rewrite. CI does a rebuild-and-diff dist-freshness check.
- **14. Refresh the docs — it is in the definition of done.** All three tiers of `CLAUDE.md` (root, `src/`, `__test__/`) current; kit-surface claims re-verified against the installed version; the shim register re-audited. silk-release-action's stale docs taught the dead predecessor API to the next agent that read them. Context files are **post-mortem-shaped**: each non-obvious rule names the incident, the wrong explanation believed first, and the guard, and where a count or version is load-bearing the file tells the reader to re-derive it rather than cite it. A `refs.json` SHA-256 ledger binding each context file to the design doc it cites makes drift detectable (all three actions carry one).

### Cross-cutting invariants

- **Dependency honesty.** Every declared `@effected/*` dependency is either imported by `src/` **or** is a required peer dependency of another declared dependency — peer closures are legitimate un-imported dependencies. The structural import-walker test must resolve the peer closure before flagging anything; silk-runtime-action appeared to declare 10 unused dependencies out of 16, and which of those were peer-required had to be established before deleting any.
- **Dependency honesty outranks any suggested starting set.** A scaffold declares only what its own `src/` imports — the template ships `@effected/github-actions`, `effect` and `@effect/platform-node` and nothing else. There is no "common set" of `github`/`commands`/`semver` to pre-declare: a dependency enters when a step imports it, and the optional App-auth chapter documents adding `@effected/github` as part of the edit that lands `pre.ts`. A pre-declared dependency is an unused one on day one, which is exactly the state the invariant exists to forbid — and it teaches the scaffold's first reader that unused declarations are normal.
- **Kit-static seams are defaulted parameters, not service wrappers.** silk-runtime-action's `DetachedProcessOps` is the shape: a seam that keeps `R` — and therefore every consumer's layer stack — unchanged.
- **`ActionEnvironment` is the only environment authority.** Ambient `process.env` appears only at named bridge sites (release#192: duplicate `GITHUB_SHA` reads with divergent fallbacks).
- **No `as never` on the `R` channel** (release#192). A dropped layer must fail to compile, not die at runtime; production entry points are zero-arg by construction.
- **Known kit workarounds stay documented until they are fixed, and deleted when they are.** The live one is the `env.isDebug → References.MinimumLogLevel` bridge, a named snippet every action repeats. The register is only useful if a fixed entry leaves it: `CheckRun.withCheckRun` once forced `R = never`, so the app layer got provided twice — it is polymorphic in `R` now, and an action still carrying that workaround is carrying dead weight.

## Resolved rules

### B1 — Tests live in `__test__/` only

`unit/` plus `integration/*.int.test.ts`. Rider: the collection contract is enforced executably and the gate is the `Tests:` line, never the exit code. Evidence: silk-release-action carried three coexisting test layouts, and `__test__/utils/*.test.ts` was silently never collected — a green exit code over tests that never ran. **The exclusion is by directory *name*, at any depth**: `utils`, `fixtures` and `snapshots` are helper directories to the runner's project discovery, so `__test__/unit/utils/` is skipped too (silk-release-action #237: 5 suites, 60 cases, after a plugin update widened the rule). The mirror for `src/utils/` is therefore `__test__/unit/utilities/`. A dated collection map has a shelf life — re-probe rather than trust it; silk-release-action's was probe-verified 2026-08-05 and false by 2026-08-14.

The rider's *form* follows the runner. Under the `AgentPlugin`'s project discovery there is no root include glob to narrow, so the template realizes it as a **structural placement test** (any `*.test.ts` outside the two sanctioned locations fails the suite) rather than an include list plus a collected-count assertion. What is canon is that an uncollected test file must produce a failure; which mechanism produces it is the runner's business.

### B2 — `it.effect` plus `assert.*` is template canon

Migrations convert doubles first and the runner later (effected#185). Rider: a structural test asserts that `@effect/vitest` is actually **imported**, because declared-but-never-imported is otherwise invisible — silk-update-action shipped exactly that.

### B3 — Token-minimal core, App auth as a complete optional module

Ratified 2026-08-03. The default path needs no App credentials: silk-runtime-action legitimately ships no `pre`, and the predecessor template's mandatory app inputs made the simplest possible action un-scaffoldable. The App-auth module is a **working** `pre`/`post` pair plus the `action.yml` block (following silk-release-action), with the exact recipe documented in both directions — add: create `pre.ts` and `PreLive`, add the two inputs, swap the token input for `clientLayer()`; remove: the inverse. Rider: because the default path no longer demonstrates it, the skill side must carry a strong, complete "implement tokens the right way" recipe covering the full lifecycle — hence the depth in [`github-app-tokens`](../../../plugins/claude-code/skills/github-app-tokens/SKILL.md).

### B4 — JSON Schema publication is conditional canon

Mandatory whenever a JSON contract crosses the action boundary, input or output: Effect Schema → [`@effected/schemastore`](packages/schemastore.md) → committed, ajv-validated, drift-tested files. silk-release-action's `generate-schema` proves the value, but it predates the package — new work uses `StoreDocument`, not a hand-rolled lowering. Flat, line-list actions skip this entirely.

The whole loop is a shipped `schemastore` surface and an action repo should write none of it by hand: `SchemaPipeline.run` is the generate → lint → validate → gate → write sequence, `SchemaValidator.layer` is a real ajv engine rather than an adapter the repo writes, and the drift test is `SchemaPipeline.check` — **not** a text comparison of the committed file, because `write` compares parsed content and a repo whose formatter touches JSON will otherwise report drift forever ([packages/schemastore.md](packages/schemastore.md#write-if-changed-compares-content-not-bytes)). Version labels in emitted file names are full three-component SemVer.

Three riders, each from a shipped generator:

- **Gate before writing.** The generator runs `SchemaPipeline.check(targets)` first and aborts on any target whose `change === "contract"` until the version label and `$id` are bumped together. `check` is total over targets, so a repo with two broken documents learns about both in one run. Failing after the write would report the problem accurately and still have caused it. (silk-release-action `lib/scripts/generate-schema.ts`.)
- **The drift test imports the generator's own exported `targets`.** A test that rebuilds its own target list passes while the generator emits something else; asserting `SchemaPipeline.check` over the shared constant is the whole point. Assert both halves: `blocked` false and `DocumentDiff.isClean(change)`, because a document the gate would never write also reports no pending write. (silk-update-action `__test__/unit/generate-schema.test.ts`.)
- **Machine hints are `description` only, today.** `KeywordFamilies` is closed to the vscode, taplo, tombi and intellij families and forbids forking; an `x-ai-*` key is dropped at the Draft-07 lowering. Field-level prose for an LLM consumer goes in `description`. A declared machine-annotation family is tracked in [effected#598](https://github.com/spencerbeggs/effected/issues/598) and generator scaffolding in [effected#599](https://github.com/spencerbeggs/effected/issues/599); the skill side must not promise either.

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

### B10 — Emit the output baseline first

`emitOutputs(initialOutputs)` runs **before any work**, not from an `Effect.onError` handler, and every later exit path writes the full output set. A failure handler that re-emits the baseline overwrites an output describing work that actually happened: silk-update-action's `pr-number` for a pull request that really opened would have been blanked by a later custom-command failure. "Emitted on every abort path" is satisfied by the up-front write; the `onError` form is the recorded anti-pattern and the template carried it. The residual gap — an unexpected failure between steps after one of them did consumer-visible work — is closed at the step: a step whose result must survive a later failure (a created pull request, a pushed tag) emits its own output as soon as it lands, so later writes only ever add to an earlier one and nothing re-publishes the baseline over it. Evidence: silk-update-action `src/program.ts` (`program`, the baseline emit preceding `readInputs`).

### B11 — The layers proof is compile-time and two-sided

A test asserts `[Exclude<AppLayerRequirements, ActionServices>] extends [never]` **and**, separately, `[Exclude<ProgramRequirements, ActionServices>] extends [never]`. The second half exists because a service resolved inside a step *method* is invisible to the layer's input channel, so the first assertion alone passed while production died on every consumer. Two incidents in one repo, both under a clean typecheck and a green suite (silk-update-action `__test__/unit/layers/app.test.ts`, the `PackageJsonFile` and `WorkspaceCatalogs` deaths). silk-runtime-action's `layers.test.ts` builds `MainLive`/`PostLive` against a doubled `ActionServices` subset for the same effect. A runtime assertion is not an acceptable substitute: a compile failure cannot regress silently.

## Hazards

Consider each of these before building; none of them produces a compile error, which is why they are written down.

1. **effected#198 — the macOS npm cache.** GitHub's macOS runners ship a partly root-owned `~/.npm/_cacache` and `npm pack` dies with `EACCES`. The predecessor's cache-args splice was lost in the port and 11 of 11 publish targets failed on the first real run. `NpmExecutor` now owns the redirect (`withCacheDir`, plus `extraArgs` for the general case), so the hazard is no longer *how* to splice it but remembering that it is needed at all — and the redirect stays visible **at the call site**, never an invisible environment variable.
2. **effected#195 — three silent failures.** `PullRequest.list({ head })` wants `owner:ref` and the projection hands back a bare ref, so it returns nothing without erroring; `GitTag.latestSemver` orders by version rather than recency, pinning a monorepo boundary backwards and silently; `Schema.Redacted` encodes to the literal `<redacted>`, so persisting through it round-trips something useless.
3. **effected#193 and #194 — missing-kit-surface residue.** Raw git spawns and copy-pasted regex drift are what "wait for the kit" produces in practice; both gaps have since closed into `@effected/git`'s mutating tier and `@effected/github-references`. The hazard is the pattern, not those two surfaces: route a genuine gap through a B8 shim with a tracking issue, and re-audit the shim register when the issue closes.
4. **effected#188 — capability discoverable only by name.** Four surfaces were declared absent in one migration and none of them were. Recon (step 0) is construct-level against installed source; the plugin's generated construct index is the systemic fix.
5. **effected#185 — testing-migration ordering.** Doubles first, runner conversion separately. A characterization gate rewritten alongside the thing it gates is not a gate.
6. **update#187 — bundle-time silent-empty.** Never degrade a build-time data decode: `orElseSucceed(() => [])` turned a broken bundle into truthful-sounding emptiness. Prefer bundle-safe standalone functions to class-static aliases.
7. **release#192 — `R`-channel erasure and environment shadowing.** No `as never` casts; one environment authority; published schemas must match the declared struct; no silent `provenance: false` downgrade on a retry path.
8. **Structural — zero open issues is not readiness.** The state that produced this hazard was a template with a clean issue tracker that nonetheless advertised the dead predecessor, shipped empty entry files and had no tests. Audit a scaffold against the consumers' record, never against its own issue count.
9. **Fossilized context files.** silk-runtime-action's `src/CLAUDE.md` directs the agent to `docs/superpowers/reference/legacy-v1/` as the behavioural oracle for ~80 `oracle N` / `ruling N` / `quirk N` citations in source — a tree that no longer exists in the repo. All three actions' root `CLAUDE.md` files name deleted workflows (`release-sync.yml`), renamed config (`biome.jsonc`), absent directories (`.claude/commands/`, `.github/actions/`, `.claude/dogfood/`) or superseded tools (`tsgo`). Rider on B7: every kit bump re-verifies the root `CLAUDE.md` against the tree — file names, workflow names, script names, counts — not only the shim register.

## The template repo

`savvy-web/github-action-template` is the worked example. **As of 2026-09-04 it is not consumable**: `action.yml` runs `dist/main.js` and `dist/post.js`, but `dist/` and `.github/actions/local/` are neither committed nor built, no workflow runs test, lint, typecheck or build, and `act-test.yml` targets the missing local build. Its own `CLAUDE.md` and `docs/01-getting-started.md` claim both exist. The content commit is 2026-08-04; the 29 commits since are dependency bumps, so the shim register ("the kit covers everything") was never re-audited across the `@effected/github-actions` bumps its next sentence demands, and CONTRIBUTING cites versions two majors stale. Read the repository for the scaffold's shape; treat its claims about its own gates as unverified until the regeneration below lands.

The regeneration produced five refinements, folded into the rules above rather than kept as a template-only appendix: the dependency set, layer-less entries, the placement-test realization of [B1](#b1--tests-live-in-__test__-only)'s rider, `services/`/`shims/` as conventions rather than tracked empty directories, and [the test-process environment rule](#the-test-process-environment), which is new canon rather than a restatement.

Three properties of the template are canon rather than incidental:

- **The runtime dependency set is `@effected/github-actions`, `effect` and `@effect/platform-node`, and nothing else.** Dependency honesty decides the list; the App-auth chapter documents adding `@effected/github` as part of the edit that lands `pre.ts`.
- **The skeleton is working, not empty.** Layer-less uniform-guard entries, a `program.ts`, one demo step that exercises a SKIPPED path, a `state.ts` round trip, `schema/inputs.ts` and `outputs.ts` with the three-way sync test, and `format.ts` — plus real `it.effect` tests over them and the structural tests (dependency honesty, `@effect/vitest` imported, test placement). A scaffold of empty files teaches nothing and hides the shape it is supposed to demonstrate.
- **`ci:test` runs the suite with coverage and no `--pass-with-no-tests`.** A template whose test command passes on an empty suite teaches its first reader that an empty suite is acceptable.

### Regeneration contract (2026-09-04)

The next regeneration is one coherent commit that satisfies every item; each traces to an audit finding. Tracked in [github-action-template#93](https://github.com/savvy-web/github-action-template/issues/93); the per-repo alignment issues are [silk-release-action#359](https://github.com/savvy-web/silk-release-action/issues/359), [silk-update-action#394](https://github.com/savvy-web/silk-update-action/issues/394) and [silk-runtime-action#348](https://github.com/savvy-web/silk-runtime-action/issues/348).

- `dist/` and `.github/actions/local/` committed; a CI workflow runs test, lint, typecheck and a rebuild-and-diff freshness gate.
- A default schemastore step: `lib/scripts/generate-schema.ts` over a small structured `result` output (replacing `summary-written`), `schema:generate` and `schema:check` scripts, and the drift test over the exported `targets` (B4 and its riders).
- `program.ts` emits the baseline first (B10); the two-sided layers proof test (B11).
- `.gitignore` stops excluding `.claude/skills` and `.claude/agents`.
- Root `CLAUDE.md` gains a "Bootstrapping this template" section pointing at the plugin's `bootstrapping-an-action` skill, naming the marketplace the plugin ships from and how to verify it loaded. The devcontainer registers that marketplace; the `claude` script's `--plugin-dir` points at `plugins/claude-code`.
- CONTRIBUTING versions, the missing `changeset` script, the `README.md` placeholder and the `.env.example` reference to a non-existent `.mcp.json` corrected.
- Shim register re-audited against the installed kit version.

**Delivery rule.** A regeneration lands as **one coherent commit**, never as incremental patches across the old/new boundary. The half-migrated state that preceded this one — a current `pnpm-workspace.yaml` sitting next to dead dependencies — had two auditors reading opposite conclusions from adjacent files.
