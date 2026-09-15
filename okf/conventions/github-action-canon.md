---
type: Convention
title: Build a GitHub Action repository to the kit's canonical shape
description: A GitHub Action built on @effected follows one file layout, one design sequence, and eleven resolved rules derived from the three actions that completed the migration onto @effected/github-actions — deviate only for a documented, revisable reason.
status: stable
stale_after: "2027-03-13T00:00:00Z"
tags:
  - architecture
  - dx
sources:
  - id: skill-building
    resource: ../../plugins/claude-code/skills/building-a-github-action/SKILL.md
  - id: skill-designing
    resource: ../../plugins/claude-code/skills/designing-an-action/SKILL.md
  - id: skill-structuring
    resource: ../../plugins/claude-code/skills/structuring-an-action/SKILL.md
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T05:33:04Z
  body_sha256: 2f208c2168e14ed19432290b9a057f0ff1ef76f458c0f7132a7209e8bc070407
---

# Build a GitHub Action repository to the kit's canonical shape

Three actions completed the migration onto `@effected/github-actions` —
**silk-release-action**, **silk-runtime-action** and **silk-update-action**
— and this canon was derived by auditing all three, construct by
construct, against their shipped source, incidents and issue trails. Every
rule below traces to an incident: nothing here is a style preference, and
each item cites the run or issue where its absence cost something. Follow
this shape when designing or reviewing a fourth action repository on the
kit.

## Division of labor with the plugin skills

This convention states *why* each rule exists and keeps the incident
citations that justify it. The plugin's Actions skill suite teaches the
same rules timelessly, for a reader inside a consumer repository who
cannot act on a run id or an issue number, and is the surface to load
while actually building:

| Surface | Owns |
| --- | --- |
| This convention | The rules, the rationale, and the resolved decisions. |
| [`designing-an-action`](../../plugins/claude-code/skills/designing-an-action/SKILL.md) | The build sequence as a process to execute — recon, frozen spec, API dossier, walking skeleton, TDD fill. |
| [`structuring-an-action`](../../plugins/claude-code/skills/structuring-an-action/SKILL.md) | The repository shape below, taught as an annotated tree with structural standards a consumer-repo reader can apply directly. |
| [`building-a-github-action`](../../plugins/claude-code/skills/building-a-github-action/SKILL.md) | Capability → package → skill routing; it routes, it does not teach. |
| The `actions-*` skills ([`actions-inputs-outputs`](../../plugins/claude-code/skills/actions-inputs-outputs/SKILL.md), [`actions-runtime`](../../plugins/claude-code/skills/actions-runtime/SKILL.md), [`actions-state-and-secrets`](../../plugins/claude-code/skills/actions-state-and-secrets/SKILL.md), [`actions-reporting`](../../plugins/claude-code/skills/actions-reporting/SKILL.md), [`actions-cache-and-artifacts`](../../plugins/claude-code/skills/actions-cache-and-artifacts/SKILL.md), [`testing-actions`](../../plugins/claude-code/skills/testing-actions/SKILL.md)) | The per-capability depth. |
| [`github-app-tokens`](../../plugins/claude-code/skills/github-app-tokens/SKILL.md) | The full App-auth token lifecycle recipe (§B3). |

Keep the two surfaces synchronized in that order: an incident amends this
convention first, then the skill that teaches the affected step, then the
worked template repository (see [regenerate the action template](../runbooks/regenerate-the-action-template.md)).

## The canonical repository

`action.yml` is the **single source** of input and output names *and*
their defaults — `node24`, `runs.pre?`/`main`/`post` pointing at
`dist/*.js`, branding, and input documentation. Code mirrors those
defaults; it never re-declares them. `action.config.ts` carries the
builder entries (`pre?`, `main`, `post`, `workers?`), `minify`, and
`persistLocal` enabled (§B6). Bundler escape hatches (`ignore`,
`nativeDynamicImports`) are added per need, with a forensic comment
explaining why each entry exists (§B9), never copied forward from another
action.

**Where a committed JSON Schema lives follows whether consumers pin it.**
A structured `result` output that payloads reference by `$schema` is
versioned, at `schemas/<version>/<name>-<version>.json`, the directory
carrying the same label as the file so a version's artifacts stay
together while the file name is the one SchemaStore resolves. An input
schema is unversioned at the repository root. A documentation-facing
schema nobody pins may live under `docs/schema/`. One `HostedSchema`
identity beside the schema, one `schemastore.config.ts` under
`lib/scripts/`, one committed artifact, and `schemastore check` as the
drift gate — the directory follows the pinning question, not the other way
round.

