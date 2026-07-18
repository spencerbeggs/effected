---
status: draft
module: effected
category: architecture
created: 2026-07-18
updated: 2026-07-18
last-synced: 2026-07-18
completeness: 80
related:
  - ../effect-standards.md
  - ../package-inventory.md
  - jsonc.md
  - yaml.md
  - toml.md
  - config-file.md
---

# @effected/markdown design

## Overview

`@effected/markdown` is CommonMark + GFM as pure Effect Schema schemas: parse, edit, validate and transform markdown documents. Markdown is the kit's communication layer with AI agents — skills, CLAUDE.md-style context files, knowledge documents — and this package makes that layer typed and programmable. Markdown→HTML and HTML→markdown are explicitly **out of scope as product features**; HTML exists only as test-harness machinery for the conformance corpus. The package carries the full-parity ambition of its format siblings [jsonc](jsonc.md), [yaml](yaml.md) and [toml](toml.md): parse, edit, format and a shared surface contract, not a read-only projection ("full kit" was chosen over read-only scope).

The real identified consumer is rspress-plugin-api-extractor, which currently uses `mdast-util-from-markdown`, `mdast-util-to-hast` and `gray-matter`; the `Mdast` projection plus the frontmatter codecs replace that stack incrementally. This is a **post-`0.1.0` workstream, not a release gate**. This document is the migration-playbook step-2 gate: the package does not exist yet, and no scaffolding lands before this design is settled.

## Headline decisions

Eight decisions define the package, each settled up front (2026-07-18).

### Engine: port commonmark.js, restructured with micromark's modularization

The engine is a vendored, hardened port of commonmark.js — the ~2.6k-LOC reference parser (BSD-2-Clause, maintained by the spec author) implementing the spec appendix's two-phase strategy: a block pass with lazy continuation, then an inline pass with the delimiter stack. The port is restructured as construct-per-module under `src/internal/` with **dialect-keyed registries** — a block-starts table and an inline-trigger table per dialect — which is micromark's decomposition without its CPS machinery.

