---
status: pending
module: effected
created: 2026-07-19
related:
  - ../design/effected/packages/markdown.md
  - ../design/effected/effect-standards.md
  - ./2026-07-19-markdown-p4-edit-format.md
---

# @effected/markdown P5 — Interop and Traversal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land phase P5: the `Mdast` projection with the vendored interop fixture corpus green, the `MarkdownVisitor` stream walk, and the `MarkdownDocument` navigation accessors — completing the design doc's phased roadmap for the sprint.

**Architecture:** The design doc rules: `src/Mdast.ts` is the remark-ecosystem interop boundary — projection to and from plain spec-valid mdast JSON, stripping the fidelity extras; `src/MarkdownVisitor.ts` is a `Stream<MarkdownVisitorEvent>` tree walk, sibling-style and infallible at the type level; the navigation accessors (headings, sections, links — the OKF-informed surface) live on `MarkdownDocument`. The mdast readme remains the node contract authority; `.repos/mdast-util-from-markdown` supplies the 27 position-complete `.md`/`.json` fixture pairs (corpus 5, MIT) proving interop by direct AST-plus-position equality, not just rendering.

**Tech Stack:** unchanged. No new dependencies. Corpus 5 is vendored as committed fixtures with a `VENDORED.md` pin, like the other four.

**P4 facts this plan builds on:** whole-package baseline 3445/3445; the re-parse equivalence property joins the standing regression net; **the 17µs flag binds HERE** — parse measured at 15.8µs/node with ~85% in Schema class construction; `Mdast.toMdast` emits plain JSON (no Schema construction — expected cheap), but `Mdast.fromMdast` decodes into Schema classes and pays the toll; the phase must measure both and record a ruling (mitigation only if a real budget is threatened; `MakeOptions.disableChecks` is already known not to help). New public modules join `src/index.ts` in the task that creates them; forks carry tasks while the pane backend is down.

## Global Constraints

- All P1-P4 Global Constraints carry over verbatim (tier, cycle firewall, mdast names, error posture, no-barrel, commit mechanics, whole-package verification, .repos read-only, plain-prose commits with DCO signoff).
- **Parser and serializer behavior do not change in P5.** All standing suites (corpora, matrix, pathological, round-trip) stay green untouched at every task.
- **mdast field shapes win over any summary** — the projection's output must be spec-valid mdast per `.repos/mdast/readme.md`, including the GFM extension shapes and the frontmatter yaml/toml names.
- The visitor is infallible at the type level (the design's sibling-style contract); the walk shares the `MAX_NESTING_DEPTH` guard (the design's enumerated surface list names it).
- Fixture disagreements are findings, never skips: if a fixture's positions disagree with ours, the mdast readme and unist spec adjudicate; a genuine upstream quirk gets a documented, asserted exception — the P1 oracle-correction precedent.

---

### Task 1: Vendor corpus 5 and the Mdast projection

**Files:** `__test__/fixtures/mdast/` (the 27 `.md`/`.json` pairs + `VENDORED.md` pin: syntax-tree/mdast-util-from-markdown, the vendored ref from `.repos/config.json`, MIT), extraction notes in the pin; `src/Mdast.ts` (`toMdast` / `fromMdast`), `src/index.ts`, `__test__/mdast.test.ts`, `__test__/e2e/mdast-interop.e2e.test.ts`, corpus-guard extension (exact-count 27).

`toMdast(root)`: plain-JSON projection — strip every fidelity extra (the `optionalKey` extras table from `MarkdownNode.ts`), map the `Frontmatter` node to mdast's `yaml`/`toml` nodes (json frontmatter has no mdast name — decide and record: project as a `json`-typed literal node by extension convention or refuse typed; check what remark-frontmatter ecosystems emit), keep unist positions (line/column/offset). Output is plain objects satisfying mdast's IDL — no Schema classes.
`fromMdast(json)`: decode plain mdast into the package's Schema node classes — positions optional in foreign mdast (unist makes them optional; our classes require them — decide and record the posture: synthesize zero positions or a dedicated decode mode; the design says the projection is the interop boundary, so foreign trees without positions must be admissible somehow).
Interop e2e: for each fixture pair, `parse(.md)` → `toMdast` → deep-equal the `.json` (positions included). Fixture disagreements adjudicated per the Global Constraint.

