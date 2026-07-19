---
status: pending
module: effected
created: 2026-07-19
related:
  - ../design/effected/packages/markdown.md
  - ../design/effected/effect-standards.md
  - ./2026-07-18-markdown-p3-frontmatter.md
---

# @effected/markdown P4 — Edit/Format Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land phase P4: the edit/format surface — the cross-package parity vocabulary (`MarkdownEdit`/`MarkdownRange` + `applyAll`), canonical `stringify` (closing the `MarkdownFromString` encode side), and the offset-splice `format`/`modify` layer.

**Architecture:** The design doc's editing decision rules: offset-splice, not a lossless CST — surgical edits are computed against the original source; canonical `stringify` serves synthesized trees. The parity contract binds `MarkdownEdit`/`MarkdownRange` field-identical to `JsoncEdit`/`YamlEdit`/`TomlEdit` (`{ offset, length, content }`) — read all three sibling packages' Edit modules BEFORE writing ours and mirror the shape, statics and TSDoc habits. `stringify` is the canonical serializer over the node tree, honoring fidelity fields where present and canonical defaults where absent.

**Tech Stack:** unchanged. No new dependencies of any kind.

**P3 facts this plan builds on:** whole-package baseline 1966/1966; the P2 dialect matrix and both GFM corpora are the standing regression net; `MarkdownFromString`'s encode side currently fails typed with the P1-probed posture — P4 drops `stringify` into the existing lambda with zero signature change (the P1 ruling); the `Frontmatter` node (format + raw value) is in the tree and must round-trip through stringify (`---`/`+++`/`---json` fences); new public modules join `src/index.ts` in the task that creates them; the design doc flags Schema construction at ~17µs/node as a cost to REVISIT before P4/P5 build on the tree — this phase must measure and rule, not silently absorb.

## Global Constraints

- All P1-P3 Global Constraints carry over verbatim (tier, cycle firewall, error posture, no-barrel, commit mechanics, whole-package verification, .repos read-only, plain-prose commits with DCO signoff, forks as workers while the pane backend is down).
- **Parity is binding:** `MarkdownEdit`/`MarkdownRange` field-identical to the siblings; deviations are design-doc changes, not implementation choices.
- **Parser behavior does not change in P4.** Both corpora, the matrix and the pathological suite stay green untouched at every task. stringify/format/modify are consumers of the tree, never mutators of parse semantics.
- **The re-parse equivalence bar:** `stringify` output must re-parse to a semantically equivalent document — pinned corpus-wide (render-equivalence over the spec corpora), not just on hand-built trees.
- House Effect-wrapping policy: pure where total (`stringify`, `format`, `applyAll`), `Effect` where the error channel is real (`modify`, encode).

---

### Task 1: The parity vocabulary — MarkdownEdit.ts

**Files:** `src/MarkdownEdit.ts`, `src/index.ts`, `__test__/edit.test.ts`.

Read `packages/jsonc/src/JsoncEdit.ts`, `packages/yaml/src/YamlEdit.ts`, `packages/toml/src/TomlEdit.ts` first; mirror the field shape (`{ offset, length, content }`), the `Range` type, `applyAll` semantics (ordering, overlap rejection — match the siblings' documented behavior exactly, including their error/defect posture for overlapping edits), and any Path/Segment vocabulary the siblings share (carry only what the parity contract actually shares; markdown-specific addressing waits for P5's navigation).

- [ ] TDD: single splice, multi-edit ordering, adjacent and overlapping edits (posture per siblings), empty content (deletion), insertion (length 0), UTF-16 offset semantics on astral content, idempotence property (`applyAll` twice with disjoint recomputed edits). Whole-package green (baseline 1966 grows).
- [ ] Commit (`feat(markdown): edit parity vocabulary and applyAll`).

### Task 2: Canonical stringify and the encode side