`lib/scripts/` holds non-compilable scripts, deliberately: changes there
invalidate turbo's build cache, which is exactly the behavior a
code-generating or bundle-asserting script needs. Bundle-truth guard
scripts live here only when there is something to assert — the *slot* is
canon, a no-op placeholder in it is not.

`src/` holds:

- `pre.ts` (optional, only when the lifecycle needs it), `main.ts` (thin:
  a program import and a guard, nothing else), `post.ts` (double-netted
  with `catch` and `catchDefect`; post never fails the workflow), and
  `program.ts` (pure composition: `readInputs` → steps in order → output
  fold → report — cross-step joins only, no I/O, no formatting, no step
  bodies).
- `steps/`, one module per orchestration unit: a result type, a typed
  error only when the step can fail, and an explicitly annotated `R`. The
  module doc states the failure posture beside the error channel —
  `fail-the-job`, `degrade-to-warning`, or `double-netted` — so a kit
  upgrade that widens a member's channel is a build error at that line
  rather than a silently failed job.
- `services/`, for capability shared across steps or actions only — a
  step used once does not become a service — and `shims/` for blessed
  local shims (§B8). Both are documented conventions rather than tracked
  empty directories: an action that needs neither ships neither.
- `layers/app.ts`, holding per-entry layers only when a service must be
  provided outside `program`. `MainLive`/`PreLive`/`PostLive` are the
  action's own naming convention, not kit exports — the kit ships
  `ActionRuntime.layer` and each service's own `static readonly layer`.
  Add only what `ActionRuntime.layer` omits; require the rest.
- `schema/inputs.ts` (an `INPUT_NAMES` const tuple plus `readInputs`,
  decoded once, defaults mirroring `action.yml`) and `schema/outputs.ts`
  (an `OUTPUT_NAMES` tuple plus the fold from all-disabled defaults, so
  every output is emitted exactly once on every abort path).
- `state.ts`, holding `STATE_KEYS` and `Schema.Class` bundles whose every
  field's *encoded* form is JSON-safe (`Schema.OptionFromNullOr`, never
  `Schema.Option`), with branded ids where a zero value would be invalid.
- `format.ts` or `format/` — the single rendering surface, module or
  directory, so a log line and a panel row call the same function and
  cannot disagree.
- `src/CLAUDE.md`, documenting `src/` conventions and kept current.

`__test__/` holds `unit/` (mirroring `src/` module for module),
`integration/` (`*.int.test.ts` with real `fixtures/`), and `utils/`
(doubles — never tests). `vitest.config.ts` uses the `AgentPlugin` with
`include: ["src/**/*.ts"]` for coverage, so a never-imported file scores
zero rather than vanishing from the report, and enforces test placement
with a structural test rather than an include glob (§B1). `vitest.setup.ts`
strips `GITHUB_ACTIONS`, every `INPUT_*` and every `STATE_*` from the test
process environment, which is what lets the uniform entry-guard idiom
(`if (process.env.GITHUB_ACTIONS) { await Action.run(program, { layer }) }`)
coexist with running tests inside a runner.

Repository scaffolding carries `.github/workflows/` (`act-test`,
`branch-sync`, `claude`, `dco`, `project-listener`, `release`,
`silk-update`, and a self-dogfood workflow in which the action runs
itself), `.github/actions/local/` (committed `persistLocal` output, the
`act`/CI smoke target), and `dist/` (committed bundles, gated by a
rebuild-and-diff freshness check). The root `CLAUDE.md` is general
"how to use this repo" context plus the shim register; it must not
duplicate skill content, because the effected Claude Code plugin is
installed by default and carries the system knowledge through its skills
and agents.

## Resolved rules

### B1 — Tests live in `__test__/` only

Enforce `unit/` plus `integration/*.int.test.ts` as the only two test
locations, and enforce it executably — the gate is the `Tests:` line, never
the exit code — because a suite can carry a green exit code over tests
that were silently never collected. The three reserved helper-directory
names (`utils`, `fixtures`, `snapshots`) are excluded only as **direct
children** of `__test__`, not at any depth, so name a nested helper
directory something outside that set (a `src/utils/` mirror lives at
`__test__/unit/utilities/`) rather than depend on either exclusion
behavior.

### B2 — `it.effect` plus `assert.*` is template canon

Convert doubles first and the runner later when migrating a suite, and add
a structural test asserting that `@effect/vitest` is actually imported —
because a declared-but-never-imported test dependency is otherwise
invisible.

### B3 — Token-minimal core, App auth as a complete optional module

Ship an action's default path with no App credentials required, so the
simplest possible action stays scaffoldable, and keep the full App-auth
recipe — `pre.ts`/`PreLive`, the two inputs, `clientLayer()`, unconditional
revoke in `post` — as a complete, working, optional module rather than a
mandatory baseline.

