---
status: current
module: effected
category: architecture
created: 2026-07-06
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 92
related:
  - architecture.md
  - effect-standards.md
  - migration-playbook.md
  - releases.md
  - github-action-canon.md
  - plugin-construct-index.md
  - scratchpad.md
  - packages/app.md
---

# The "effected" agent plugins

## Overview

`plugins/` houses the repo's agent-tooling plugins for Effect v4 development. There are two, and they are not peers:

- **`plugins/claude-code/`** — the "effected" Claude Code plugin: a catalog of skills, four specialist subagents and a SessionStart briefing hook, dogfooded during package work (see [migration-playbook.md](migration-playbook.md)). This is the mature artifact and **the source of truth** for all skill and agent content. During dogfooding it is loaded via `claude --plugin-dir plugins/claude-code` (the root `package.json` `claude` script).
- **`plugins/copilot/`** — an **experimental** GitHub Copilot plugin: a port of the same skills, agents and session-start hook into Copilot's formats (`*.agent.md` agents, a root `plugin.json`, a `hooks.json` with a `sessionStart` entry). It exists because the team wants to try Copilot for effected development; it is a downstream port of the Claude Code plugin, not an independent product, and nothing here should be read as claiming parity.

Both are [repo infrastructure, not `@effected` libraries](architecture.md). Everything below that is not explicitly scoped to Copilot describes the Claude Code plugin, because that is where the content lives.

