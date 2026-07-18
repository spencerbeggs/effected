---
status: draft
module: effected
category: architecture
created: 2026-07-18
updated: 2026-07-18
last-synced: 2026-07-18
completeness: 85
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

Nine decisions define the package, each settled up front (2026-07-18).

### Engine: port commonmark.js, restructured with micromark's modularization

The engine is a vendored, hardened port of commonmark.js — the ~2.6k-LOC reference parser (BSD-2-Clause, maintained by the spec author) implementing the spec appendix's two-phase strategy: a block pass with lazy continuation, then an inline pass with the delimiter stack. The port is restructured as construct-per-module under `src/internal/` with **dialect-keyed registries** — a block-starts table and an inline-trigger table per dialect — which is micromark's decomposition without its CPS machinery.

The alternatives were evaluated and rejected: wrapping mdast/remark as runtime dependencies violates the [R1 pure-tier dependency rule](../effect-standards.md#dependency-policy); porting micromark (~11.4k LOC of CPS state machine) is 3-4x the effort and its extension ecosystem would not plug into an Effect port anyway; ts-parsec is dormant since 2023, and combinators cannot express lazy continuation or the emphasis delimiter algorithm — CommonMark deliberately has no formal grammar.

### mdast-shaped nodes, native implementation

Node Schema classes use mdast's exact node type names and field shapes: the 19 CommonMark types (root, paragraph, heading, thematicBreak, blockquote, list, listItem, code, html, definition, text, emphasis, strong, inlineCode, break, link, image, linkReference, imageReference), the GFM additions (delete, table, tableRow, tableCell, `listItem.checked`, footnoteDefinition, footnoteReference) and the frontmatter nodes. Positions are unist `Position` with line/column **and** byte offsets. Fidelity fields (bullet char, fence char and info string, ATX vs setext, delimiter runs, spacing) ride alongside the mdast shape; the `Mdast` module projects to plain spec-valid mdast JSON by stripping them. The mdast spec is stable — unchanged for years, MIT — which makes shaping to it a safe bet.

**P1 rulings** (implementation, 2026-07-18): (a) `List.ordered`, `List.spread` and `ListItem.spread` are `optionalKey` per the mdast spec's `boolean?` with absence meaning unknown, not `false` — the mdast readme wins over any summary of it; consumers and the test-only HTML writer treat an absent `spread` as tight. (b) Node type discriminators use `Schema.Class` with an explicit tag field named `type`, not `Schema.TaggedClass` — `TaggedClass` is unusable for a foreign contract because it hardwires the `_tag` key, and mdast's contract requires exactly `type`.

### Three port deltas from commonmark.js

Decided up front, not discovered mid-port: (a) mdast type names, not commonmark.js names; (b) byte-offset tracking added everywhere — commonmark.js only has line/column sourcepos, and offsets also power the edit layer; (c) `definition` nodes are **kept in the tree** and linkReference/imageReference are emitted unresolved, per mdast semantics — commonmark.js deletes definitions and resolves references eagerly, which is wrong for an editing library. The port also retains the concrete-syntax markers mdast drops.

**P1 ruling** (2026-07-18): reference *formation* still follows the CommonMark spec exactly — a link or image label with no matching definition stays literal text, never a reference node — so the design's only delta is the emitted node *shape* (`linkReference`/`imageReference` plus the kept `definition` nodes) where commonmark.js would eagerly resolve a `link`. This corrects a subtle earlier misreading of the delta as forming references even when undefined; the spec-conformant behavior is pinned by tests.

### Dialects: a closed set, no public extension API

Matching toml and yaml's zero-plugin posture: a `dialect: "commonmark" | "gfm"` parse option (default `gfm`) plus a frontmatter toggle. GFM means tables, strikethrough, autolink literals, task-list items and tagfilter, **plus footnotes** — footnotes are a cmark-gfm/GitHub extension, not in the GFM spec text (recorded as such), but included as table stakes. A future `obsidian` dialect (wikilinks, embeds, callouts, highlights) is an explicit design goal: it must land purely as new construct modules in the dialect registries with **no public API change** — that constraint is the acceptance test for the registry design.

### Frontmatter: the config-file codec pattern, in-package

The core engine captures the frontmatter block as a raw fidelity-preserving node (text plus a format marker). Schema decoding ships as **free-standing named codec modules** — `YamlFrontmatter`, `TomlFrontmatter`, `JsonFrontmatter` — one module each, peering on `@effected/yaml`, `@effected/toml` and `@effected/jsonc` respectively. **Never a namespace object**: the [config-file tree-shaking rule](config-file.md) applies verbatim — a JSON-frontmatter consumer must not pay for the yaml engine. `Frontmatter.schema(MySchema, YamlFrontmatter)` gives typed gray-matter parity. mdast has no native frontmatter parsing story; this is a differentiator.

### Frontmatter `$schema` declarations: a classified grammar plus a resolver seam

Settled 2026-07-18. Frontmatter blocks may self-describe their schema via a `$schema` key; the package classifies the declaration by shape into a tagged union, and this is the full grammar contract. **`ByUrl`** (a string containing `://`) and **`ByPath`** (a string starting `./`, `../` or `/` — a bundle/file-relative reference) are carried as data and never resolved in-package: no IO in the pure tier. **`Inline`** (the value is a mapping — a JSON-Schema-like document) is likewise carried as data, interpretable only via an external resolver — the kit deliberately has no JSON Schema engine (`@effected/json-schema` is off the roadmap; external libraries like json-schema-effect plug in through the resolver seam). **`ByName`** is any other string with a committed grammar: `name[@version]`, split at the **last** `@` so a leading npm-style scope `@` survives (`@savvy/skill@2.1.0` → name `@savvy/skill`, version `2.1.0`). The version grammar is internal and dependency-free: `X[.Y[.Z]]` — one to three dot-separated non-negative integers, with no prerelease, no build metadata and no npm range operators (`^` `~` `>` `<` `||`), which are explicitly out of the grammar; additive grammar extensions later remain compatible, since a previously-malformed string becoming legal breaks nothing. Validation and comparison are ~30 lines in the engine's internal code — `@effected/semver` was consciously declined as a peer so `FrontmatterResolver.ts` depends on nothing. Recorded cost: `@` in a ByName is reserved forever as the version separator, except the leading scope `@`.

Resolution lives behind an in-package seam: a `FrontmatterSchemaResolver` contract that, given the declaration **and** the whole decoded frontmatter data, returns an Effect Schema or fails typed. The package ships exactly one implementation, registry-backed — `SchemaResolver.fromRegistry({ "skill@2.1.0": Skill2, "blog-post": BlogPost })`, registrations carrying concrete versions or no version. Because the resolver sees the whole decoded frontmatter, dispatch need not key on `$schema` at all — an OKF resolver can dispatch on OKF's `type` key with zero OKF code in this package. Strictness knobs: `requireDeclaration` makes a missing `$schema` a typed error, and an unknown name is a typed error in strict decode and a diagnostic in lenient. Indicative error names, final naming at implementation: `SchemaDeclarationMissing`, `SchemaNameUnknown`, `SchemaVersionUnresolvable`.

Day one the grammar is fully validated but resolution is **exact version-segment equality**: a partial version like `skill@2` or `okf/concept@0.1` is legal grammar (one or two integers) yet resolves only against an identically-written registration, otherwise failing with the dedicated `SchemaVersionUnresolvable`, distinct from unknown-name. The documented future minor is **prefix resolution** — the Docker-tag/Go-module mental model: `skill@2` selects the highest registered `2.y.z`, `skill@2.1` the highest `2.1.z` and a full `X.Y.Z` stays exact. No grammar or API change; `SchemaVersionUnresolvable` simply stops firing for satisfiable prefixes — a clean semver-minor evolution for the package itself. Deliberate bonus: OKF's two-number `0.1` style is natively legal in this grammar, where it is not a legal npm-semver version.

### Editing: offset-splice, not a lossless CST

Research finding, recorded: nobody in the JS ecosystem ships a lossless markdown CST — remark's serializer reformats by design, and the remark maintainers themselves recommend positional splicing (remarkjs discussion #719). The edit model is the house pattern: `MarkdownEdit { offset, length, content }` plus `applyAll`, structurally identical to `JsoncEdit`/`YamlEdit`/`TomlEdit` — the cross-package parity contract and the pre-work for the deferred `@effected/text-edit` kernel. Surgical edits are computed as offset-splices over the original source; the canonical `stringify` serves synthesized trees.

### Error posture: parse is (near-)total

CommonMark has no syntax errors — every string is a valid document. The parse error channel carries **only hardening-guard failures** (depth caps, expansion budgets), never "malformed markdown". Diagnostics carry warnings: unresolved link references, present-but-unparseable frontmatter. Strict or failing validation lives at the schema layer, not the parser.

**P1 status** (2026-07-18): the engine emits no non-fatal diagnostics yet — `MarkdownDocument.diagnostics` is real plumbing with no producers until a construct emits one (documented in TSDoc).

### OKF: design-informed, package deferred

OKF (Open Knowledge Format — GoogleCloudPlatform/knowledge-catalog/okf, Apache-2.0, draft v0.1, launched 2026-06-12, single-vendor, no formal grammar or JSON schema, reference implementation contradicting the spec on required frontmatter keys) adds **zero markdown syntax**: it is YAML-frontmatter conventions (one required key, `type`), reserved filenames (`index.md`, `log.md`), bundle-relative links and a directory layout — effectively GFM in practice (its examples use pipe tables). Decision: `@effected/markdown`'s generic surface — frontmatter schemas, heading/section navigation, link extraction, lossless round-trip — must make OKF trivially expressible; a future separate `@effected/okf` package (Concept/Index/Log schemas plus bundle walking over `@effected/walker` and `@effected/glob`) waits for the spec to stabilize past v0.1. The `$schema` resolver seam already covers OKF's dispatch model: because the resolver sees the whole decoded frontmatter, an OKF resolver can key on OKF's `type` field with no OKF code in this package.

## Tier and dependencies

Pure tier under the [three-tier taxonomy](../effect-standards.md#three-tier-library-taxonomy): no IO, the engine is owned in `src/internal/` and there are no external runtime dependencies. `peerDependencies`: `effect` (`catalog:effect`) plus **optional** kit peers `@effected/yaml`, `@effected/toml` and `@effected/jsonc`, consumed only by the respective frontmatter codec modules. `@savvy-web/bundler` is a devDependency only. The commonmark.js port carries upstream attribution and license headers (BSD-2-Clause) per the vendored-port convention the [yaml](yaml.md) and [jsonc](jsonc.md) engines established. `"sideEffects": false`.

## Architecture: two-phase parse, dialect registries

The engine honors CommonMark's own parsing strategy: a **block pass** consuming lines with lazy continuation to build the container/leaf block tree, then an **inline pass** running the delimiter-stack algorithm over each leaf's content. Each construct (heading, fenced code, emphasis, table, footnote, …) is one module under `src/internal/`, registered in a per-dialect block-starts table or inline-trigger table; a dialect is a registry composition, nothing more. The frontmatter block, when enabled, is captured raw at the top of the block pass and never enters the inline pass.

parse = block pass → inline pass → mdast-shaped node tree with offsets and fidelity fields, plus diagnostics. edit/format operate as offset-splices against the original source. stringify is canonical serialization of a node tree. The visitor streams events from a tree walk.

**P1 implementation note** (2026-07-18): the inline pass builds a **mutable linked list** of tokens and materializes the immutable node Schema classes only once that list is final — the array form would reintroduce the quadratic behavior the delimiter stack exists to prevent.

## Module layout

One concern per file, mirroring [yaml's layout](yaml.md#module-layout); `src/index.ts` is the sole barrel:

- `src/Markdown.ts` — the facade: `parse`/`stringify` (`Effect`, typed `E`) and the `MarkdownFromString` schema. **P1 (2026-07-18):** `MarkdownFromString` ships as a two-way codec whose encode fails typed until P4 drops `stringify` into the existing lambda — probed at beta.98, zero signature change later.
- `src/MarkdownDocument.ts` — the lossless unit: source text + tree + frontmatter + diagnostics, plus navigation accessors (headings, sections, links — the OKF-informed surface).
- `src/MarkdownNode.ts` — the node Schema classes, co-located in one file to break the recursive-AST cycle: `Schema.suspend`, no parent pointers, recursive references typed `Schema.Codec<T>`.
- `src/Mdast.ts` — projection to and from plain mdast JSON; the remark-ecosystem interop boundary.
- `src/MarkdownEdit.ts` — the `Edit`/`Range`/`Path`/`Segment` parity vocabulary plus `applyAll`.
- `src/MarkdownFormat.ts` — `format`/`formatToString` (pure, edits) and `modify`/`modifyToString` (`Effect`); `MarkdownFormattingOptions`, `MarkdownModificationError`.
- `src/MarkdownVisitor.ts` — `Stream<MarkdownVisitorEvent>` tree walk, sibling-style and infallible at the type level.
- `src/MarkdownDiagnostic.ts` — the diagnostic core (`code`/`offset`/`length`/`line`/`character`, parity-shaped) plus the error-code unions.
- `src/Frontmatter.ts` — raw capture plus the schema composition seam.
- `src/FrontmatterResolver.ts` — the `$schema` declaration union, the `FrontmatterSchemaResolver` contract and the registry-backed resolver, dependency-free (the version grammar is validated and compared in the engine's internal code); its own module so `Frontmatter.ts` stays a lean composition seam and a consumer who never resolves declarations never loads the resolution machinery.
- `src/YamlFrontmatter.ts` / `src/TomlFrontmatter.ts` / `src/JsonFrontmatter.ts` — the free-standing codecs over the kit peers.
- `src/internal/` — the engine: construct-per-module two-phase parser, the dialect registries and `limits.ts`.

House schema conventions apply throughout: `Schema.Class`/`Schema.TaggedClass`, `X.make` not `new` in public surface, bare `optionalKey` fields with implementation-level defaults, and the Effect-wrapping policy — pure sync where total, `Effect` where the error channel is real, `Stream` for the visitor.

## Hardening

The [input-hardening standards](../effect-standards.md#input-hardening-standards) apply in full:

- `src/internal/limits.ts` is the zero-dependency leaf; `MAX_NESTING_DEPTH = 256` (the cross-package parity constant) guards every **recursive** surface, enumerated per engine: container nesting in the block pass, the delimiter/bracket stacks in the inline pass, stringify recursion and the visitor walk. Iterative surfaces are deliberately unguarded — the toml lesson: know what NOT to guard.
- The cmark pathological suite is the **linear-time guarantee**: markdown's DoS vector is quadratic emphasis/link blowup, defeated by the delimiter-stack algorithm, and the vendored pathological cases with timeout assertions pin it. **P1 (2026-07-18):** the suite is 21 cases, three of them deep-nesting cases the depth guard correctly REFUSES — a `GUARD_REFUSED` set pins that posture. Its budgets are **calibrated** — scaled against a same-code-path baseline measurement rather than raw milliseconds — because v8 coverage instrumentation costs a measured ~18x; a considered, approved decision, and an algorithmic regression still fails because quadratic outruns any constant factor.
- The reference map is keyed through a real `Map` — link labels are attacker-controlled, so this is the prototype-pollution guard.
- Malformed input yields a typed error or a diagnostic, never a defect. The raw-carrier cycle firewall holds: `src/internal/` never imports public modules, and the facade materializes diagnostics. Defect passthrough is proven at the facade — non-carrier errors rethrow.
- **P1 hardening evidence** (2026-07-18): the hardening pass found and fixed five real engine defects — one defect-channel violation, one non-termination and three complexity fixes — recorded as evidence for the enumeration-plus-pathological discipline.
- **Known performance characteristic to revisit before P4/P5:** Schema class construction costs ~17µs per node (~85% of the heaviest pathological case); `MakeOptions.disableChecks` does not help — the cost is `struct.make` field processing. A 1MB document with ~50k nodes pays roughly a second in construction.

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

**P1 (2026-07-18):** the empty skip map held — all 652 spec examples run with zero skips and zero deferrals, and the oracle agrees across the corpus plus 30,000 generated documents. The differential oracle surfaced a genuine `commonmark.js` defect — a phantom empty paragraph emitted from a reference-only paragraph before a thematic break — resolved by a narrow oracle-side correction plus a tripwire test that fails when upstream fixes it.

The `$schema` contract adds its own unit and property coverage: declaration shape classification across the four variants, version grammar validation (one to three integer segments, junk rejected as a typed error), the last-`@` split including scoped names, day-one exact-match resolution against the registry and the prefix-selector-parses-but-unresolvable vs unknown-name distinction (`SchemaVersionUnresolvable` vs `SchemaNameUnknown`).

## Consumer seam

rspress-plugin-api-extractor is the identified consumer: the `Mdast` projection replaces `mdast-util-from-markdown` output and the frontmatter codecs replace `gray-matter`, adopted incrementally at that repo's boundary. Nothing in this package knows about any consumer; like its format siblings, it stays a pure, unaware format package, and any future codec-style integration (config-file, okf) points its dependency arrow **at** markdown, never from it.

## Open questions

**hast output.** Porting `mdast-util-to-hast` so the kit could emit hast trees directly was raised, since rspress-plugin-api-extractor uses it today. Decision: deferred, with an explicit decision gate — revisit after the rspress plugin's actual adoption (the P6 docs/adoption phase) shows whether keeping its one remaining `mdast-util-to-hast` dependency is a real cost. Either way the `Mdast` projection is the bridge: consumers render via `toHast` over the projected plain-mdast tree, and the P6 docs ship that recipe. HTML string serialization remains permanently out of scope regardless of how this resolves. If the question later closes toward porting, the shape already sketched is in-package free-standing `Hast`/`ToHast` modules — tree-shakable, extractable to an `@effected/okf`-style separate package only on second-consumer evidence.

## Parity notes

- `MarkdownEdit` and `MarkdownRange` are field-identical to `JsoncEdit`/`YamlEdit`/`TomlEdit` (`{ offset, length, content }`); the diagnostic core carries the shared five fields. This is the binding cross-package parity contract and the pre-work for the deferred `@effected/text-edit` kernel.
- The error posture diverges from the siblings for a spec reason, not a design one: there is no "malformed markdown", so the parse `E` channel is guards-only and the diagnostics array does the recoverable-parse work.
- Size calibration for planning: the siblings sit at roughly 4.0k (toml) and 12.6k (yaml) src LOC; markdown is estimated to land between, closer to yaml, at 6-10k.

## Phased roadmap

Each phase lands green and mergeable:

- **P0** — this design doc (the migration-playbook gate).
- **P1** — CommonMark core: scaffold from the pure sibling, block and inline passes, mdast-shaped nodes with offsets, `Markdown.parse` plus `MarkdownDocument`, the 652-example spec corpus and the pathological suite green. The long pole, **COMPLETE 2026-07-18** on `feat/markdown` (commits `a9ee0e5` through `ab931fbe`): 972 package tests, 0 failures; the conformance harness runs all 652 spec examples with zero skips and zero deferrals; the 21-case pathological suite passes with three deep-nesting cases correctly REFUSED by the depth guard (a `GUARD_REFUSED` set pins that posture); the differential oracle (`commonmark@0.31.2`, exact-pinned devDep) agrees on the full corpus plus 30,000 generated documents.
- **P2** — GFM dialect: construct modules plus the dialect option; corpora 2 and 3 green.
- **P3** — frontmatter: the capture node, `Frontmatter.schema` and the three codecs, plus the `$schema` declaration contract and the registry-backed resolver with exact-match resolution.
- **P4** — edit/format: the parity vocabulary, offset-splice `modify`, canonical `stringify` and `format`.
- **P5** — interop and traversal: the `Mdast` projection (fixture corpus green), `MarkdownVisitor` and the navigation accessors.
- **P6** — docs and adoption: the api-extractor model plus website docs, dogfooded via the rspress-plugin-api-extractor swap.
- **Future/deferred**: the `obsidian` dialect; the `@effected/okf` package; prefix `$schema` version resolution (the committed semver-minor evolution of the resolver).

## Build and scaffold

Standard [package-setup.md](../package-setup.md) mechanics: copy the pure sibling (toml), `"private": true`, `"sideEffects": false`, exports `"."` plus `"./package.json"`, `tsc --noEmit` typecheck, `turbo.json` outputs including `website/lib/models/markdown`, the narrow `ae-forgotten-export`/`_base` suppression in `savvy.build.ts` per the [API-Extractor policy](../effect-standards.md#api-extractor--effect-class-factories), a stub `src/index.ts` before first install, and builds only via `pnpm build --filter`. devDependencies add the exact-pinned `commonmark` oracle — never in `dependencies`, never drifting from the ported version.