### B4 — JSON Schema publication is conditional canon

Whenever a JSON contract crosses the action boundary, input or output,
generate it through the kit's schema pipeline — Effect Schema → committed,
ajv-validated, drift-checked files — via the `schemastore` command over a
`defineConfig` that receives the schema's `HostedSchema` identity as
`hosted`, never through a generator script, a layer composed in the
config, or a hand-rolled drift test. The identity is declared once beside
the schema, and the payload's `$schema` and the committed document's `$id`
both derive from it. `@effected/schemastore` is a runtime dependency (the
identity is read at runtime); `@effected/schemastore-cli` is a
devDependency and is where the ajv engine lives, so the bundle never
carries one. Flat, line-list actions skip this entirely. Version labels in
emitted file names are one-to-three-component labels ordered by SemVer
precedence, and a `published` document's contract change is refused before
any write — an unpublished target rewrites in place because it has no
consumer-pinning expectation to protect.

### B5 — Line-list inputs first

Prefer line-list inputs, which read better in workflow YAML; reserve a
JSON input for genuinely nested structure, which then triggers B4.

### B6 — `persistLocal` is enabled

Enable `persistLocal` so it feeds `.github/actions/local` and the
`act`-test smoke loop — disabled by default, local verification is dead on
arrival.

### B7 — Caret ranges for `@effected/*` until the kit reaches 1.0

Declare `@effected/*` dependencies at caret ranges, automate the bump, and
make every kit-bump's definition of done include re-verifying kit-surface
claims — comments, shims, `CLAUDE.md` — against the new version, so a
fossilized "the kit ships no successor" comment cannot survive a bump it
was falsified by.

### B8 — Blessed shims live in `src/shims/`

Route a genuinely absent kit surface through one module per missing
contract, named for it, carrying a mandatory header contract: which kit
surfaces were checked absent and at which versions, a tracking issue link,
and the removal condition. Re-audit the shim directory on every kit bump.
When code that should migrate upstream into a kit package is spotted, ask
the user whether to dogfood the change upstream now or write a shim, and
either way file an issue in the kit repository plus a linked tracking
ticket in the source repository. "Wait for the kit" fails silently, which
is why the shim slot exists.

### B9 — Bundler escape hatches are per-need

Add a bundler escape-hatch entry (`ignore`, `nativeDynamicImports`) only
when that action's own dependency graph requires it, with a forensic
comment explaining why the entry exists — an inert copy of someone else's
entry outlives the reason it was added, and nothing fails when it is
wrong.

### B10 — Emit the output baseline first

Run `emitOutputs(initialOutputs)` before any work, never from an
`Effect.onError` handler, so every later exit path writes the full output
set on top of it rather than a failure handler re-emitting the baseline
and overwriting an output that already described real work. A step whose
result must survive a later failure — a created pull request, a pushed
tag — emits its own output as soon as it lands, so later writes only ever
add to an earlier one.

### B11 — The layers proof is compile-time and two-sided

Assert both `[Exclude<AppLayerRequirements, ActionServices>] extends
[never]` and, separately, `[Exclude<ProgramRequirements, ActionServices>]
extends [never]`. The second assertion exists because a service resolved
inside a step *method* is invisible to the layer's input channel, so the
first assertion alone can pass while production dies on every consumer. A
runtime assertion is not an acceptable substitute for either half: a
compile failure cannot regress silently.

## Cross-cutting invariants

- **Dependency honesty.** Declare an `@effected/*` dependency only when
  `src/` imports it directly, or when it is a required peer dependency of
  another declared dependency — a structural import-walker test must
  resolve the peer closure before flagging anything as unused. There is no
  "common set" of packages to pre-declare on a new scaffold; a
  pre-declared, unused dependency teaches the scaffold's first reader that
  unused declarations are normal.
- **Kit-static seams are defaulted parameters, not service wrappers.** A
  seam over a kit-static capability should keep `R` — and therefore every
  consumer's layer stack — unchanged.
- **`ActionEnvironment` is the only environment authority.** Ambient
  `process.env` appears only at named bridge sites; duplicate reads of the
  same runner variable with divergent fallbacks are a defect.
- **No `as never` on the `R` channel.** A dropped layer must fail to
  compile, not die at runtime; production entry points are zero-arg by
  construction.
- **Known kit workarounds stay documented until they are fixed, and
  deleted when they are.** A register of live workarounds is only useful
  if a fixed one is actually removed from it — an action still carrying a
  workaround for a bug the kit fixed upstream is carrying dead weight.
