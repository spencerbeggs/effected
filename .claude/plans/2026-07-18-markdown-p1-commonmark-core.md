---
status: pending
module: effected
created: 2026-07-18
related:
  - ../design/effected/packages/markdown.md
  - ../design/effected/effect-standards.md
  - ../design/effected/package-setup.md
  - ../design/effected/migration-playbook.md
  - ../design/effected/roadmap.md
---

# @effected/markdown P1 — CommonMark Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land phase P1 of `@effected/markdown`: a scaffolded pure-tier package whose ported commonmark.js engine parses CommonMark 0.31.2 into mdast-shaped Effect Schema nodes with byte offsets, green against the vendored 652-example spec corpus and the cmark pathological suite, exposed through `Markdown.parse`/`Markdown.parseResult` and `MarkdownDocument`.

**Architecture:** Two-phase port of commonmark.js (`.repos/commonmark-js/lib/blocks.js` then `lib/inlines.js`), restructured construct-per-module under `src/internal/` with dialect-keyed registries (P1 registers only the `commonmark` construct set; `gfm` constructs land in P2 as new modules, no API change). Three port deltas decided in the design doc: mdast node names, byte-offset tracking everywhere, and link-reference `definition` nodes kept in the tree with `linkReference`/`imageReference` emitted unresolved. Parse is near-total: the typed error channel carries only hardening-guard failures; everything else is diagnostics. Conformance is asserted by a **test-only** HTML writer + normalizer in `__test__/` (the mdast-util-from-markdown precedent) — the product ships no HTML.

**Tech Stack:** TypeScript (NodeNext, `exactOptionalPropertyTypes`), `effect@4.0.0-beta.98` (`catalog:effect`), `@effect/vitest` (+ `FastCheck` from `effect/testing`), `commonmark@0.31.2` exact-pinned as **differential test oracle only**, `entities@6.0.1` exact-pinned as **entity-map generation source only** (devDependency; generated data committed with attribution), `@savvy-web/bundler`, Biome, Turbo.

