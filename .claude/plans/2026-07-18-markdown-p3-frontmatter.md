---
status: pending
module: effected
created: 2026-07-18
related:
  - ../design/effected/packages/markdown.md
  - ../design/effected/effect-standards.md
  - ./2026-07-18-markdown-p1-commonmark-core.md
  - ./2026-07-18-markdown-p2-gfm.md
---

# @effected/markdown P3 — Frontmatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land phase P3: frontmatter — the raw capture node behind a parse toggle, the `Frontmatter.schema` composition seam, the three free-standing codec modules over optional kit peers, and the `$schema` declaration contract with the registry-backed exact-match resolver.

**Architecture:** The design doc (`.claude/design/effected/packages/markdown.md`, §"Frontmatter: the config-file codec pattern, in-package" and §"Frontmatter `$schema` declarations") is the authority — read both sections before every task. The engine captures the frontmatter block raw at the top of the block pass, only when enabled; it never enters the inline pass. Schema decoding is public-module territory: three free-standing codecs peering on `@effected/yaml`, `@effected/toml` and `@effected/jsonc` — **never a namespace object** (the config-file tree-shaking rule applies verbatim). Resolution lives in its own dependency-free module (`FrontmatterResolver.ts`) so a consumer who never resolves declarations never loads the machinery.

**Tech Stack:** unchanged plus three OPTIONAL `peerDependencies`: `@effected/yaml`, `@effected/toml`, `@effected/jsonc` — mirror `packages/config-file/package.json`'s peer declarations (ranges and `peerDependenciesMeta.optional`) exactly. Zero new external dependencies; the version grammar in the resolver is hand-rolled (~30 lines) — `@effected/semver` was consciously declined (design ruling).

**P2 facts this plan builds on** (all committed): 1881/1881 whole-package baseline; the 652-example corpus runs under BOTH dialects via the matrix with an asserted 11-example divergence list — that matrix plus the GFM allowlists (22/22, 30/30) are the regression net for every P3 task; the hook-placement rule and seam-factory pattern are recorded in the building-a-format-package skill; `MarkdownParseOptions` uses bare `optionalKey` with impl-level defaults (dialect default `gfm` at the facade); the P2 build-gate lesson: **new public modules must join `src/index.ts` in the same task that creates them** — the build gate catches forgotten exports only at phase end otherwise.

## Global Constraints

- All P1 and P2 Global Constraints carry over verbatim (tier, cycle firewall, mdast names, positions, error posture, no-barrel, commit mechanics, whole-package verification discipline, .repos read-only, plain-prose commits with DCO signoff).
- **Frontmatter capture defaults OFF.** An enabled capture changes how `---` at offset 0 parses, and the spec corpora contain such documents; the toggle (`MarkdownParseOptions.frontmatter`, bare `optionalKey` boolean, impl default `false`) is the consumer's opt-in. The conformance harnesses stay untouched and green with capture off. Record this as a P3 ruling in the phase-end design-doc sync.
- **Both dialect corpora and the 652×2 matrix stay green at every task** — the P2 regression net is the P3 net too.
- `src/internal/` never imports the kit peers — only the public codec modules do. The engine's capture carries raw text and a format marker; it decodes nothing.
- The three codecs are free-standing named exports, one module each; `ConfigCodec`-style interface parity is welcome but **no dependency on `@effected/config-file`** and no namespace object, ever.
- mdast field shapes win over any summary here — read the mdast readme's Frontmatter section before writing the capture node.

---

### Task 1: The capture node and the parse toggle

**Files:** `src/MarkdownNode.ts` (the frontmatter node), `src/internal/blocks/frontmatter.ts` (the capture construct), block-parser/registry wiring, `src/Markdown.ts` (`MarkdownParseOptions.frontmatter`), `src/index.ts` (export the new node — the P2 lesson), `__test__/gfm-frontmatter.test.ts` sibling-style unit tests.

**Node shape decision (make it, record it):** mdast's frontmatter story is `Yaml { type: "yaml", value }` (readme) plus the `toml` extension node; there is no standard JSON node. The design wants ONE raw fidelity-preserving capture: value (raw text between the fences, no delimiters), a format marker, and a complete Position spanning the whole block including delimiters. Reconcile these: either mdast-named per-format nodes (`Yaml`/`Toml`/`Json` classes sharing shape) or one `Frontmatter` node with a `format` field that the P5 `Mdast` projection maps to mdast names — read the mdast readme and the design doc, decide, and record the ruling with rationale for the phase-end sync. Fidelity extras (fence style) only if a real variant exists.

