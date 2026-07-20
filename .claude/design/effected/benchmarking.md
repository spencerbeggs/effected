---
status: draft
module: effected
category: architecture
created: 2026-07-20
updated: 2026-07-20
last-synced: 2026-07-20
completeness: 55
related:
  - yaml-lint.md
  - formatter-convention.md
  - architecture.md
  - releases.md
---

# `@benchmark` comparison and parity system

## Overview

A proposal for a benchmark-and-parity system that answers one question: how does the `@effected` yaml/toml/markdown/jsonc toolkit compare to the standard JavaScript packages for the same formats, on two axes — performance and correctness parity. It records the decisions of a brainstorming session and is a proposal for future work, not shipped behavior. **No part of it is in the release just cut.**

The kit's stance is "we are the wiring, users bring their own I/O". The benchmark system leans into that: it builds real tools *with* the kit — a yaml linter CLI, a toml tool, a markdown tool, a jsonc tool — and races them against the equivalent npm packages, re-using the parity corpora the format packages already ship — the same fixtures, asked a different question. The clean tools built on only the kit double as the honest proof that a competitive tool *can* be built with just the toolkit.

**Status (2026-07-20): the core is decided** — the two-folder turbo-routed structure, the gate model (two complementary gates: package conformance stays put, benchmark parity is added), the dual-location corpus story (the packages keep their corpora, the suites re-run them as a competitor differential), the JS-only competitor stance and the per-package targets, the CLI-first perf approach, and the parity-differential mechanism. **Four areas are open** and were not settled before the session was interrupted: the jsonc corpus, the deliberate-divergence allowlist format, how far each package's parity moves from CLI-level to library-level, and the canonical fixture source shared between the two locations. Those are recorded as [open questions](#open-questions) with their known direction, and must not be invented past what is written here. There is **no migration and no risk transfer** — nothing moves out of the packages, so the corpora's existing safety net is untouched.

## The two-folder structure, turbo-routed

The system adds two new top-level folders. The split is not cosmetic — it is what keeps turbo's dependency graph correct and keeps competitor dependencies from leaking into the clean kit-consuming tools.

- `packages/*` — the kit (`@effected/*`), unchanged. Builds first.
- `benchmarks/apps/*` — real tools (`@benchmark/*`, e.g. `@benchmark/yaml-lint`, a CLI) built on **only** the kit plus platform I/O, with no competitor dependencies. They are clean kit-consumers, so they are simultaneously the tool under test and the proof that the toolkit is sufficient to build a competitive tool. They order after the kit because their `workspace:*` dependencies on `@effected/*` put them downstream in turbo's topological build.
- `benchmarks/suites/*` — the harness (`@bench/*`). Each suite brings in the matching app **and** the JS competitor(s), re-runs the same corpus the package runs for conformance (as a competitor differential), and races the tools. The messy competitor dependencies, the I/O and the comparison logic are quarantined here, one hop downstream of the clean apps.

The chain is `kit → app → suite`. Each hop is a real `workspace:*` edge, so turbo orders them without any hand-written task wiring: turbo's tasks depend on their upstream counterpart (`dependsOn: ["^build:dev"]` in `turbo.json`), and topological order falls out of the dependency edges. See the [turbo naming note](#turbo-naming-note-verified) — the repo has no plain `build` task, so the chain rides `^build:dev`, not `^build`.