**Spec:** `.claude/design/effected/packages/markdown.md` (nine headline decisions — read it first). House pattern: the `effected:building-a-format-package` and `effected:hardening-a-parser-port` plugin skills. Port base and corpora are vendored in `.repos/` (see each repo's `orientation` block in `.repos/config.json`); if `.repos/` checkouts are empty, run `savvy repos sync` once.

## Global Constraints

- **Tier: pure.** `peerDependencies` is exactly `{ "effect": "catalog:effect" }` in P1 (the yaml/toml/jsonc frontmatter-codec peers arrive in P3). Zero runtime dependencies, zero IO, no `R` anywhere.
- **Oracle discipline:** `commonmark` and `entities` imports appear ONLY under `__test__/` (oracle/property tests and the entity-map generation script), never in `src/`. Both exact-pinned, no caret.
- **Engine ownership:** `src/internal/` is a port with attribution — each ported module's header records `commonmark.js@0.31.2` (BSD-2-Clause) per the house vendored-engine pattern (see `packages/glob/src/internal/` headers for the form). Never modify license text in attribution headers.
- **Cycle firewall:** `src/internal/` never imports public modules. The engine throws/returns raw carriers (`{ code, message, offset, length }`); only the facade materializes `MarkdownDiagnostic` and tagged errors. The sanctioned exception (toml precedent): the engine may import leaf node classes from `MarkdownNode.ts` because nodes are import leaves. `noImportCycles` is error-level.
- **mdast names are the contract:** node `type` strings and field names must match `.repos/mdast/readme.md` exactly (`root`, `paragraph`, `heading`, `thematicBreak`, `blockquote`, `list`, `listItem`, `code`, `html`, `definition`, `text`, `emphasis`, `strong`, `inlineCode`, `break`, `link`, `image`, `linkReference`, `imageReference`). Fidelity fields ride alongside as extra `optionalKey` fields; P5's `Mdast` projection strips them.
- **Positions:** unist shape — `{ start: { line, column, offset }, end: { line, column, offset } }`, 1-based line/column, 0-based offset. Every node carries one. commonmark.js has no offsets (line/column only) — offset tracking is added during the port, not bolted on after.
- **Error posture:** `Markdown.parse` fails ONLY on guard trips (`MarkdownParseError` wrapping a diagnostic with code `NestingDepthExceeded` etc.). Malformed markdown does not exist (every string is a valid document); recoverable oddities are diagnostics on the document. A defect passthrough test proves programmer errors still escape (hardening skill invariant).
- **parseResult parity (issue #115):** the pure sync `Markdown.parseResult` is the primitive; the Effect `Markdown.parse` is defined in terms of it behind its named `Effect.fn` span so the two can never diverge. `parseResult` carries no span (it is not an Effect); its TSDoc points Effect consumers at `parse`.
- Tests: `@effect/vitest`, `assert.*` — **never `expect`**; unit tests in `packages/markdown/__test__/`, conformance in `__test__/e2e/`. Run subsets with `pnpm vitest run packages/markdown/__test__/<file>` and read the `Tests:` line (subset runs fail global coverage by design — ignore the coverage gate, never the Tests line).
- Only `src/index.ts` re-exports (no-barrel rule); all other modules import explicitly with `.js` extensions.
- **Never run `node savvy.build.ts --target prod` directly** — always `pnpm build --filter @effected/markdown`.
- After any `pnpm install`, check `git diff pnpm-lock.yaml`: only the new importer may change — mass `optional: true` deletions mean a poisoned install; stop and re-install.
- Commits: conventional format, plain-prose bodies (no markdown), DCO signoff `Signed-off-by: C. Spencer Beggs <spencer@beggs.codes>`. Compose to a file and commit via the silk commit-create script.
- Verify any uncertain v4 API against `.repos/effect-smol` (rung 2) or a probe from inside `packages/markdown` (rung 3) — never memory, never a probe from the workspace root (it resolves effect v3).
- **MAX_NESTING_DEPTH = 256** (cross-package parity constant) in `src/internal/limits.ts`, a zero-dependency leaf.
- Out of scope for P1: GFM constructs, frontmatter (P3 — the block pass must not special-case `---` at offset 0 in P1), edit/format (P4), `Mdast` projection and visitor (P5), smart punctuation (never — commonmark.js `smart` option is not ported), product HTML (never).

---

### Task 1: Scaffold the package

**Files:**
- Create: `packages/markdown/package.json`, `tsconfig.json`, `turbo.json`, `tsdoc.json`, `savvy.build.ts`, `LICENSE`, `src/index.ts` (stub), `__test__/.gitkeep`
- Reference: `packages/toml/*` (copy-and-rename source), `.claude/design/effected/package-setup.md`

**Interfaces:**
- Produces: an installable, buildable empty `@effected/markdown` workspace package every later task lands inside.

- [ ] **Step 1:** Copy the toml package's config files per `package-setup.md`: name `@effected/markdown`, description "CommonMark and GFM markdown parse, edit and transform schemas for Effect", `repository.directory: packages/markdown`, `homepage` with the `/tree/main/` segment, `"private": true`, `"sideEffects": false`, exports `"."` → `./src/index.ts` plus `"./package.json"`, `peerDependencies: { "effect": "catalog:effect" }`, devDependencies `@savvy-web/bundler` + `typescript` (`catalog:silk`) + `@effect/vitest` (`catalog:effect`). `turbo.json` outputs and `savvy.build.ts` `localPaths` name `../../website/lib/models/markdown` (the package's OWN name). `savvy.build.ts` carries the narrow `{ messageId: "ae-forgotten-export", pattern: "_base" }` suppression.
- [ ] **Step 2:** Write the stub `src/index.ts` (`export {}` with a `@packageDocumentation` TSDoc block) **BEFORE running any install** — a manifest with no entrypoint breaks every `pnpm run` in the repo.
- [ ] **Step 3:** `pnpm install`, then `git diff pnpm-lock.yaml` — only the new importer may appear.
- [ ] **Step 4:** `pnpm build --filter @effected/markdown` — green; `pnpm vitest run packages/markdown` — reports no tests (exit acceptable), typecheck `pnpm --filter @effected/markdown types:check` — green.
- [ ] **Step 5:** Commit (`feat(markdown): scaffold the package`).

---

### Task 2: Vendor the conformance corpora

**Files:**
- Create: `packages/markdown/__test__/fixtures/commonmark/spec.json`, `__test__/fixtures/commonmark/VENDORED.md`, `__test__/fixtures/pathological/cases.ts`, `__test__/fixtures/pathological/VENDORED.md`, `__test__/e2e/support/corpus.ts`, `__test__/e2e/corpus-guard.test.ts`

**Interfaces:**
- Produces: `loadSpecExamples(): ReadonlyArray<SpecExample>` where `SpecExample = { markdown: string; html: string; example: number; section: string }` (from `corpus.ts`); `PATHOLOGICAL_CASES: ReadonlyArray<{ name: string; input: string; expectedPattern: RegExp; timeoutMs: number }>`.

- [ ] **Step 1:** Generate the spec corpus from the pinned submodule: `python3 .repos/commonmark-spec/test/spec_tests.py --spec .repos/commonmark-spec/spec.txt --dump-tests > packages/markdown/__test__/fixtures/commonmark/spec.json`. Write `VENDORED.md`: upstream `commonmark/commonmark-spec`, tag `0.31.2`, commit `9103e341`, license CC-BY-SA 4.0 (test-only vendoring with attribution; not shipped in the artifact).
- [ ] **Step 2:** Port the pathological cases from `.repos/cmark-gfm/test/pathological_tests.py` into `cases.ts` as data (input builders like `"*a **a".repeat(65535)`, expected-output regex, per-case timeout 8000ms). Take every case that does not depend on a GFM extension (those join in P2). `VENDORED.md`: upstream `github/cmark-gfm` `0.29.0.gfm.13`, BSD-style license, adapted-as-data attribution.
- [ ] **Step 3:** Write `corpus.ts` (read `spec.json` with `node:fs` — test-side IO is fine) and `corpus-guard.test.ts`: `assert.strictEqual(loadSpecExamples().length, 652)` and `assert.isAtLeast(PATHOLOGICAL_CASES.length, 20)` — the silently-empty-walk guard (toml precedent).
- [ ] **Step 4:** Run the guard test — PASS. Commit (`test(markdown): vendor the commonmark and pathological corpora`).

---

### Task 3: Diagnostics, limits, and the line index

**Files:**
- Create: `src/MarkdownDiagnostic.ts`, `src/internal/limits.ts`, `src/internal/carriers.ts`, `src/internal/lineIndex.ts`
- Test: `__test__/diagnostic.test.ts`, `__test__/line-index.test.ts`

**Interfaces:**
- Produces: `MarkdownDiagnostic` Schema.Class with the parity five (`code: string; message: string; offset: number; length: number; line: number; character: number` — field-identical to `TomlDiagnostic`, check `packages/toml/src/TomlDiagnostic.ts` and mirror); `MarkdownParseErrorCode` union (P1: `"NestingDepthExceeded"`); `MAX_NESTING_DEPTH = 256`; raw carrier `interface RawMarkdownError { code, message, offset, length }` + `isRawMarkdownError` predicate + `GuardExceeded` carrier + predicate; `LineIndex.make(text): LineIndex` with `positionAt(offset): { line, column }` (iterative, binary search over line starts).

- [ ] **Step 1:** Write failing unit tests: diagnostic construction/equality; `LineIndex.positionAt` on empty string, `\n` boundaries, CRLF, final char, out-of-range clamping.
- [ ] **Step 2:** Implement; run tests — PASS. `limits.ts` imports nothing; `carriers.ts` imports nothing public.
- [ ] **Step 3:** Commit (`feat(markdown): diagnostics, guard limits and the line index`).

---

### Task 4: MarkdownNode — the 19 mdast-shaped node classes

**Files:**
- Create: `src/MarkdownNode.ts` (single module — co-location breaks the recursive-AST cycle)
- Test: `__test__/node.test.ts`

**Interfaces:**
- Produces (exact names later tasks and P2+ rely on): `Point` (Schema.Class `{ line: number; column: number; offset: number }`), `Position` (`{ start: Point; end: Point }`), and node classes `Root, Paragraph, Heading, ThematicBreak, Blockquote, List, ListItem, Code, Html, Definition, Text, Emphasis, Strong, InlineCode, Break, Link, Image, LinkReference, ImageReference` — each `Schema.Class` (or `TaggedClass` keyed on `type`) with mdast field shapes: `Heading { depth: 1|2|3|4|5|6; children }`, `List { ordered: boolean; start?: number; spread: boolean; children }`, `Code { lang?: string; meta?: string; value: string }`, `Definition { identifier: string; label?: string; url: string; title?: string }`, `LinkReference { identifier; label?; referenceType: "shortcut"|"collapsed"|"full"; children }`, etc. — read `.repos/mdast/readme.md` for every field, do not trust this summary. Content unions: `FlowContent`, `PhrasingContent` via `Schema.Union` + `Schema.suspend`, recursive refs typed `Schema.Codec<T>`. Fidelity extras (all `Schema.optionalKey`): `Heading.headingStyle: "atx"|"setext"`, `Code.fenceChar: "`"|"~"` + `Code.fenceLength: number` (absent = indented), `List.bulletChar` / `List.delimiter`, `ThematicBreak.markerChar`, `Emphasis.markerChar` / `Strong.markerChar`, `Break.breakStyle: "backslash"|"spaces"`.
- Consumes: nothing (import leaf — the engine imports THIS module, never the reverse).

- [ ] **Step 1:** Write failing tests: construct a small document tree with `X.make`, assert structural equality of two identical trees, assert `type` literals match the mdast names, decode/encode round-trip through `Schema.decodeUnknownSync(Root)` on a plain-object tree, a depth-40 nested blockquote tree decodes (suspend recursion works).
- [ ] **Step 2:** Implement all classes inline-factory style (api-extractor bases policy); `optionalKey` for every optional — never explicit `undefined` (constructor validation throws on it at beta.98; use conditional spreads).
- [ ] **Step 3:** Run tests — PASS; `pnpm --filter @effected/markdown types:check` — green.
- [ ] **Step 4:** Commit (`feat(markdown): mdast-shaped node schema classes with positions`).

---

### Task 5: Test-only HTML writer and normalizer

**Files:**
- Create: `__test__/e2e/support/htmlWriter.ts`, `__test__/e2e/support/normalizeHtml.ts`
- Test: `__test__/e2e/support/html-writer.test.ts`

**Interfaces:**
- Produces: `renderHtml(root: Root): string` (spec-conventional HTML: `<p>`, `<h1..6>`, `<pre><code class="language-x">`, `<blockquote>`, `<ul>/<ol start>/<li>` with tight/loose rules from `List.spread`, `<em>/<strong>`, `<a href title>`, `<img src alt title>`, `<br />`, `<hr />`, raw `Html.value` passthrough, entity/percent-encoding per commonmark.js `lib/render/html.js` — port its escaping rules exactly); `normalizeHtml(html: string): string` (port the rules of `.repos/commonmark-spec/test/normalize.py`: collapse insignificant whitespace between block tags, normalize attribute order/quoting, decode entities to a canonical form).
- Consumes: `MarkdownNode` classes (Task 4). Lives entirely under `__test__/` — never shipped.

- [ ] **Step 1:** Write failing writer tests on hand-built trees (one per node type, incl. `Definition` rendering to NOTHING and `LinkReference` unresolved-fallback rendering: a shortcut reference with a matching `Definition` in the tree renders as `<a>`, without one renders as literal text — resolution against the tree's definitions happens in the writer, since the parser deliberately keeps references unresolved).
- [ ] **Step 2:** Implement; PASS. Commit (`test(markdown): conformance html writer and normalizer`).

---

### Task 6: Block pass I — preprocessing, leaf blocks, the registry

**Files:**
- Create: `src/internal/preprocess.ts` (line splitting keeping offsets, U+0000 → U+FFFD, tab-stop arithmetic helpers), `src/internal/blockRegistry.ts` (`interface BlockStart { trigger: (p) => ...; continue: (p) => ... }`, the `commonmark` dialect's ordered block-starts table), `src/internal/blocks/{document,paragraph,atxHeading,thematicBreak,indentedCode}.ts`, `src/internal/blockParser.ts` (the line loop: open-block matching, closing, lazy-continuation slot — ported from `.repos/commonmark-js/lib/blocks.js` `incorporateLine`)
- Test: `__test__/block-pass.test.ts`, `__test__/e2e/commonmark-spec.e2e.test.ts` (harness, section-filtered)

**Interfaces:**
- Produces: `parseBlocks(text: string): { root: Root; rawInlines: ReadonlyArray<RawInlineSlice>; carriers: RawMarkdownError[] }` where `RawInlineSlice = { parent: Paragraph | Heading; text: string; startOffset: number }` — leaf blocks hold raw inline text + offset for Task 8/9 to consume; every emitted node has a complete `Position` with offsets.
- Produces: the e2e harness — one `it.effect` per spec example: `renderHtml(parse(ex.markdown))` normalized-equals `normalizeHtml(ex.html)`, with a `SECTIONS_GREEN` allowlist constant gating which sections run (grows task by task; the allowlist is the inverse of a skip map and must reach "all" by Task 9).
- Port map: `blocks.js` `advanceOffset/advanceNextNonspace/findNextNonspace` → `blockParser.ts` scanner state; `blocks.starts[]` array → `blockRegistry.ts`; per-construct `continue`/`finalize` → each construct module.

- [ ] **Step 1:** Write the harness + unit tests for tabs/precedence cases; `SECTIONS_GREEN = ["Tabs", "Backslash escapes"...]` — no: P1 Task 6 gate is `["Tabs", "Precedence", "Thematic breaks", "ATX headings", "Indented code blocks", "Paragraphs", "Blank lines"]` (inline-dependent examples inside those sections assert against Text passthrough — mark the handful that require inline parsing with a per-example deferral list, each entry commented with its example number and the task that clears it).
- [ ] **Step 2:** Port preprocessing + the five constructs + the line loop. Offsets: every `advanceOffset` mutation also advances an absolute `offset` counter; node open/close records `Point`s via offset + LineIndex.
- [ ] **Step 3:** Run the gated harness — PASS for the allowlisted sections; unit tests PASS.
- [ ] **Step 4:** Commit (`feat(markdown): block pass core with leaf blocks`).

---

### Task 7: Block pass II — containers, fences, HTML blocks, definitions

**Files:**
- Create: `src/internal/blocks/{setextHeading,fencedCode,htmlBlock,blockquote,list,linkReferenceDefinition}.ts`
- Modify: `src/internal/blockRegistry.ts` (register), `src/internal/blockParser.ts` (container stack + lazy continuation completion + `MAX_NESTING_DEPTH` guard on container depth)
- Test: extend `__test__/block-pass.test.ts`; widen `SECTIONS_GREEN`

**Interfaces:**
- Produces: full CommonMark block grammar. `Definition` nodes stay in the tree at their source position (the delta from commonmark.js, which strips them — port `linkReferenceDefinition` from `lib/blocks.js` `parseReference` but emit a node instead of deleting); the parser also returns `refmap: ReadonlyMap<string, Definition>` (normalized labels per spec case-folding) for the writer and later phases. Container depth guard: exceeding 256 open containers emits the `NestingDepthExceeded` carrier (single, deduped) and refuses deeper nesting.
- Fidelity: `List.bulletChar`/`delimiter`, `Code.fenceChar/fenceLength`, `Heading.headingStyle`.

- [ ] **Step 1:** Extend unit tests (laziness cases from spec §"Blockquotes"/"Lists", fence info strings, HTML block types 1–7, reference-definition edge labels) as failing tests.
- [ ] **Step 2:** Port the six constructs + container machinery.
- [ ] **Step 3:** Widen `SECTIONS_GREEN` += `["Setext headings", "Fenced code blocks", "HTML blocks", "Link reference definitions", "Block quotes", "List items", "Lists"]` (same per-example deferral discipline for inline-dependent examples) — run harness, PASS.
- [ ] **Step 4:** Commit (`feat(markdown): container blocks, fences, html blocks and kept definitions`).

---

### Task 8: Inline pass I — spans, escapes, entities, autolinks, raw HTML, breaks

**Files:**
- Create: `src/internal/inlineRegistry.ts` (char-trigger table for the `commonmark` dialect), `src/internal/inlines/{codeSpan,escape,entity,autolink,rawHtml,lineBreak,text}.ts`, `src/internal/inlineParser.ts` (ported from `lib/inlines.js` minus emphasis/links), `src/internal/entityMap.ts` (generated data)
- Create: `__test__/tools/generate-entities.ts` (one-off generator reading the `entities` devDependency's HTML5 map, emitting `entityMap.ts` with an attribution header: source `entities@6.0.1` MIT / WHATWG)
- Test: `__test__/inline-pass.test.ts`; widen `SECTIONS_GREEN`

**Interfaces:**
- Produces: `parseInlines(slice: RawInlineSlice, refmap): PhrasingContent[]` wired into the block parser's finalize step, so `parseBlocks` output now has real children under `Paragraph`/`Heading`. All inline node positions are absolute (slice `startOffset` + local offset).
- Consumes: `RawInlineSlice` (Task 6), `refmap` (Task 7 — unused until Task 9 but threaded now so the signature is final).

- [ ] **Step 1:** Generate + commit `entityMap.ts` (`pnpm vitest` must never regenerate it; the generator is run manually via `node --experimental-strip-types __test__/tools/generate-entities.ts`).
- [ ] **Step 2:** Failing unit tests per construct (backtick fences, escape set, named/numeric entities incl. out-of-range → U+FFFD, email/URI autolinks, raw HTML tag forms, backslash vs double-space breaks).
- [ ] **Step 3:** Port the constructs + the inline loop skeleton (delimiter stack slots present but emphasis module arrives Task 9).
- [ ] **Step 4:** `SECTIONS_GREEN` += `["Backslash escapes", "Entity and numeric character references", "Code spans", "Autolinks", "Raw HTML", "Hard line breaks", "Soft line breaks", "Textual content", "Inlines"]`; clear every per-example deferral marked for this task; harness PASS.
- [ ] **Step 5:** Commit (`feat(markdown): inline pass with spans, entities, autolinks and breaks`).

---

### Task 9: Inline pass II — the delimiter stack: emphasis and links

**Files:**
- Create: `src/internal/inlines/{emphasis,link}.ts` (ported from `lib/inlines.js` `handleDelim/processEmphasis` and `parseOpenBracket/parseCloseBracket/parseLinkDestination/...`)
- Modify: `src/internal/inlineParser.ts`
- Test: extend `__test__/inline-pass.test.ts`; `SECTIONS_GREEN` → ALL

**Interfaces:**
- Produces: complete CommonMark inline grammar. Reference links resolve their `referenceType` (`full`/`collapsed`/`shortcut`) and label but are emitted as `LinkReference`/`ImageReference` nodes whether or not the refmap has a match (the design's unresolved-reference delta); inline links/images emit `Link`/`Image`. Emphasis fidelity: `markerChar: "*" | "_"`.
- The delimiter stack and bracket stack are the iterative algorithms — they need no depth cap (know what NOT to guard), but the **node tree they build** can nest; the builder shares the container depth counter.

- [ ] **Step 1:** Failing unit tests: the multiplied-of-3 rule cases, `*foo**bar**baz*` shapes, link precedence over emphasis, nested brackets, collapsed/shortcut/full reference forms with and without definitions.
- [ ] **Step 2:** Port emphasis + links.
- [ ] **Step 3:** Set `SECTIONS_GREEN` to ALL 26 sections, delete the deferral list entirely (empty-skip-map goal) — run the full 652 — PASS.
- [ ] **Step 4:** Commit (`feat(markdown): delimiter stack emphasis and link parsing, full corpus green`).

---

### Task 10: Hardening and the pathological suite

**Files:**
- Create: `__test__/e2e/pathological.e2e.test.ts`, `__test__/hardening.test.ts`
- Modify: whatever the enumeration finds

**Interfaces:**
- Consumes: `PATHOLOGICAL_CASES` (Task 2).

- [ ] **Step 1:** Enumerate every recursion surface (hardening-skill discipline): grep self-recursion across `src/`; expected surfaces — Schema suspend decode (capped by depth guard via container counter at parse), the test HTML writer (test-only, cap anyway to 256+ margin), any recursive finalize. Document the enumeration in the test file's header comment; iterative surfaces (line loop, delimiter stack, bracket stack) are listed as deliberately unguarded.
- [ ] **Step 2:** Pathological e2e: each case runs `parseResult` under its timeout, asserts the expected output regex via the test writer — all cases PASS within timeout (linear-time evidence).
- [ ] **Step 3:** Hardening unit tests: deep-nesting inputs (`">".repeat(300) + "a"`, 300-deep lists) fail typed with ONE `NestingDepthExceeded` diagnostic — never a `RangeError` defect; refmap uses a real `Map` (probe `[__proto__]: /x` reference labels — no pollution, test asserts `Object.prototype` untouched); defect passthrough (a deliberately-thrown non-carrier inside a hooked construct escapes as a defect, not a typed error).
- [ ] **Step 4:** Commit (`test(markdown): pathological suite and hardening regressions`).

---

### Task 11: The facade — Markdown.ts and MarkdownDocument.ts

**Files:**
- Create: `src/Markdown.ts`, `src/MarkdownDocument.ts`
- Modify: `src/index.ts` (real re-exports replace the stub)
- Test: `__test__/markdown.test.ts`, `__test__/document.test.ts`, `__test__/oracle.property.test.ts`

**Interfaces:**
- Produces:
  - `Markdown.parseResult(text: string, options?: MarkdownParseOptions): Result<Root, MarkdownParseError>` — the pure primitive; catches raw carriers, materializes diagnostics + `MarkdownParseError` (Schema.TaggedErrorClass carrying the diagnostic), **rethrows non-carriers** (defect passthrough).
  - `Markdown.parse: (text, options?) => Effect<Root, MarkdownParseError>` — `Effect.fn("Markdown.parse")` over `Effect.fromResult(parseResult(...))` (verify `Effect.fromResult` against the beta — it exists at beta.98, `Effect.ts:~2390`).
  - `MarkdownParseOptions` Schema.Class: `dialect?: "commonmark"` (P2 widens the union), bare `optionalKey` + impl-level defaults.
  - `MarkdownFromString` — `Schema.Codec<Root, string>` decode-side parse (encode arrives P4 with stringify; P1 encode fails typed with a `MarkdownStringifyUnsupported` tagged error documented as P4 scope — or use a one-way transform if the codec form fights the beta; verify with a probe and record which).
  - `MarkdownDocument.parse(text, options?)` → `Effect<MarkdownDocument>`; class fields `source: string`, `root: Root`, `diagnostics: ReadonlyArray<MarkdownDiagnostic>`, `definitions: ReadonlyMap<string, Definition>`; plus `parseResult` sibling. Navigation accessors are P5 — do not add them.
- Consumes: everything above.

- [ ] **Step 1:** Failing facade tests: parse returns Root; guard input fails typed with the diagnostic populated (line/character derived); `parseResult` and `parse` agree on both channels for the same inputs; options default dialect.
- [ ] **Step 2:** Implement facade + real `index.ts` (re-export-only, `@packageDocumentation`).
- [ ] **Step 3:** Oracle property test: `commonmark@0.31.2` devDep (exact), 250 `FastCheck` runs over a markdown-ish string arbitrary + the full spec corpus inputs: our writer-rendered normalized HTML equals the oracle's normalized HTML; disagreements fail with the input attached (corpus wins on disagreement — investigate, never skip-list).
- [ ] **Step 4:** Property tests: `parseResult` never throws (arbitrary unicode strings incl. lone surrogates, U+0000, 1MB inputs); every node position satisfies `0 <= start.offset <= end.offset <= text.length` via a tree walk.
- [ ] **Step 5:** Full suite: `pnpm vitest run packages/markdown` — all green. Commit (`feat(markdown): parse facade, document model and differential oracle`).

---

### Task 12: Package gates

**Files:**
- Modify: TSDoc across `src/` public symbols as issues demand

- [ ] **Step 1:** `pnpm build --filter @effected/markdown` — then read `packages/markdown/dist/prod/issues.json`: zero warnings outside the suppressed `_base` bucket (tsdoctor pass if not).
- [ ] **Step 2:** `pnpm exec biome check packages/markdown` and `pnpm lint:md` — clean.
- [ ] **Step 3:** Full repo test run for the package + corpus one more time from clean; read the Tests line.
- [ ] **Step 4:** Commit (`chore(markdown): pass the build and doc gates`) and report: corpus counts green (652 + pathological), surfaces enumerated, any deviations from this plan for the design doc's post-P1 sync.

---

## Self-review notes

- Spec coverage: design-doc P1 scope = scaffold, block+inline passes, mdast nodes with offsets, `Markdown.parse` + `MarkdownDocument`, 652 + pathological green — Tasks 1–12 cover each; frontmatter/GFM/edit/visitor/Mdast explicitly deferred per phase plan.
- The `SECTIONS_GREEN` allowlist replaces a skip map with its inverse: it must monotonically grow and reach ALL by Task 9, with per-example deferrals always commented with the clearing task. This keeps every intermediate commit green without ever committing a skip.
- Type consistency: `RawInlineSlice`, `refmap`, `parseBlocks`/`parseInlines` signatures are defined once (Tasks 6–8) and consumed by name; node class names fixed in Task 4 and used verbatim after.
- Known probe points flagged inline: `Effect.fromResult` existence (verified via ticket #113 evidence), `MarkdownFromString` codec encode posture (Task 11 records the probe outcome).
