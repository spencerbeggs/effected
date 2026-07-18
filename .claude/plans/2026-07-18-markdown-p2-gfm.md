---
status: pending
module: effected
created: 2026-07-18
related:
  - ../design/effected/packages/markdown.md
  - ../design/effected/effect-standards.md
  - ./2026-07-18-markdown-p1-commonmark-core.md
---

# @effected/markdown P2 — GFM Dialect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land phase P2: the `gfm` dialect — tables, strikethrough, autolink literals, task-list items, tagfilter, and footnotes — as construct modules in the existing dialect registries, green against the vendored GFM corpora, with `dialect: "gfm"` becoming the documented default.

**Architecture:** P1 built dialect-keyed block-starts and inline-trigger registries precisely so this phase is additive: every GFM construct is a new module registered under `gfm`; the `commonmark` dialect is untouched and its 652-example corpus keeps passing unchanged under BOTH dialects wherever no extension syntax appears. Port references: the C implementations in `.repos/cmark-gfm/extensions/` (table, strikethrough, autolink, tasklist, tagfilter) and `src/` (footnotes) define semantics; the GFM spec text (`.repos/cmark-gfm/test/spec.txt`) and `extensions.txt` define conformance. mdast node contract: `.repos/mdast/readme.md` GFM section (`delete`, `table`/`tableRow`/`tableCell` with `align`, `listItem.checked`, `footnoteDefinition`/`footnoteReference`).

**Tech Stack:** unchanged from P1. No new dependencies of any kind.

**P1 facts this plan builds on** (from the P1 reports; all committed): `parseBlocks(text, dialect?)` with dialect-keyed registries; the inline pass builds a mutable linked list (`inlineNode.ts`) and materializes once — GFM inline constructs must use the same list discipline; `RawInlineSlice.segments` maps text indices to source offsets; the test writer (`__test__/e2e/support/htmlWriter.ts`) renders from the tree and resolves references itself; pathological budgets are calibrated (18x coverage factor); `MAX_NESTING_DEPTH` guards materialization; absent optional fields are genuinely absent (enforced by test); control characters in tests are escapes, never literals; trust only whole-package test runs.

## Global Constraints

- All P1 Global Constraints carry over verbatim (tier, cycle firewall, mdast names, positions, error posture, no-barrel, commit mechanics, verification discipline).
- **The `commonmark` dialect's behavior must not change**: the 652-example corpus stays green under `dialect: "commonmark"` for the whole phase. A GFM construct may only observe input when the `gfm` registry is active.
- **mdast GFM field shapes win over any summary here** — read the mdast readme's GFM section before writing each node class (the P1 List-optionality lesson).
- **Footnotes are a cmark-gfm extension, not GFM-spec text** — their only official corpus is `extensions.txt`; implement to that plus the mdast footnote node shapes.
- Tagfilter is an OUTPUT concern (it filters raw HTML tags at render time): the parse tree keeps `Html` nodes verbatim; the test writer applies the filter when rendering under `gfm`. No parse-side behavior.
- The writer gains GFM rendering (tables, del, checkbox inputs, footnote section) — it remains TEST-ONLY machinery.

---

### Task 1: Vendor the GFM corpora