Both `benchmarks/apps` and `benchmarks/suites` are new pnpm-workspace globs, added to `packages:` in `pnpm-workspace.yaml`. **`website` is the precedent** — it is already a non-`packages/*` member of that list, so adding two more non-`packages/*` globs is a pattern the workspace already uses, not a new capability. Both folders are kept out of the release and publish gate (they never ship to npm) but are still wired into turbo so the build chain holds. See [keeping the folders off the release gate](#keeping-the-folders-off-the-release-gate) for the exact mechanism and one nuance the brief did not anticipate.

## Gate model

Two axes, two very different CI postures, chosen deliberately.

- **Parity is a REQUIRED CI check.** A corpus divergence from a reference — our output differing from the reference's output over the shared corpus, outside an explicit allowlist of deliberate differences — blocks merge. This is a *new* gate, additive to and independent of each package's own conformance suite (see [the two gates](#two-complementary-gates-conformance-and-parity)); nothing existing is relaxed to make room for it.
- **Perf is INFORMATIONAL.** A PR comment plus a tracked trend, never blocking. CI-runner variance makes perf-gating flaky, and a flaky required check trains reviewers to ignore it. Regression alerting is advisory, and a human decides whether a slowdown matters.

The asymmetry is the point: correctness is deterministic and gate-worthy; wall-clock time on a shared CI runner is not.

## Two complementary gates: conformance and parity

The corpora do **not** move. There is no migration, no zero-loss relocation, no coverage re-baseline. The same fixtures run in two places, answering two different questions, and both gates hold.

**The packages keep their corpora, unchanged.** The yaml-test-suite stays in `@effected/yaml`, the `smol-toml` differential oracle and the BurntSushi `toml-test` fixtures stay in `@effected/toml`, the CommonMark spec harness stays in `@effected/markdown`. In place, their job is the **conformance gate**: proving each package's *own* parser and output are correct, in the package's own CI, contributing to the package's own coverage. That safety net — the thing worth worrying about, because these tests caught real fidelity bugs in this program's most recent round (the two Direction-B failures in [formatter-convention.md decision 5](formatter-convention.md#decision-5--the-fidelity-obligation)) — is left exactly where it is.

**The suites re-run the same corpora as a competitor differential.** In `benchmarks/suites/*` the fixtures are run again, but the assertion is different: our output versus the *reference's* output over the same inputs, plus perf. The package asks "is our output correct?"; the benchmark asks "does our output MATCH the reference, and how fast?" Same inputs, two complementary questions, two independent gates. The competitor dependencies a suite needs to answer the second question are exactly the dependencies a pure-tier package must never carry — which is why the differential lives one hop downstream in a suite, not in the package.

The corpora and differentials in play, read from the working tree:

- **yaml** — the yaml-test-suite compliance harness in `packages/yaml/__test__/e2e/` (the 1,226-assertion suite, empty skip map).
- **toml** — `packages/toml/__test__/oracle.property.test.ts` (the `smol-toml` differential oracle) plus the vendored BurntSushi `toml-test` corpus under `packages/toml/__test__/fixtures/toml-test/` (214 valid + 467 invalid).
- **markdown** — the CommonMark spec harness in `packages/markdown/__test__/e2e/commonmark-spec.e2e.test.ts` (652 examples) plus the GFM sections, and the `commonmark@0.31.2` differential oracle.

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

Two of these competitors already live in the repo as differential oracles and would be **used in both places** — the package's own oracle and the suite's differential — rather than newly added: `smol-toml@1.7.0` (toml's oracle devDependency) and `commonmark@0.31.2` (markdown's oracle devDependency, the "commonmark.js" reference). They do not move; the suite reaches the same reference the package already vendors. `marked`, `@iarna/toml`, `yaml` (eemeli), `yaml-lint` and `jsonc-parser` are not yet present. The jsonc corpus row is the one genuinely open cell — see [open question 1](#open-questions).

## Perf: start simple with CLI races

**v1 races the app CLIs end-to-end** — the whole pipeline: argument parsing, I/O, parse and format — against the competitor tool invoked the same way. It is deliberately **not** a library-level micro-benchmark. Racing whole tools measures the thing a user actually experiences and keeps v1 small; a library-level differential (isolating parse throughput, say) is an explicit **later refinement**, not the starting point.

Proposed tooling, informational only:

- `mitata` for the measurements — high-precision and stable.
- `benchmark-action/github-action-benchmark` for CI — stores history, comments on the PR and can alert on regression.

Neither blocks merge; both feed the informational trend of the [gate model](#gate-model).

## Parity mechanism

The required parity gate is a **corpus differential**: our output versus the reference's output over the shared corpus, with a documented **allowlist for deliberate divergences.** The kit intentionally differs from some references — `@effected/toml` rejects `U+FFFD` as `InvalidUtf8`, `@effected/markdown` keeps `definition` nodes in the tree where commonmark.js deletes them, and similar (see each package's `CLAUDE.md`) — and the allowlist is what keeps those intentional differences from either failing the gate or silently masking a real regression.

The exact per-package **form** of the differential — CLI-level (compare tool stdout) versus library-level (compare parsed values) — starts CLI-simple and is expected to be refined per package. Record that it will evolve; the allowlist format itself is [open](#open-questions).

## Relationship to the yaml-lint proposal

`@benchmark/yaml-lint` is a consumer of the future `YamlLint` system ([yaml-lint.md](yaml-lint.md), tracked in issue #129). The two rollouts are **decoupled on purpose.** Benchmarking can START today against the shipped `Yaml.parse` / `YamlFormat` / tokenize surfaces and add the linter race once `YamlLint` lands. Do not couple the benchmark rollout to the linter's — the yaml benchmark app is worth building on the current surface, and gains the lint race as an increment when the linter is real.

## Notes verified against the repo

Two places where the brief's shorthand does not match the working tree exactly. Neither changes a decision; both are recorded so a future implementer does not trip on them.

### Turbo naming note (verified)

The brief describes the build chain as riding `^build`. There is **no `build` task in `turbo.json`** — `turbo.json` defines `build:dev`, `build:prod` and `types:check`, and the root `package.json` `build` script runs `turbo run build:dev build:prod`. Topological ordering rides `^build:dev` (and `^build:dev` again as a `build:prod` precondition). The concept the brief intends — apps build after the kit, suites after the apps, via `workspace:*` edges — holds exactly; only the task name differs.

### Keeping the folders off the release gate

The brief says the benchmark globs go on the changeset `ignore` list. That mechanism exists (`.changeset/config.json` `ignore`, currently `[]`) and is the right tool. One nuance: **`website` — the workspace-glob precedent — is not itself on the `ignore` list.** It stays out of releases simply by never having a changeset written against it, while `privatePackages.version`/`tag` are both `true` (so a private package *does* release if a changeset targets it). Adding `benchmarks/apps/*` and `benchmarks/suites/*` to `ignore` would therefore be the **first use** of that list in this repo — a belt-and-braces guarantee that a stray changeset can never publish a benchmark package, which is stronger than the convention `website` relies on and worth adopting precisely because these packages carry competitor dependencies that must never reach npm.

## Open questions

The session was interrupted before these were settled. The direction is recorded where one exists; the choice is **not** made, and must not be invented past what is written.

1. **The jsonc corpus.** `jsonc-parser` (microsoft) has no standard conformance corpus the way yaml, toml and markdown each do. The direction is to **author our own** — a set of jsonc fixtures with expected parses covering comments, trailing commas and the error-recovery modes. Its sourcing and shape are open: how many cases, where the expected values come from, whether it doubles as a differential against `jsonc-parser` or stands alone. Open.

2. **The allowlist / deliberate-divergence format.** How a deliberate difference from a reference is recorded so parity stays a *meaningful* gate — an allowlist that is too loose masks regressions, one that is too rigid fails on every intentional deviation. The direction is to work it out as the suites are built, learning the shape from the real divergences (each package's `CLAUDE.md` already enumerates its deliberate deviations, which is the raw material). Not designed yet. Open.

3. **Parity granularity per package.** Every package starts CLI-simple — compare tool output over the corpus. Whether and when a given package's parity moves to a **library-level** differential (comparing parsed values, isolating the engine from the I/O and CLI layers) is open and expected to **differ per package** — toml already has a library-level differential oracle to inherit, jsonc has none yet. Open.

4. **The canonical fixture source.** The conformance gate (in the package) and the parity gate (in the suite) run the same corpora — ideally reading **one** canonical fixture set so the two cannot drift apart on inputs. Whether that is a single shared vendored directory both locations read, or each keeps its own vendored copy kept in sync, is open. The proposal is shared-canonical; the sharing mechanism is not designed. Open.