The alternatives were evaluated and rejected: wrapping mdast/remark as runtime dependencies violates the [R1 pure-tier dependency rule](../effect-standards.md#dependency-policy); porting micromark (~11.4k LOC of CPS state machine) is 3-4x the effort and its extension ecosystem would not plug into an Effect port anyway; ts-parsec is dormant since 2023, and combinators cannot express lazy continuation or the emphasis delimiter algorithm — CommonMark deliberately has no formal grammar.

### mdast-shaped nodes, native implementation

Node Schema classes use mdast's exact node type names and field shapes: the 19 CommonMark types (root, paragraph, heading, thematicBreak, blockquote, list, listItem, code, html, definition, text, emphasis, strong, inlineCode, break, link, image, linkReference, imageReference), the GFM additions (delete, table, tableRow, tableCell, `listItem.checked`, footnoteDefinition, footnoteReference) and the frontmatter nodes. Positions are unist `Position` with line/column **and** byte offsets. Fidelity fields (bullet char, fence char and info string, ATX vs setext, delimiter runs, spacing) ride alongside the mdast shape; the `Mdast` module projects to plain spec-valid mdast JSON by stripping them. The mdast spec is stable — unchanged for years, MIT — which makes shaping to it a safe bet.

### Three port deltas from commonmark.js

Decided up front, not discovered mid-port: (a) mdast type names, not commonmark.js names; (b) byte-offset tracking added everywhere — commonmark.js only has line/column sourcepos, and offsets also power the edit layer; (c) `definition` nodes are **kept in the tree** and linkReference/imageReference are emitted unresolved, per mdast semantics — commonmark.js deletes definitions and resolves references eagerly, which is wrong for an editing library. The port also retains the concrete-syntax markers mdast drops.

### Dialects: a closed set, no public extension API

Matching toml and yaml's zero-plugin posture: a `dialect: "commonmark" | "gfm"` parse option (default `gfm`) plus a frontmatter toggle. GFM means tables, strikethrough, autolink literals, task-list items and tagfilter, **plus footnotes** — footnotes are a cmark-gfm/GitHub extension, not in the GFM spec text (recorded as such), but included as table stakes. A future `obsidian` dialect (wikilinks, embeds, callouts, highlights) is an explicit design goal: it must land purely as new construct modules in the dialect registries with **no public API change** — that constraint is the acceptance test for the registry design.

### Frontmatter: the config-file codec pattern, in-package

The core engine captures the frontmatter block as a raw fidelity-preserving node (text plus a format marker). Schema decoding ships as **free-standing named codec modules** — `YamlFrontmatter`, `TomlFrontmatter`, `JsonFrontmatter` — one module each, peering on `@effected/yaml`, `@effected/toml` and `@effected/jsonc` respectively. **Never a namespace object**: the [config-file tree-shaking rule](config-file.md) applies verbatim — a JSON-frontmatter consumer must not pay for the yaml engine. `Frontmatter.schema(MySchema, YamlFrontmatter)` gives typed gray-matter parity. mdast has no native frontmatter parsing story; this is a differentiator.

### Editing: offset-splice, not a lossless CST

Research finding, recorded: nobody in the JS ecosystem ships a lossless markdown CST — remark's serializer reformats by design, and the remark maintainers themselves recommend positional splicing (remarkjs discussion #719). The edit model is the house pattern: `MarkdownEdit { offset, length, content }` plus `applyAll`, structurally identical to `JsoncEdit`/`YamlEdit`/`TomlEdit` — the cross-package parity contract and the pre-work for the deferred `@effected/text-edit` kernel. Surgical edits are computed as offset-splices over the original source; the canonical `stringify` serves synthesized trees.

### Error posture: parse is (near-)total

CommonMark has no syntax errors — every string is a valid document. The parse error channel carries **only hardening-guard failures** (depth caps, expansion budgets), never "malformed markdown". Diagnostics carry warnings: unresolved link references, present-but-unparseable frontmatter. Strict or failing validation lives at the schema layer, not the parser.

### OKF: design-informed, package deferred

OKF (Open Knowledge Format — GoogleCloudPlatform/knowledge-catalog/okf, Apache-2.0, draft v0.1, launched 2026-06-12, single-vendor, no formal grammar or JSON schema, reference implementation contradicting the spec on required frontmatter keys) adds **zero markdown syntax**: it is YAML-frontmatter conventions (one required key, `type`), reserved filenames (`index.md`, `log.md`), bundle-relative links and a directory layout — effectively GFM in practice (its examples use pipe tables). Decision: `@effected/markdown`'s generic surface — frontmatter schemas, heading/section navigation, link extraction, lossless round-trip — must make OKF trivially expressible; a future separate `@effected/okf` package (Concept/Index/Log schemas plus bundle walking over `@effected/walker` and `@effected/glob`) waits for the spec to stabilize past v0.1.

## Tier and dependencies

Pure tier under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy): no IO, the engine is owned in `src/internal/` and there are no external runtime dependencies. `peerDependencies`: `effect` (`catalog:effect`) plus **optional** kit peers `@effected/yaml`, `@effected/toml` and `@effected/jsonc`, consumed only by the respective frontmatter codec modules. `@savvy-web/bundler` is a devDependency only. The commonmark.js port carries upstream attribution and license headers (BSD-2-Clause) per the vendored-port convention the [yaml](yaml.md) and [jsonc](jsonc.md) engines established. `"sideEffects": false`.

## Architecture: two-phase parse, dialect registries

The engine honors CommonMark's own parsing strategy: a **block pass** consuming lines with lazy continuation to build the container/leaf block tree, then an **inline pass** running the delimiter-stack algorithm over each leaf's content. Each construct (heading, fenced code, emphasis, table, footnote, …) is one module under `src/internal/`, registered in a per-dialect block-starts table or inline-trigger table; a dialect is a registry composition, nothing more. The frontmatter block, when enabled, is captured raw at the top of the block pass and never enters the inline pass.