**Files:** `src/internal/stringify.ts` (the serializer — engine-side, one module, `MAX_NESTING_DEPTH` guard on its recursion), `src/Markdown.ts` (drop stringify into the `MarkdownFromString` encode lambda — zero signature change; add `Markdown.stringify` per the design's facade line), `src/index.ts`, `__test__/stringify.test.ts`, `__test__/e2e/stringify-roundtrip.e2e.test.ts`.

Serialization rules: fidelity fields win when present (`headingStyle`, `fenceChar`/`fenceLength`, `bulletChar`, `delimiter`, `markerChar`, `breakStyle`, list `spread`, `Frontmatter.format` fences); canonical defaults when absent (ATX headings, `-` bullets, `*` emphasis with `**` strong, backtick fences, backslash breaks — record the default table in the module header and the design sync). Escaping is the hard part: emitted text must not re-parse as structure it didn't have (leading `#`, `>`, list markers, `*`/`_` runs, `|` inside table cells, `[`/`]`, entity-vulnerable text) — study how commonmark.js's (excluded) render/commonmark and mdast-util-to-markdown approach escaping via `.repos/mdast-util-from-markdown`'s sibling notes ONLY as prior art; the re-parse property is the actual authority. GFM: tables (alignment row from `align`), task items (`[ ]`/`[x]` from `checked`), strikethrough, footnotes, autolink literals need no marker (plain text that re-parses under gfm — verify the property catches this). References/definitions serialize from their nodes (`referenceType` honored).

**The 17µs/node measurement (the design-doc flag):** before optimizing anything, measure — stringify a large parsed tree (the 1MB pathological-scale doc) and record whether tree construction or serialization dominates; stringify itself builds no Schema nodes, so the expectation is that the flag does NOT bind on P4 (it binds on P5's projection). Record the measurement + ruling for the design sync; mitigate only if a pathological budget is actually threatened.

- [ ] TDD on hand-built trees (every node type, fidelity present and absent); the corpus-wide re-parse property: for all 652 spec examples + both GFM corpora, `parse → stringify → parse` yields render-equivalent HTML under the same dialect (writer + normalizer — the P1 harness machinery); pathological-scale stringify within a calibrated budget; encode side: `Schema.encodeSync(MarkdownFromString)` round-trips.
- [ ] Commit (`feat(markdown): canonical stringify and the codec encode side`).

### Task 3: format and modify — the offset-splice layer

**Files:** `src/MarkdownFormat.ts` (`format`/`formatToString` pure returning edits/text; `modify`/`modifyToString` as `Effect` with `MarkdownModificationError`; `MarkdownFormattingOptions`), `src/index.ts`, `__test__/format.test.ts`.

Read the siblings' Format modules first (`TomlFormat`/`YamlFormat`/`JsoncFormat`) and mirror the surface contract (names, pure-vs-Effect split, options class shape). `format` scope for markdown day one (record the option table): marker normalization only — heading style, bullet char, emphasis/strong marker, fence char, thematic-break char — computed as offset-splices from fidelity fields vs requested style, never touching content; no reflow/wrapping (out of scope, recorded). `modify` is the surgical-edit primitive: given a node (by identity from the parsed tree) and replacement content or a tree fragment (stringify serves fragments), produce the splice; `applyAll` composes. `MarkdownModificationError` for a node not in the document or content that would change structure outside the target (verify via re-parse of the spliced region posture — decide and record how strict day one is, siblings' precedent rules).

- [ ] TDD: each option normalizes correctly and only where fidelity differs from target; format on a canonical document yields zero edits (stability property); format∘format idempotence; modify replaces a heading/paragraph/cell; error cases typed. Whole-package green.
- [ ] Commit (`feat(markdown): format and modify offset-splice layer`).

### Task 4: Gates and phase close

- [ ] `pnpm build --filter @effected/markdown` → `issues.json` zero errors/warnings outside the suppressed `_base` bucket; biome + `pnpm lint:md` clean; whole-package run green from clean.
- [ ] Design-doc sync (P4 completion + the serialization default table, escaping approach, the 17µs ruling, format option scope) — fork carrying the design-docs conventions; commit (`ai(markdown)` type).
- [ ] Push `feat/markdown` to origin.

## Self-review notes

- Scope check against the design doc's P4 row — "the parity vocabulary, offset-splice modify, canonical stringify and format": Tasks 1-3 cover each; the visitor, Mdast projection and navigation stay P5; smart punctuation and product HTML stay never.
- Task order: vocabulary first (small, unblocks everything), stringify second (the long pole, and Task 3's fragment serialization depends on it), format/modify third.
- The re-parse equivalence property over the full corpus is the phase's central artifact — it is what "canonical stringify" means operationally, and it reuses the P1 harness machinery unchanged.
- Model economics: all three implementation tasks are Opus-shaped (serializer escaping and splice semantics are parser-adjacent); forks of the orchestrator carry them while the pane backend is down.