The plugin's ethos is **"verify against the installed prerelease, not v3 memory"**: every skill is authored from claims probed against the `effect` prerelease the catalog pins. Its corpus is the Effect team's migration notes, the [official skill guides](https://github.com/Effect-TS/skills) and the shipped kit itself. Lessons from kit work feed back in through the [`improve` skill](#the-improve-skill), which is the mechanism that closes the loop.

### Layout

```text
plugins/
  claude-code/          # the Claude Code plugin — source of truth
    .claude-plugin/plugin.json   # manifest, under a dot-directory
    package.json        # @effected/claude-code-plugin (private, versioning only)
    skills/ agents/ hooks/ scripts/ __test__/
  copilot/              # the experimental Copilot plugin — downstream port
    plugin.json         # manifest, at the directory root
    hooks.json          # sessionStart → hooks/session-start/orientation.sh
    package.json        # @effected/copilot-plugin (private, versioning only)
    skills/ agents/ hooks/
```

The manifest locations differ and that is upstream's choice, not an inconsistency to repair: Claude Code reads `.claude-plugin/plugin.json`, Copilot reads `plugin.json` at the plugin root. `pnpm-workspace.yaml` includes `plugins/*`, so both directories are real workspace members — see [versioning](#versioning-two-private-tracking-packages) for why.

### Development workflow: Claude Code first, then port

Claude Code and Copilot have **similar but divergent formats** for `SKILL.md` files and for hooks, so skill and agent content has to be maintained in two versions. The team overwhelmingly uses Claude Code, so the canonical flow is one-directional:

1. Make the change in `plugins/claude-code/` and prove it there (bats suite, dogfooding).
2. Copy it into `plugins/copilot/` and refactor it into Copilot's format.

`plugins/claude-code/` is authoritative; `plugins/copilot/` is a port that trails it. A change originating in the Copilot tree is a smell — it means the two will diverge in content as well as in format, and content divergence is the failure this ordering exists to prevent. The [`improve` skill](#the-improve-skill) and the [bats suite](#what-the-bats-suite-pins) both target the Claude Code tree only.

## Skill catalog

Skills live under `plugins/claude-code/skills/`, each a `SKILL.md` whose frontmatter `description` is the authoritative trigger. The directory listing is the roster; what follows is the **role** each group plays, which is the part that is not discoverable by `ls`.

**Routing** — consulted first, so nobody designs a capability core or the kit already ships:

- `effect-v4-module-index` — the routing map for Effect v4 core: every core module in one table (what it is, when to reach for it, where it lives in the vendored source). Rows route; the other skills teach.
- `effected-packages` — the sibling routing map for the kit: one table row per package (what it contains, when to reach for it, tier), plus per-package `references/` covering entrypoints, core services, testing machinery and gotchas, and the generated [construct index](plugin-construct-index.md) searchable by intent. Preloaded by all four agents. **The references are deliberately not one-to-one with the table**: the github-split packages route to the actions suite instead, because a skill that teaches a package beats a reference that describes it and carrying both is how the two drift.

**Process** — decides *what* to write:

- `effect-v4-planning` — walks four design pillars (data types and errors, services and layers, observability, testability), then forces a compact design summary for buy-in before any implementation code exists. Handles greenfield and brownfield (an audit into a gap table, each gap carrying a disposition).

**Best-practice skills** — the idiomatic v4 way to write new code: `effect-v4-house-style` (the cross-cutting house style, distilled from a review panel over four representative kit packages), `effect-v4-schema`, `effect-v4-services-layers`, `effect-v4-idioms`, `effect-v4-cli`, `effect-v4-observability` and `effect-v4-testing`.

**The migration reference:**

- `effect-v4-construct-map` — the v3→v4 lookup, a lean index over per-domain tables, consulted before reaching for any v3 API name. Its migration checklist is the ordered, greppable sweep: dependency moves → silent behavior changes → blocking removals → mechanical renames → domain restructures.
- `effect-v4-source-lookup` — what to do when the construct-map is silent or the question is behavioural: the evidence ladder and the probe preconditions. Loaded by all four agents. See [the recorded coupling](#recorded-coupling-the-vendored-path).

**API-surface and hardening discipline:** `effect-api-extractor-bases` (the inline-factory plus scoped `_base` suppression idiom — a repo standard, see [effect-standards.md](effect-standards.md#api-extractor--effect-class-factories)), `hardening-a-parser-port` and `building-a-format-package`.

**The actions suite** — the catalog's largest group, and the teaching surface for [the GitHub Action repository canon](github-action-canon.md). It replaced the savvy-web `github-actions` plugin rather than moving it: that plugin documented the API this kit deleted, so it served as a coverage reference while every skill was rewritten against the shipped `@effected/github-actions`, `@effected/github`, `@effected/sbom`, `@effected/commands` and `@effected/npm` surfaces.

Three entry points divide cleanly, and each names the other two rather than absorbing them:

- `building-a-github-action` — the router: which package owns a **capability**, plus a timeless list of what the kit deliberately does not ship.
- `designing-an-action` — the **order** a build happens in: recon → frozen spec → API dossier → contracts-first walking skeleton → TDD fill. Not for a single feature added to an existing action.
- `structuring-an-action` — the **shape** the build produces: an annotated repository tree, structural standards and structural footguns, naming the `github-action-template` repository as the living instance.

Behind them sit the per-capability skills: `actions-runtime`, `actions-inputs-outputs`, `actions-state-and-secrets`, `actions-cache-and-artifacts`, `actions-reporting`, `github-api`, `github-app-tokens`, `running-commands-and-tools`, `release-and-publish`, `supply-chain-attestation` and `testing-actions`.

### How a skill is shaped

**Every skill is a lean index over references.** A `SKILL.md` is an intro, a construct → import table with a "reach for it when" column, **Standards** written as positive imperatives, one-line **Footguns** each pointing at the reference that explains it, and an **Additional resources** section of explicit relative links, every one carrying a description and a **Load-when** guard. Depth lives in `references/*.md`, one level deep with no nesting.

The shape is a load-cost decision: a skill's body is paid on every trigger while a reference is paid only when its guard says the reader needs it. It is also why the links are explicit and described — an agent cannot decide whether to spend a read on a file it can only see the name of.

**The voice is timeless and consumer-facing.** Skills name packages as `@effected/<name>` and carry no repo-relative paths, run ids, issue numbers or dates; where a count is load-bearing it is stated as the grep that produces it rather than a number that silently ages. The reader is in a *consumer* repository, and history that reader cannot act on is cost without payoff. One file is a sanctioned exception, because it is about a codebase being ported and therefore has to discuss one: `designing-an-action`'s porting reference. The complementary half of this rule is [the canon doc](github-action-canon.md), which exists as the register for the incidents, dates and issue numbers the skills exclude.

**Citations into the Effect source are the other sanctioned exception**, and they are load-bearing rather than tolerated: a `Module.ts:line` anchor is what lets a reader settle a v4 claim at rung 2 instead of trusting the skill. They are written module-relative, so they resolve against a consumer's `node_modules/effect/src` as well as the vendored tree. The cost is that an anchor is a *pinned* fact — a catalog advance drifts them wholesale, and a drifted anchor points confidently at the wrong declaration. Re-verifying them therefore belongs with the catalog bump and the submodule re-pin ([architecture.md](architecture.md#re-pinning-when-the-effect-catalog-bumps)), not on a schedule of its own. The same rider covers the claims those anchors support: a catalog advance is when an API the skills teach quietly stops existing.

**The frontmatter contract** splits triggering from cataloguing: a trigger-first `description` leading with the strongest use case and carrying no construct-listing prose, plus a separate `when_to_use` catalog of trigger phrases. The two together stay under Claude Code's listing cap.

## Specialist agents

Four subagents live under `plugins/claude-code/agents/`, each arriving with the relevant skills preloaded via its frontmatter `skills` list. All four preload `effected-packages` and `effect-v4-house-style`, verify at capability level — running the host repo's own gates, preferring structured session tools (vitest-agent MCP, Biome MCP) over hard-coded pnpm/turbo commands — and report `@effected` package improvement suggestions alongside skill rough edges.

- `effect-developer` — writes new idiomatic v4 code. Step 1 on any non-trivial feature is `effect-v4-planning`, emitting the design summary for buy-in before implementation. Delegate feature implementation here.
- `effect-reviewer` — reviews v4 code for idiom, error-channel and API-surface correctness, and writes or strengthens `@effect/vitest` tests. Delegate review and test authoring here.
- `action-engineer` — builds, extends, debugs and reviews GitHub Actions, release/publish pipelines and GitHub API programs. It preloads the **whole** actions suite rather than a core plus an on-demand tail, because a task in this territory routinely crosses cache, tokens, publishing and reporting in one build, and the lean-index shape is what makes carrying it all affordable. Its notes make choosing between **two loops** step 0: a new action, a wholesale rebuild or a port touching more than one pipeline step is `designing-an-action`'s loop; extending or reviewing an action that already has that shape works within the existing contracts. Picking the wrong loop is how a walking skeleton gets skipped and business logic gets written against an unverified API. It also carries the [upstream-migration protocol](github-action-canon.md#b8--blessed-shims-live-in-srcshims). Delegate action work here.
- `effect-migrator` — migrates **any** Effect v3 codebase to v4, not only kit consumers. Two paths: a library port runs engine-first behind a characterization gate, and an in-place application migration runs dependency swap → silent-behavior audit → blocking removals resolved as recorded design decisions → compiler-driven mechanical tail. It detects the host repo's conventions instead of assuming this repo's. Delegate migration work here.

## What the bats suite pins

Three `.bats` files under `plugins/claude-code/__test__/` hold the plugin's structural claims, on one shared principle: **a claim about the plugin's own completeness is pinned by an executable check, never by prose that a later edit can quietly falsify.** They are also why this document states no skill count — the roster lives on disk and the tests read it from there.

- `session-start-orientation.bats` — the skill roster in the briefing hook, derived from the directories on disk with a minimum-count guard, so a new skill cannot ship without its briefing bullet.
- `agent-skill-registration.bats` — each agent's frontmatter `skills` list, including a membership test naming every Actions skill `action-engineer` must list. That pins the preload-the-whole-suite decision, so dropping one fails a test instead of silently reverting the call. It also catches a skill name leaking into an agent's `tools` block, which would satisfy any test that merely greps the file for the name.
- `construct-index.bats` — the executable pin on the [construct index](plugin-construct-index.md#enforcement): generator fixture tests, a drift test that regenerates the committed index into a temp dir and diffs, and the strict annotation gate.

**What no check pins is prose about the kit rather than about the plugin.** The construct index pins that an exported identifier is *indexed and annotated*; no check can tell whether a sentence about it is still true. Package counts, tier labels and publication status sitting inside the `effected-packages` routing map are exactly that class, and a re-verification pass found them aged. Two things contain it, neither of them a test: the voice rule requiring a load-bearing count to be written as the grep that produces it, and re-verifying kit-surface claims as part of a release wave rather than on discovery.

**CI runs the suite through the org release-validate workflow's auto-discovered Shell Tests check**, with no custom build step: the one file that needs build artifacts, `construct-index.bats`, self-provisions them.

## The construct index

One generated table per kit package, listing every exported construct with an agent-authored intent column so a capability can be found without knowing its name. It is a subsystem in its own right — a dependency-free generator over the api-extractor doc models, an annotations sidecar, a bats drift pin and a project-level maintenance skill — and is documented in [plugin-construct-index.md](plugin-construct-index.md).

## The `improve` skill

`.claude/skills/improve` is a **project-level** skill, not a plugin skill. It is aware of `plugins/claude-code/skills/` and edits them; the plugin carries no self-improvement machinery of its own. A tool does not grade itself, and the separation keeps the plugin publishable while the improvement loop stays free to assume this repo's layout.

It closes the loop the plugin's ethos implies: real work falsifies skill claims, and something has to turn those falsifications back into skill edits.

- **Harvest** runs at the end of a work cycle. It reads the recorded retractions and PR review threads and files a ticket for each skill claim that turned out false, carrying the claim and the artifact that killed it.
- **Tune** runs against those open tickets. For each it climbs the evidence ladder, only as far as the claim requires, then amends the skill and closes the ticket citing what it found.

### The evidence ladder

The rungs are ordered by cost, and each answers a strictly different class of question:

1. **Migration notes and skill guides** (`<vendored>/migration/*.md`, the Effect-TS skills references). Cheap, and authoritative for the **rename** class.
2. **Source** — either the vendored `.repos/effect` submodule (see [architecture.md](architecture.md#vendored-source)) or the installed `node_modules/effect/src`. Authoritative for **existence and signature**.
3. **A probe run from inside the package.** The only rung that settles **semantics**.

**One document sits between rungs 1 and 2, and the skill names it rung 1.5.** The vendored tree ships `packages/effect/SCHEMA.md` *at the pin* — upstream Schema documentation versioned with the source rather than floating like a website, so unlike the migration notes it describes the surface actually installed. That makes it a cheap, version-exact diff oracle: when it disagrees with a skill, the skill is usually what is wrong. It is still a document and it does not outrank a declaration — a re-verification pass found it right in most of its disagreements and wrong in a handful of its own. Reach for it early, treat a disagreement as a strong signal worth chasing, then settle the answer in `src`. Like rung 1 it is vendored-only: the npm package ships `src` and `ai-docs`, but neither `SCHEMA.md` nor `migration/`.

Rung 2 has two roots that can drift, so the skill names a tiebreak: **the installed source wins.** `node_modules` is what the code links against; the vendored tree is what someone pinned last, and it remains the only home of rung 1. Because the Effect catalogs pin exact prereleases and a re-pin is folded into the catalog-bump commit ([architecture.md](architecture.md#re-pinning-when-the-effect-catalog-bumps)), the two agree by construction — but the tiebreak stays, because it costs nothing and catches the next divergence.

The docs are prescriptive rather than exhaustive, which is why rung 1 cannot be the last rung: the services migration note covers `Context.Tag` → `Context.Service` and never mentions `Context.Key`, yet `Context.Key` is the primitive some ports need. Nothing short of source settles a removal; nothing short of a probe settles behaviour.

Silence is the *gentler* failure, and treating it as the only one understates the rung. **The notes also assert what the source refutes, in both directions** — documenting a trait method (`Yieldable.asEffect`) that has zero occurrences anywhere in the tree, and listing a module as removed (`Differ`) that is alive and mapped v3→v4 elsewhere in the same corpus. A confident wrong answer costs more than an absent one, because nothing prompts the reader to climb. So rung 1 settles renames and nothing else: a positive claim in the notes about what a symbol *is or does* is exactly as unsettled as their silence. Hence the rule that keeps a skill edit non-vacuous: **an edit must cite the highest rung that actually settles its claim.**

### Probe preconditions

Encoded as skill preconditions because each was learned by being burned:

- **Probes run from the [`scratchpad/` workspace](scratchpad.md)** in this repo, or from inside the package elsewhere — never from the harness's own `/tmp` scratch directory, which has no `node_modules`. Every probe prints its resolved `effect` version, because a wrong resolution (a v3 `effect` at some other repo's root) is otherwise indistinguishable from a right one.
- **A probe file must be inside the compilation program.** A package tsconfig whose `include` is `${configDir}/*.ts` does not match subdirectories, so a probe placed in one silently leaves the program and false-passes its control.
- **The control assertion runs first.** A probe that cannot fail is worse than no probe.

### Recorded coupling: the vendored path

The plugin is loaded only from this repo, so its agents and skills may assume the vendored tree exists — after `savvy repos sync`, since a submodule checkout starts empty in a fresh clone, CI runner or new worktree (see [architecture.md](architecture.md#vendored-source)). In a published consumer's tree that path is absent, and a skill that cannot find its evidence source must not fall back on v3 memory: silent fallback is the exact failure the plugin exists to prevent.

Two things contain it. The path is written `${CLAUDE_PROJECT_DIR}/.repos/effect`, using [skill string substitution](https://code.claude.com/docs/en/skills.md), because the probe protocol has agents `cd` into a package first and a relative path would not resolve from there. And `effect-v4-source-lookup` implements a resolution ladder — an explicit environment override, then the vendored tree, then the installed `node_modules/effect/src` **gated on a resolved v4 version** (it refuses a v3 resolution rather than reporting it) — stopping loudly only when every root is absent. Rung 1 deliberately has no fallback: the npm package does not ship the migration notes, and the skill says so instead of degrading silently.

What remains before promoting the plugin to end users is validation in a repo without the `.repos` config, not new machinery.

## SessionStart briefing hook

`plugins/claude-code/hooks/hooks.json` registers a `SessionStart` hook (no matcher, so it fires on resume and compact too) that runs `session-start/orientation.sh`. The script briefs the main agent on the skills and agents the plugin ships and tells it to delegate whole write/review/migrate Effect tasks to the matching agent rather than hand-rolling them inline. Its `dogfood_feedback` block carries two loops — plugin feedback (wrong or unhelpful skill/agent/hook guidance) and `@effected` package feedback (service gaps, fluency suggestions, candidate new constructs) — and filing an issue always requires the user's explicit agreement. It is built on silk's hook pattern: `lib/hook-output.sh` provides the `emit_context` / `emit_noop` helpers, and the hook fails open when `jq` is absent.

`plugins/copilot/hooks.json` registers the same briefing as a `sessionStart` command hook running `hooks/session-start/orientation.sh` under `COPILOT_PLUGIN_ROOT`. Copilot's hook format diverges from Claude Code's, so the port is a rewrite of the wiring rather than a copy — see [the development workflow](#development-workflow-claude-code-first-then-port).

## Versioning: two private tracking packages

Each plugin carries a **private tracking package** whose only job is to give changesets something to version:

| Tracking package | Directory | Manifest it drives |
| --- | --- | --- |
| `@effected/claude-code-plugin` | `plugins/claude-code/` | `plugins/claude-code/.claude-plugin/plugin.json` |
| `@effected/copilot-plugin` | `plugins/copilot/` | `plugins/copilot/plugin.json` |

Both are `"private": true` with **no `publishConfig`**, so by the repo's [publishability rule](releases.md) — `publishConfig.access === "public"` — neither publishes to npm, ever. They are workspace members solely because changesets versions workspace members.

`.changeset/config.json` wires the rest. `privatePackages` is `{ tag: true, version: true }`, and the `@savvy-web/changelog` `packages` block gives each tracking package a `versionFiles` entry — glob the plugin manifest, path `$.version`. So the flow is:

**changeset naming the tracking package → CI bumps its `package.json` *and* the plugin manifest in lockstep → git tag → GitHub release, no npm publish.**

To version a plugin, add a changeset naming `@effected/claude-code-plugin` or `@effected/copilot-plugin`. The tag looks like `@effected/copilot-plugin@0.1.0` and carries a GitHub release.

Each plugin versions and releases independently of the kit's [release waves](releases.md): a changeset for a library moves nothing in `plugins/`, and a plugin release never waits on one. The plugins deliberately do **not** ride on a library's changeset scope — tying a plugin's version to [`@effected/app`](packages/app.md) or any other package would couple its cadence to a kit wave and leave it no way to ship on its own.

## Distribution

The Claude Code manifest names the plugin `effected`. Claude Code namespaces a plugin's skills and agents by plugin name, so references take the form `effected:effect-developer`.

Both plugins ship from the maintainer's `spencerbeggs/bot` repo, but from **two separate marketplace manifests with different automation**:

| | Claude Code | Copilot |
| --- | --- | --- |
| Manifest in `bot` | `.claude-plugin/marketplace.json` | `.github/plugin/marketplace.json` |
| Source type | `git-subdir`, `url: https://github.com/spencerbeggs/effected.git`, `path: plugins/claude-code` | `github`, `repo: spencerbeggs/effected`, `path: plugins/copilot` |
| Pin | sha-pinned | `ref: ""` for now |
| Bump | automatic on release | **manual for the initial versions** — no automation yet |

Installing the Claude Code plugin:

```sh
claude plugin marketplace add spencerbeggs/bot
claude plugin add spencerbeggs/effected --scope project
```

It is **published but not advertised** — shipped, unannounced, and promoted to end users only when the maintainer is ready. The Copilot plugin is experimental and for the team's own trial only.