- [ ] Vendor + guard-test; TDD the projection; interop corpus green; whole-package green (baseline 3445 grows).
- [ ] Commit (`feat(markdown): mdast projection and interop fixture corpus`).

### Task 2: MarkdownVisitor

**Files:** `src/MarkdownVisitor.ts`, `src/index.ts`, `__test__/visitor.test.ts`.

`Stream<MarkdownVisitorEvent>` walk per the design: enter/exit events carrying the node (and depth/path context — check yaml's visitor module for the sibling-style contract and mirror its event shape and statics), infallible at the type level, document order, `MAX_NESTING_DEPTH` shared guard (a depth cap on a tree our own parser produced cannot trip — but decoded foreign trees can; the guard posture must match how stringify handles the same case). Verify the v4 Stream API against the vendored source before writing (evidence ladder).

- [ ] TDD: full-tree event sequence on a mixed document, early termination (take/interrupt semantics), depth/path context correctness, decoded-foreign-tree guard behavior. Whole-package green.
- [ ] Commit (`feat(markdown): visitor stream walk`).

### Task 3: Navigation accessors

**Files:** `src/MarkdownDocument.ts`, `__test__/document.test.ts` extensions.

The OKF-informed surface per the design: `headings` (flat, in order, with depth), `sections` (heading-delimited spans — decide and record the section model: a heading plus its content until the next heading of equal-or-shallower depth, carrying source ranges for the edit layer), `links` (all link-bearing nodes: link, linkReference + image forms + autolinks and definitions — decide and record the exact set; OKF cares about bundle-relative hrefs, so the accessor exposes URLs plus positions). Derived getters over the tree (the P3 derived-getter precedent) — no stored state, no parse-time cost.

- [ ] TDD: each accessor on a representative document (gfm constructs included), empty document, frontmatter-present document (frontmatter excluded from sections), positions/ranges correct. Whole-package green.
- [ ] Commit (`feat(markdown): document navigation accessors`).

### Task 4: Gates, performance ruling and phase close

- [ ] Measure `toMdast` and `fromMdast` at pathological scale; record numbers and the ruling on the 17µs flag (expected: toMdast cheap, fromMdast pays Schema construction — mitigation only if a calibrated budget is threatened; otherwise the flag's disposition is recorded as "binds only on foreign-tree decode, accepted day one").
- [ ] `pnpm build --filter @effected/markdown` → `issues.json` zero errors/warnings outside `_base`; biome + `pnpm lint:md` clean; whole-package green from clean.
- [ ] Design-doc sync (P5 completion + rulings: json-frontmatter projection, foreign-position posture, section model, links set, visitor event shape, the performance disposition; the roadmap's implementation phases are now all COMPLETE — P6 docs/adoption remains) — fork carrying the design-docs conventions; commit (`ai(markdown)` type).
- [ ] Push `feat/markdown` to origin.

## Self-review notes

- Scope check against the design doc's P5 row — "the `Mdast` projection (fixture corpus green), `MarkdownVisitor` and the navigation accessors": Tasks 1-3 cover each; P6 (docs/adoption, the api-extractor model + website docs + rspress swap) is explicitly NOT this phase; hast stays deferred per the open question.
- Task order: projection first (it vendors the corpus and forces the foreign-tree posture the visitor's guard reuses), visitor second, accessors third (cheapest, and the section model benefits from the visitor existing).
- The interop corpus asserts AST-plus-position equality — strictly stronger than render equivalence, and the first proof the package's trees are drop-in mdast for the remark ecosystem (the rspress-plugin-api-extractor consumer seam).
- Model economics: all tasks are fork-carried (pane backend down); Task 1 is the long pole.