parse = block pass → inline pass → mdast-shaped node tree with offsets and fidelity fields, plus diagnostics. edit/format operate as offset-splices against the original source. stringify is canonical serialization of a node tree. The visitor streams events from a tree walk.

## Module layout

One concern per file, mirroring [yaml's layout](yaml.md#module-layout); `src/index.ts` is the sole barrel:

- `src/Markdown.ts` — the facade: `parse`/`stringify` (`Effect`, typed `E`) and the `MarkdownFromString` schema.
- `src/MarkdownDocument.ts` — the lossless unit: source text + tree + frontmatter + diagnostics, plus navigation accessors (headings, sections, links — the OKF-informed surface).
- `src/MarkdownNode.ts` — the node Schema classes, co-located in one file to break the recursive-AST cycle: `Schema.suspend`, no parent pointers, recursive references typed `Schema.Codec<T>`.
- `src/Mdast.ts` — projection to and from plain mdast JSON; the remark-ecosystem interop boundary.
- `src/MarkdownEdit.ts` — the `Edit`/`Range`/`Path`/`Segment` parity vocabulary plus `applyAll`.
- `src/MarkdownFormat.ts` — `format`/`formatToString` (pure, edits) and `modify`/`modifyToString` (`Effect`); `MarkdownFormattingOptions`, `MarkdownModificationError`.
- `src/MarkdownVisitor.ts` — `Stream<MarkdownVisitorEvent>` tree walk, sibling-style and infallible at the type level.
- `src/MarkdownDiagnostic.ts` — the diagnostic core (`code`/`offset`/`length`/`line`/`character`, parity-shaped) plus the error-code unions.
- `src/Frontmatter.ts` — raw capture plus the schema composition seam.
- `src/YamlFrontmatter.ts` / `src/TomlFrontmatter.ts` / `src/JsonFrontmatter.ts` — the free-standing codecs over the kit peers.
- `src/internal/` — the engine: construct-per-module two-phase parser, the dialect registries and `limits.ts`.

House schema conventions apply throughout: `Schema.Class`/`Schema.TaggedClass`, `X.make` not `new` in public surface, bare `optionalKey` fields with implementation-level defaults, and the Effect-wrapping policy — pure sync where total, `Effect` where the error channel is real, `Stream` for the visitor.

## Hardening

The [input-hardening standards](../effect-standards.md#input-hardening-standards) apply in full:

- `src/internal/limits.ts` is the zero-dependency leaf; `MAX_NESTING_DEPTH = 256` (the cross-package parity constant) guards every **recursive** surface, enumerated per engine: container nesting in the block pass, the delimiter/bracket stacks in the inline pass, stringify recursion and the visitor walk. Iterative surfaces are deliberately unguarded — the toml lesson: know what NOT to guard.
- The cmark pathological suite is the **linear-time guarantee**: markdown's DoS vector is quadratic emphasis/link blowup, defeated by the delimiter-stack algorithm, and ~25 vendored pathological cases with timeout assertions pin it.
- The reference map is keyed through a real `Map` — link labels are attacker-controlled, so this is the prototype-pollution guard.
- Malformed input yields a typed error or a diagnostic, never a defect. The raw-carrier cycle firewall holds: `src/internal/` never imports public modules, and the facade materializes diagnostics. Defect passthrough is proven at the facade — non-carrier errors rethrow.

## Observability

Pure-tier rule: named `Effect.fn` spans on the public fallible boundaries only. No per-construct instrumentation inside the block or inline passes. No metrics; telemetry-agnostic.

## Testing

`@effect/vitest`, `assert.*` — never `expect` — with unit tests in `__test__/` and the conformance suites in `__test__/e2e/`. Five vendored corpora, each committed as fixtures with a `VENDORED.md` pin (upstream repo, ref, license):

1. **CommonMark spec.json 0.31.2** — 652 examples — normalized-HTML equivalence via a **test-only HTML writer in `__test__/`** (the mdast-util-from-markdown precedent; no product HTML). CC-BY-SA 4.0; test-only vendoring with attribution is the ecosystem norm (markdown-it, pulldown-cmark, comrak).
2. **GFM spec extension sections** (github/cmark-gfm `test/spec.txt`, 0.29-gfm) — 24 extension examples — same harness under dialect `gfm`. CC-BY-SA 4.0.
3. **cmark-gfm extensions.txt** — 30 examples including the only official footnote corpus. BSD-style.
4. **cmark pathological_tests.py cases** — ~25 — regex-shape plus timeout assertions. BSD.
5. **mdast-util-from-markdown fixtures** — 27 `.md`/`.json` pairs with full unist positions — direct AST-plus-position equality through the `Mdast` projection, proving interop, not just rendering. MIT.

Standing goals: an **empty skip map** (the toml precedent — zero skips); the differential oracle is the `commonmark` npm package, an exact-pinned devDependency imported only by a property test (the smol-toml pattern). Property tests: parse never throws, node positions span valid offsets, `applyAll` splice idempotence, stringify∘parse semantic preservation (re-parse equivalence) and frontmatter round-trip.

## Consumer seam

rspress-plugin-api-extractor is the identified consumer: the `Mdast` projection replaces `mdast-util-from-markdown` output and the frontmatter codecs replace `gray-matter`, adopted incrementally at that repo's boundary. Nothing in this package knows about any consumer; like its format siblings, it stays a pure, unaware format package, and any future codec-style integration (config-file, okf) points its dependency arrow **at** markdown, never from it.

## Parity notes

- `MarkdownEdit` and `MarkdownRange` are field-identical to `JsoncEdit`/`YamlEdit`/`TomlEdit` (`{ offset, length, content }`); the diagnostic core carries the shared five fields. This is the binding cross-package parity contract and the pre-work for the deferred `@effected/text-edit` kernel.
- The error posture diverges from the siblings for a spec reason, not a design one: there is no "malformed markdown", so the parse `E` channel is guards-only and the diagnostics array does the recoverable-parse work.
- Size calibration for planning: the siblings sit at roughly 4.0k (toml) and 12.6k (yaml) src LOC; markdown is estimated to land between, closer to yaml, at 6-10k.

## Phased roadmap

Each phase lands green and mergeable:

- **P0** — this design doc (the migration-playbook gate).
- **P1** — CommonMark core: scaffold from the pure sibling, block and inline passes, mdast-shaped nodes with offsets, `Markdown.parse` plus `MarkdownDocument`, the 652-example spec corpus and the pathological suite green. The long pole.
- **P2** — GFM dialect: construct modules plus the dialect option; corpora 2 and 3 green.
- **P3** — frontmatter: the capture node, `Frontmatter.schema` and the three codecs.
- **P4** — edit/format: the parity vocabulary, offset-splice `modify`, canonical `stringify` and `format`.
- **P5** — interop and traversal: the `Mdast` projection (fixture corpus green), `MarkdownVisitor` and the navigation accessors.
- **P6** — docs and adoption: the api-extractor model plus website docs, dogfooded via the rspress-plugin-api-extractor swap.
- **Future/deferred**: the `obsidian` dialect; the `@effected/okf` package.

## Build and scaffold

Standard [package-setup.md](../package-setup.md) mechanics: copy the pure sibling (toml), `"private": true`, `"sideEffects": false`, exports `"."` plus `"./package.json"`, `tsc --noEmit` typecheck, `turbo.json` outputs including `website/lib/models/markdown`, the narrow `ae-forgotten-export`/`_base` suppression in `savvy.build.ts` per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories), a stub `src/index.ts` before first install, and builds only via `pnpm build --filter`. devDependencies add the exact-pinned `commonmark` oracle — never in `dependencies`, never drifting from the ported version.
