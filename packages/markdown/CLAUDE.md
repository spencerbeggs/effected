# CLAUDE.md — @effected/markdown

CommonMark 0.31.2 + GFM as pure Effect schemas: parse into mdast-shaped nodes
with byte offsets, compute offset-splice edits, format, modify by node, project
to and from plain mdast, walk as a `Stream`, and read and write frontmatter
through free-standing codecs. Plus the MDX node vocabulary (construct +
serialize only — the parser reads no MDX syntax), a phrasing-level parse entry
point, and string-level frontmatter split/join.

**Tier: pure.** Peer-depends on `effect` plus **optional** kit peers
`@effected/yaml`, `@effected/toml` and `@effected/jsonc`
(`peerDependenciesMeta`), consumed only by the three frontmatter codec modules.
Zero runtime deps, no IO. ~13k src LOC across 15 public modules plus the
`src/internal/` engine — second in size only to `yaml`. Not a migration: designed
here. Nothing here knows about any consumer; markdown's dependency arrow never
points outward.

**Design doc:** `@../../.claude/design/effected/packages/markdown.md` — load when
changing the public API, the dialect registries, the node shape, the hardening
story, or the `$schema` resolver grammar. It is the contract this package
implements and the entry point to two children:

- `@../../.claude/design/effected/packages/markdown-frontmatter.md` — Load when:
  working on a frontmatter codec, the split/join primitives, or the optional
  `yaml`/`toml`/`jsonc` peers they consume.
- `@../../.claude/design/effected/packages/markdown-mdx.md` — Load when: touching
  an MDX node class, the unions it widens, or how the stringifier serializes it.

**Child context files** carry the reasoning; the rules below stand alone. Load
what matches what you touch: `@./CLAUDE.engine.md` (the vendored parser, the cycle
firewall, hardening and node-construction cost), `@./CLAUDE.deviations.md` (every
deliberate difference from commonmark.js, mdast and the sibling format packages),
`@./CLAUDE.api.md` (the exported surface, module by module),
`@./CLAUDE.testing.md` (the five corpora and the differential oracle).

## Scope

**Markdown→HTML and HTML→markdown are permanently out of scope as product
features.** HTML is test-harness machinery only
(`__test__/e2e/support/htmlWriter.ts`). Do not promote it to `src/`.

**Never add a public extension API.** The dialect set is closed: a dialect is a
registry composition, nothing more, and a future one lands as new construct
modules with no public API change.

## The canonical form is a published commitment

`Markdown.stringify` takes no options, and its output is **documented as stable** on the TSDoc and in the README — a consumer is told they may assert on these bytes. `__test__/stringify.test.ts`'s "the documented canonical form" suite asserts every row of that published table.

Two escapes the table states, both found by a consumer rather than by us. **Representability outranks a row** — a lang-less `Code` node fences directly after a list, because indenting there is absorbed as list content — so a byte assertion over synthesized code blocks depends on the preceding sibling. And **`Mdast.fromMdast` strips fidelity fields**, being a spec-mdast boundary, so they are settable only on the decoded tree; the drop is correct and silent, which is why both the boundary and the emitter document it.

**Changing a canonical choice is a breaking change.** Update the table on `Markdown.stringifyResult`, the README table and that suite together, and bump accordingly. A row that moves silently breaks a promise consumers were invited to depend on.

The configurable surface is `MarkdownFormat` + `MarkdownFormattingOptions`; this one is deliberately not.

**MDX serialization is part of the same commitment, and its escaping is presence-keyed, never an option**: a tree carrying any MDX node escapes `{` in text; a tree with none serializes byte-identically to the table. That keying is what keeps stringify option-free while the corpora stay byte-stable — do not replace it with a stringify option.

## Non-negotiables

Each line is the rule; its reasoning is in the child beside it.

**Engine** → `@./CLAUDE.engine.md`

- `src/internal/` throws **raw carriers** and **never imports a public module** —
  that house rule is what holds error-level `noImportCycles`. Only the facade
  materializes `MarkdownDiagnostic` and the tagged errors, and non-carrier errors
  rethrow so a defect is never laundered into a typed channel.