**Files:** `__test__/fixtures/gfm/spec-extensions.json` (the 24 extension-section examples extracted from `.repos/cmark-gfm/test/spec.txt` — Tables 8, Task list items 2, Strikethrough 2, Autolinks 11, Disallowed Raw HTML 1), `__test__/fixtures/gfm/extensions.json` (the 30 `extensions.txt` cases incl. footnotes), both with `VENDORED.md` pins (cmark-gfm `0.29.0.gfm.13`, commit `587a12bb`, CC-BY-SA 4.0 / BSD-style); extend `corpus.ts` with loaders; extend `corpus-guard.test.ts` (24 and 30 exact counts). Extraction: port the `spec_tests.py` example-block scanner to a one-off `__test__/tools/` script (python3 with `PYTHONDONTWRITEBYTECODE=1`, or TS — implementer's choice; record which in VENDORED.md).
- [ ] Extract, pin, guard-test, commit (`test(markdown): vendor the gfm conformance corpora`).

### Task 2: GFM node classes and writer rendering

**Files:** extend `src/MarkdownNode.ts` (`Delete`, `Table` + `align: Array<"left"|"right"|"center"|null>`, `TableRow`, `TableCell`, `listItem.checked` optionalKey, `FootnoteDefinition` + `identifier`/`label`, `FootnoteReference`), widen the content unions per mdast's GFM section; extend `__test__/node.test.ts`; extend the test writer for `<del>`, `<table>` with alignment styles, `<input type="checkbox" disabled>`, the footnote `<section>` + backref machinery (port the expected shapes from `extensions.txt` outputs), and the tagfilter (escape the 9 disallowed tag names when rendering under gfm).
- [ ] Nodes + unions + tests; writer + writer tests; commit (`feat(markdown): gfm node classes and test writer rendering`).

### Task 3: Strikethrough and autolink literals

**Files:** `src/internal/inlines/strikethrough.ts` (delimiter-based, `~~`/`~` per cmark-gfm's rules — read `extensions/strikethrough.c`; interacts with the existing delimiter stack), `src/internal/inlines/autolinkLiteral.ts` (www./http/email literal detection with the GFM boundary + trailing-punctuation rules — `extensions/autolink.c` is the semantics authority); register under `gfm` only.
- [ ] TDD per construct; the two GFM spec sections green under `dialect: "gfm"`; commonmark corpus still green; commit (`feat(markdown): gfm strikethrough and autolink literals`).

### Task 4: Tables

**Files:** `src/internal/blocks/table.ts` — the block construct (header row + delimiter row detection, cell splitting with escaped-pipe handling, inline parsing per cell through the existing inline pass, alignment from the delimiter row); register in the `gfm` block-starts table ahead of paragraph continuation per cmark-gfm's ordering.
- [ ] TDD; Tables section (8 examples) green; commonmark corpus unchanged; commit (`feat(markdown): gfm tables`).

### Task 5: Task-list items

**Files:** extend `src/internal/blocks/list.ts` (or a `gfm`-registered decorator construct): `[ ]`/`[x]` marker at list-item start sets `checked` on the ListItem, marker text removed from content — only under `gfm`.
- [ ] TDD; Task list items section green; commit (`feat(markdown): gfm task list items`).

### Task 6: Footnotes

**Files:** `src/internal/blocks/footnoteDefinition.ts` (block: `[^label]:` with continuation indentation), `src/internal/inlines/footnoteReference.ts` (inline `[^label]`, formation consults the footnote map like link references consult the refmap); parse result carries a footnote map alongside `refmap`; writer renders the end-of-document section per `extensions.txt` expected output.
- [ ] TDD; the extensions.txt footnote cases green; commit (`feat(markdown): gfm footnotes`).

### Task 7: Dialect default flip and facade closure

**Files:** `src/Markdown.ts` — widen `MarkdownDialect` to `"commonmark" | "gfm"`, default flips to `"gfm"` (the design decision); `MarkdownDocument` inherits; harness runs the FULL matrix: 652 CommonMark examples under both dialects (they must agree except where extension syntax appears — assert the exception list explicitly, it is small), 24 + 30 GFM cases under `gfm`; add the GFM `tables` pathological case (excluded in P1) and any cmark-gfm GFM pathological cases to the calibrated suite; oracle note: the `commonmark` npm package knows no GFM — the oracle property test stays pinned to `dialect: "commonmark"` (state this in the test).
- [ ] Widen, flip, matrix green, pathological green; commit (`feat(markdown): gfm dialect default and full conformance matrix`).

### Task 8: Gates and phase close

- [ ] `pnpm build --filter @effected/markdown` → `issues.json` zero warnings outside `_base`; biome + `lint:md` clean; whole-package run green.
- [ ] Design-doc sync (P2 completion state) via the design-doc-agent; commit.
- [ ] Push `feat/markdown` to origin (the phase-end cadence).

## Self-review notes

- Registry additivity is the phase's load-bearing property: every task asserts the commonmark corpus unchanged — that regression net is why P1 built dialect-keyed registries.
- Footnote/table writer output shapes come from `extensions.txt`/spec examples, not from memory — the corpora are the authority, same as P1.
- Model economics: Tasks 1-2 are Sonnet-shaped (extraction, mechanical class+writer additions from specs); Tasks 3-7 are Opus-shaped (delimiter interactions, table cell grammar, footnote formation semantics).
