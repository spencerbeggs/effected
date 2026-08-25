---
status: draft
module: effected
category: architecture
created: 2026-07-20
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 60
related:
  - yaml-lint.md
  - formatter-convention.md
  - architecture.md
  - releases.md
---

# `@benchmark` comparison and parity system

## Overview

A design for a benchmark-and-parity system that answers one question: how does the `@effected` yaml/toml/markdown/jsonc toolkit compare to the standard JavaScript packages for the same formats, on two axes — performance and correctness parity. **Nothing here is built**: there is no `benchmarks/` directory in the repo, and this document is the design that would be implemented.

The kit's stance is "we are the wiring, users bring their own I/O". The benchmark system leans into that: it builds real tools *with* the kit — a yaml linter CLI, a toml tool, a markdown tool, a jsonc tool — and races them against the equivalent npm packages, re-using the parity corpora the format packages already ship, the same fixtures asked a different question. The clean tools built on only the kit double as the honest proof that a competitive tool *can* be built with just the toolkit.

The structure, the gate model, the dual-location corpus story, the competitor stance and the parity mechanism are decided; four questions are deliberately left open and recorded, with their direction, under [open questions](#open-questions). Nothing moves out of the packages, so the corpora's existing safety net is untouched by any of it.

## The two-folder structure, turbo-routed

The system adds two new top-level folders. The split is not cosmetic — it is what keeps turbo's dependency graph correct and keeps competitor dependencies from leaking into the clean kit-consuming tools.

- `packages/*` — the kit (`@effected/*`), unchanged. Builds first.
- `benchmarks/apps/*` — real tools (`@benchmark/*`, e.g. `@benchmark/yaml-lint`, a CLI) built on **only** the kit plus platform I/O, with no competitor dependencies. They are clean kit-consumers, so they are simultaneously the tool under test and the proof that the toolkit is sufficient to build a competitive tool. They order after the kit because their `workspace:*` dependencies on `@effected/*` put them downstream in turbo's topological build.
- `benchmarks/suites/*` — the harness (`@bench/*`). Each suite brings in the matching app **and** the JS competitor(s), re-runs the same corpus the package runs for conformance (as a competitor differential), and races the tools. The messy competitor dependencies, the I/O and the comparison logic are quarantined here, one hop downstream of the clean apps.

The chain is `kit → app → suite`. Each hop is a real `workspace:*` edge, so turbo orders them without any hand-written task wiring: turbo's tasks depend on their upstream counterpart (`dependsOn: ["^build:dev"]` in `turbo.json`), and topological order falls out of the dependency edges. See the [turbo naming note](#turbo-naming) — the repo has no plain `build` task, so the chain rides `^build:dev`, not `^build`.

Both `benchmarks/apps` and `benchmarks/suites` are new pnpm-workspace globs, added to `packages:` in `pnpm-workspace.yaml`. **`website` and `scratchpad` are the precedent** — both are already non-`packages/*` members of that list, so adding two more is a pattern the workspace uses, not a new capability. Both folders are kept out of the release and publish gate (they never ship to npm) but are still wired into turbo so the build chain holds; see [keeping the folders off the release gate](#keeping-the-folders-off-the-release-gate).

## Gate model

Two axes, two very different CI postures, chosen deliberately.

- **Parity is a REQUIRED CI check.** A corpus divergence from a reference — our output differing from the reference's output over the shared corpus, outside an explicit allowlist of deliberate differences — blocks merge. This is a *new* gate, additive to and independent of each package's own conformance suite (see [the two gates](#two-complementary-gates-conformance-and-parity)); nothing existing is relaxed to make room for it.
- **Perf is INFORMATIONAL.** A PR comment plus a tracked trend, never blocking. CI-runner variance makes perf-gating flaky, and a flaky required check trains reviewers to ignore it. Regression alerting is advisory, and a human decides whether a slowdown matters.

The asymmetry is the point: correctness is deterministic and gate-worthy; wall-clock time on a shared CI runner is not.

## Two complementary gates: conformance and parity

The corpora do **not** move. There is no migration, no zero-loss relocation, no coverage re-baseline. The same fixtures run in two places, answering two different questions, and both gates hold.

**The packages keep their corpora, unchanged.** The yaml-test-suite stays in `@effected/yaml`, the `smol-toml` differential oracle and the BurntSushi `toml-test` fixtures stay in `@effected/toml`, the CommonMark spec harness stays in `@effected/markdown`. In place, their job is the **conformance gate**: proving each package's *own* parser and output are correct, in the package's own CI, contributing to the package's own coverage. That safety net is what catches [fidelity](formatter-convention.md#decision-5--the-fidelity-obligation) bugs, and it is left exactly where it is.

**The suites re-run the same corpora as a competitor differential.** In `benchmarks/suites/*` the fixtures are run again, but the assertion is different: our output versus the *reference's* output over the same inputs, plus perf. The package asks "is our output correct?"; the benchmark asks "does our output MATCH the reference, and how fast?" Same inputs, two complementary questions, two independent gates. The competitor dependencies a suite needs to answer the second question are exactly the dependencies a pure-tier package must never carry — which is why the differential lives one hop downstream in a suite, not in the package.

The corpora and differentials in play:

- **yaml** — the yaml-test-suite compliance harness under `packages/yaml/__test__/e2e/`.
- **toml** — the `smol-toml` differential oracle in `packages/toml/__test__/oracle.property.test.ts`, plus the vendored BurntSushi `toml-test` corpus under `packages/toml/__test__/fixtures/toml-test/`.
- **markdown** — the CommonMark spec harness and GFM sections under `packages/markdown/__test__/e2e/`, plus the `commonmark` differential oracle.

One detail to settle: the **fixture source.** Ideally both locations read one canonical set (the vendored yaml-test-suite / `toml-test` data) so the package's conformance gate and the suite's parity gate cannot drift apart on inputs. Whether that is a shared vendored directory both read or each keeps its own copy is [open](#open-questions) — the proposal is shared-canonical.

## JS competitors only

Every reference is an npm package, run under node or bun. **No cross-language references** — no Python `yamllint`, no shelling out to a `cmark` binary. The reasons are CI simplicity (no extra language runtime to install and pin) and honesty of comparison (a JavaScript toolkit is fairly measured against JavaScript alternatives, which is what a consumer choosing the kit is actually deciding between). Every competitor is a devDependency of the suite that uses it, never of a package or an app.

Proposed per-package targets:

| kit package | app (`benchmarks/apps`) | JS competitor(s) | corpus |
| --- | --- | --- | --- |
| yaml | `@benchmark/yaml-lint` (CLI) | `yaml` (eemeli), `yaml-lint` (npm) | yaml-test-suite |
| toml | a toml tool | `smol-toml`, `@iarna/toml` | BurntSushi `toml-test` |
| markdown | a markdown tool | `marked`, `commonmark.js` | CommonMark spec + GFM |
| jsonc | a jsonc tool | `jsonc-parser` (microsoft) | build our own — [open](#open-questions) |

Two of these competitors already live in the repo as differential oracles — `smol-toml` (toml's) and `commonmark` (markdown's) — and would be **used in both places**, the package's own oracle and the suite's differential, rather than newly added. They do not move; the suite reaches the same reference the package already carries. The rest are not yet present. The jsonc corpus row is the one genuinely open cell — see [open question 1](#open-questions).

## Perf: start simple with CLI races

**v1 races the app CLIs end-to-end** — the whole pipeline: argument parsing, I/O, parse and format — against the competitor tool invoked the same way. It is deliberately **not** a library-level micro-benchmark. Racing whole tools measures the thing a user actually experiences and keeps v1 small; a library-level differential (isolating parse throughput, say) is an explicit **later refinement**, not the starting point.

Proposed tooling, informational only:

- `mitata` for the measurements — high-precision and stable.
- `benchmark-action/github-action-benchmark` for CI — stores history, comments on the PR and can alert on regression.

Neither blocks merge; both feed the informational trend of the [gate model](#gate-model).

## Parity mechanism

The required parity gate is a **corpus differential**: our output versus the reference's output over the shared corpus, with a documented **allowlist for deliberate divergences.** The kit intentionally differs from some references — `@effected/toml` rejects `U+FFFD` as `InvalidUtf8`, `@effected/markdown` keeps `definition` nodes in the tree where commonmark.js deletes them, and similar (see each package's `CLAUDE.md`) — and the allowlist is what keeps those intentional differences from either failing the gate or silently masking a real regression.

The exact per-package **form** of the differential — CLI-level (compare tool stdout) versus library-level (compare parsed values) — starts CLI-simple and is expected to be refined per package. Record that it will evolve; the allowlist format itself is [open](#open-questions).

## Relationship to the yaml lint system

`@benchmark/yaml-lint` is a consumer of the shipped `YamlLint` system ([yaml-lint.md](yaml-lint.md)), so the linter race is available from the start rather than as a later increment. The two stay decoupled anyway: the app can be built against `Yaml.parse` and `YamlFormat` alone, and nothing about the benchmark structure depends on which yaml surfaces it drives.

## Two implementation notes

Neither changes a decision; both are recorded so an implementer does not trip on them.

### Turbo naming

There is **no `build` task in `turbo.json`** — it defines `build:dev`, `build:prod` and `types:check`, and the root `build` script runs `turbo run build:dev build:prod`. Topological ordering therefore rides `^build:dev`, not `^build`. The concept holds exactly — apps build after the kit, suites after the apps, via workspace edges — only the task name differs.

### Keeping the folders off the release gate

The changeset `ignore` list in `.changeset/config.json` is the mechanism, and the two benchmark globs join the private workspace members already listed there. `"private": true` is **not** the guarantee: `privatePackages.version` and `.tag` are both `true`, so a private package does release if a changeset targets it. The `ignore` list is what makes that impossible, which matters here precisely because the suites carry competitor dependencies that must never reach npm.

## Open questions

The direction is recorded where one exists; the choice is **not** made, and must not be invented past what is written.

1. **The jsonc corpus.** `jsonc-parser` (microsoft) has no standard conformance corpus the way yaml, toml and markdown each do. The direction is to **author our own** — a set of jsonc fixtures with expected parses covering comments, trailing commas and the error-recovery modes. Its sourcing and shape are open: how many cases, where the expected values come from, whether it doubles as a differential against `jsonc-parser` or stands alone. Open.

2. **The allowlist / deliberate-divergence format.** How a deliberate difference from a reference is recorded so parity stays a *meaningful* gate — an allowlist that is too loose masks regressions, one that is too rigid fails on every intentional deviation. The direction is to work it out as the suites are built, learning the shape from the real divergences (each package's `CLAUDE.md` already enumerates its deliberate deviations, which is the raw material). Not designed yet. Open.

3. **Parity granularity per package.** Every package starts CLI-simple — compare tool output over the corpus. Whether and when a given package's parity moves to a **library-level** differential (comparing parsed values, isolating the engine from the I/O and CLI layers) is open and expected to **differ per package** — toml already has a library-level differential oracle to inherit, jsonc has none yet. Open.

4. **The canonical fixture source.** The conformance gate (in the package) and the parity gate (in the suite) run the same corpora — ideally reading **one** canonical fixture set so the two cannot drift apart on inputs. Whether that is a single shared vendored directory both locations read, or each keeps its own vendored copy kept in sync, is open. The proposal is shared-canonical; the sharing mechanism is not designed. Note the shape the repo has already grown around this: `.repos/` carries the upstream spec repositories (the CommonMark and GFM specs among them) as read-only submodules for agents to consult, while each package keeps its own committed fixtures for its gate. Open.