- **The inline pass builds a mutable linked list**, materializing immutable Schema
  nodes only once it is final. Do not "clean this up" into an array — that
  reintroduces the quadratic behavior the delimiter stack exists to prevent.
- `internal/entityMap.ts` is **generated** from the `entities` devDependency:
  never edit it by hand, and never move `entities` into `dependencies`. The
  packed trie is an upstream internal that re-encodes across majors, so a bump
  re-derives the walker — accept a regeneration on **entry-for-entry data
  equality** with the old map, never on a clean run.
- `MAX_NESTING_DEPTH = 256` guards every **recursive** surface, and iterative
  surfaces are deliberately unguarded. Know what NOT to guard.
- **Parse is near-total**: every string is a valid CommonMark document, so the `E`
  channel carries **only hardening-guard failures**. Never add parse errors for
  content.
- The reference map is keyed through a real `Map` (labels are attacker-controlled)
  and the bare link-destination scan is capped at 32 open parens — the engine's one
  quadratic.
- Node construction costs ~15.8µs: `Table`, `TableRow` and `List` children point
  at the one-member category unions (`TableContent`/`RowContent`/`ListContent`) so
  already-constructed instances pass through by identity. Do not "simplify" them
  back to the member class.

**Node shape and deviations** → `@./CLAUDE.deviations.md`

- **`definition` nodes stay in the tree** and references are emitted unresolved,
  per mdast; commonmark.js resolves eagerly, which is wrong for an editing library.
- **`position` is required on decode, constructor-defaulted in `make`** — parsed
  trees always carry real spans; synthetic-position trees never feed offset
  splicing. `make` re-constructs nested values, so assert `position` with
  `deepStrictEqual`, **never** `strictEqual`.
- Node discriminators are `Schema.Class` with an explicit `type` field, **never
  `Schema.TaggedClass`** — mdast's foreign contract requires exactly `type`.
- `List.ordered` and the `spread` fields are `optionalKey`: absence means
  **unknown**, not `false`.
- **Frontmatter capture defaults OFF**; `MarkdownDocument.hasFrontmatterBlock` is
  what disambiguates the resulting `undefined`.
- **`sectionByHeading` matches EXACT trimmed text — never relax it to a
  substring** (`"1.2.3"` must not match `## 1.2.30`, which in a changelog sits
  earlier and would publish the wrong release notes). `depth` is likewise
  equality, not a maximum. `DocumentSection.body` is untrimmed on purpose, so the
  string and its offsets can never disagree.
- `MarkdownEdit.applyAll` rejects overlapping edits as a **thrown defect** — a
  programmer-error guard, not input hardening. Known-limitation and
  engine-lineage tripwires **fail when a limitation is silently fixed**: a red one
  may mean you fixed something.

**Surface** → `@./CLAUDE.api.md`

- **`YamlFrontmatter`, `TomlFrontmatter` and `JsonFrontmatter` are free-standing
  named codecs, one module each. Never collect them into a namespace object** —
  the config-file tree-shaking rule applies verbatim: a JSON-frontmatter consumer
  must not pay for the yaml engine. A namespace object is a barrel with different
  syntax.
- `encode` is a **required** `FrontmatterCodec` member; a decode-only codec does
  not satisfy the interface. `set` never switches fences and re-serializes the
  block whole, so yaml comments do not survive.
- `MarkdownFormat` normalizes markers only, and skips hazardous conversions rather
  than attempting them cleverly.
- Navigation getters (`headings`/`sections`/`links`/`find`) are synchronous with
  no error channel and recompute per access; bind them when checking repeatedly.

## Working here

```bash
pnpm vitest run packages/markdown/__test__   # this package's tests
pnpm build --filter @effected/markdown       # dev + prod, in order
```

Tests use `@effect/vitest` and `assert.*` — **never `expect`** — and live in
`__test__/`, never in `src/`. Never run `node savvy.build.ts --target prod`: it
skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped
like a clean gate.

`savvy.build.ts` carries one narrow API Extractor suppression:
`{ messageId: "ae-forgotten-export", pattern: "_base" }`, covering the heritage
symbols synthesized by inline class factories. **Never widen it.**
`package.json` stays `"private": true` — the bundler emits the publishable
manifest.