**Capture grammar:** offset 0 only, opening fence on the very first line: `---` → yaml, `+++` → toml, and the JSON convention — verify against remark-frontmatter/micromark-extension-frontmatter and gray-matter conventions (gray-matter's language-hint form and its JSON handling) before deciding; record the chosen grammar and its authority in the module header. Closing fence required; an unclosed fence is NOT frontmatter (the document parses normally — no diagnostic; verify remark-frontmatter agrees). The captured block never enters the inline pass; nothing after the closing fence changes behavior.

- [ ] TDD: capture on/off, three formats, unclosed fence, `---` document under capture-off parses exactly as today (pin a spec example), position/offset correctness, empty frontmatter, CRLF fences. Whole-package green (1881 baseline grows); matrix + corpora untouched.
- [ ] Commit (`feat(markdown): frontmatter capture node and parse toggle`).

### Task 2: The three codec modules over optional kit peers

**Files:** `src/YamlFrontmatter.ts`, `src/TomlFrontmatter.ts`, `src/JsonFrontmatter.ts`, `packages/markdown/package.json` (optional peers, mirroring config-file), `src/index.ts` (named re-exports), unit tests per codec.

Each codec is one module exporting one named codec value: given the captured node's raw value, decode to `unknown` data through the kit package's parse schema (`@effected/yaml`'s document→data path, toml's, jsonc's — read each package's CLAUDE.md and public surface first; use their public schemas, not internals), failing typed on unparseable content in the strict path and carrying a diagnostic in the lenient path — match the error posture the design assigns (present-but-unparseable frontmatter is a diagnostic at parse level, a typed error at schema-decode level). The codec's format marker must match the capture node's format — a yaml codec applied to a toml capture fails typed with a distinct error. Keep the surface parallel across the three modules (field-identical contract shape).

- [ ] TDD per codec (valid, invalid, format mismatch, empty); `pnpm install` after the peer edit and check the lockfile diff (only the markdown importer may change). Whole-package green.
- [ ] Commit (`feat(markdown): frontmatter codecs over optional kit peers`).

### Task 3: The Frontmatter composition seam

**Files:** `src/Frontmatter.ts`, `src/MarkdownDocument.ts` (frontmatter accessor), `src/index.ts`, unit + property tests.

`Frontmatter.schema(MySchema, YamlFrontmatter)` — the typed gray-matter parity seam: compose a consumer schema with a codec into a decoder from a parsed `MarkdownDocument` (or raw source) to typed frontmatter data. `MarkdownDocument` gains its frontmatter accessor (the captured node or absent — genuinely absent, house invariant). Decide and record whether the seam takes the document, the node, or both (overload vs two functions — house Effect-wrapping policy: pure where total, Effect/Result where the error channel is real).

- [ ] TDD: end-to-end parse→capture→codec→schema for all three formats; frontmatter round-trip property (generate data, stringify via the format package, parse the document, decode — recover equal data); absent frontmatter posture (typed error vs Option — follow the design's strictness language, record the ruling). Whole-package green.
- [ ] Commit (`feat(markdown): frontmatter schema composition seam`).

### Task 4: The $schema declaration contract and registry resolver

**Files:** `src/FrontmatterResolver.ts` (one module, dependency-free), `src/index.ts`, unit + property tests.

Implement the design's §"$schema declarations" contract exactly — the section is prescriptive, follow it clause by clause: the four-variant classification union (`ByUrl` contains `://`; `ByPath` starts `./`, `../` or `/`; `Inline` is a mapping; `ByName` any other string), the `name[@version]` split at the LAST `@` (scoped `@savvy/skill@2.1.0` → name `@savvy/skill`), the version grammar `X[.Y[.Z]]` (one to three dot-separated non-negative integers, NO prerelease/build/range operators — junk is a typed error), the `FrontmatterSchemaResolver` contract (declaration + whole decoded frontmatter data → Schema or typed failure — the whole-data access is the OKF dispatch seam, test it with a resolver that ignores `$schema` entirely), `SchemaResolver.fromRegistry` with day-one EXACT version-segment equality (`skill@2` resolves only an identically-written registration; prefix resolution is a documented future minor, do NOT implement it), the `requireDeclaration` knob, and the three error distinctions (`SchemaDeclarationMissing` / `SchemaNameUnknown` / `SchemaVersionUnresolvable` — indicative names, finalize at implementation and record).

- [ ] TDD per the design's Testing section: four-variant classification, version grammar validation incl. junk, last-@ split incl. scoped names, exact-match resolution, the unresolvable-vs-unknown distinction, requireDeclaration strict/lenient, the OKF-style whole-data dispatch. Property tests: classification totality (any string classifies to exactly one variant), grammar round-trip. Whole-package green.
- [ ] Commit (`feat(markdown): frontmatter schema declarations and registry resolver`).

### Task 5: Gates and phase close

- [ ] `pnpm build --filter @effected/markdown` → `issues.json` zero errors/warnings outside the suppressed `_base` bucket; biome + `pnpm lint:md` clean; whole-package run green from clean.
- [ ] Design-doc sync (P3 completion state + the rulings recorded above) via the design-doc agent; commit (`ai(markdown)` type).
- [ ] Push `feat/markdown` to origin.

## Self-review notes

- Scope check against the design doc's P3 row: capture node ✓ (Task 1), `Frontmatter.schema` ✓ (Task 3), three codecs as optional kit peers ✓ (Task 2), `$schema` contract with exact-match registry resolution ✓ (Task 4) — nothing else belongs in P3 (edit/format is P4; Mdast projection is P5; prefix resolution is future).
- Task order puts the engine work first and the dependency-free resolver last so the riskiest integration (peers + lockfile) sits mid-phase with the regression net already proven on Task 1.
- Every task re-runs the whole package; the frontmatter-off default means the P2 matrix is untouched all phase — any corpus movement is a bug, full stop.
- Model economics: Task 1 is parser work (Opus-shaped); Tasks 2-3 are composition over existing kit surfaces (Sonnet-shaped, but peer wiring needs care); Task 4 is contract implementation from a prescriptive spec (either; the grammar edge cases reward Opus). Pane backend is down — run tasks as forks of the orchestrator.
