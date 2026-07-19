# @effected/markdown

CommonMark 0.31.2 + GFM as pure Effect schemas: parse into mdast-shaped nodes with byte offsets, compute offset-splice edits, format, modify by node, project to and from plain mdast, walk as a `Stream`, and read and write frontmatter through free-standing codecs.

**Tier: pure.** Peer-depends on `effect` plus **optional** kit peers `@effected/yaml`, `@effected/toml` and `@effected/jsonc` (`peerDependenciesMeta`), consumed only by the three frontmatter codec modules. Zero runtime deps, no IO. ~11.2k src LOC across 14 public modules plus the `src/internal/` engine — second only to yaml. Not a migration: designed here, built in five phases (P1–P5 complete).

**Markdown→HTML and HTML→markdown are permanently out of scope as product features.** HTML is test-harness machinery only (`__test__/e2e/support/htmlWriter.ts`). Do not promote it to `src/`.

**For the full design:** → `@../../.claude/design/effected/packages/markdown.md`

Load when changing the public API, the dialect registries, the node shape, the hardening story, or the `$schema` resolver grammar. It records every settled decision including the per-phase (P1–P5) rulings.

## Architecture: two-phase parse, dialect registries

The engine is a vendored, hardened port of **commonmark.js@0.31.2** (BSD-2-Clause, attribution headers in every ported module), restructured as **construct-per-module** under `src/internal/blocks/` (16 modules) and `src/internal/inlines/` (12 modules), wired through **dialect-keyed registries** (`blockRegistry.ts`, `inlineRegistry.ts`). This is micromark's decomposition without its CPS machinery. **A dialect is a registry composition, nothing more** — the acceptance test for the design is that a future `obsidian` dialect lands as new construct modules with no public API change. Never add a public extension API; the dialect set is closed.

It runs CommonMark's own two-phase strategy: a **block pass** (`blockParser.ts`) consuming lines with lazy continuation to build the container/leaf tree, then an **inline pass** (`inlineParser.ts`) running the delimiter-stack algorithm over each leaf. Two constructs are seams inside base constructs rather than registry entries — footnote handling lives inside close-bracket handling and the image opener (`makeLinkCloseConstruct`/`makeImageOpenConstruct`, swapped into the gfm table); the commonmark dialect takes the no-seam defaults and is byte-for-byte unchanged.

**The inline pass builds a mutable linked list** of tokens (`inlineNode.ts`) and materializes the immutable node Schema classes only once that list is final. The array form would reintroduce the quadratic behavior the delimiter stack exists to prevent. Do not "clean this up" into an array.

`internal/entityMap.ts` is **generated** by `__test__/tools/generate-entities.ts` from `entities@6.0.1` (a devDependency, MIT, data attributed) — do not edit it by hand, and never move `entities` into `dependencies`.

## Cycle firewall

`noImportCycles` is error-level, held by the house rule: `src/internal/` throws **raw carriers** (`internal/carriers.ts`) and **never imports a public module**. The facade (`Markdown.ts`, `MarkdownDocument.ts`, `MarkdownFormat.ts`, `MarkdownVisitor.ts`) catches those throws and materializes `MarkdownDiagnostic` (deriving `line`/`character` from `offset`) plus the tagged `MarkdownParseError` / `MarkdownStringifyError` / `MarkdownModificationError`. `internal/limits.ts` is the zero-dependency leaf every guard imports.

Defect passthrough is proven, not assumed: non-carrier errors rethrow at every facade `catch`, so a genuine programmer-error defect never gets laundered into a typed error channel.

## Hardening inventory

`MAX_NESTING_DEPTH = 256` (`internal/limits.ts`, the cross-package parity constant) guards every **recursive** surface, enumerated: container nesting in the block pass, the delimiter/bracket stacks in the inline pass, stringify recursion, and the visitor walk. Footnote definitions are containers sharing the container counter, so definition-in-definition recursion is pinned.

**Iterative surfaces are deliberately unguarded** — the toml lesson: know what NOT to guard. A 5000-sibling document is fine; there is no stack to blow.

- **The calibrated pathological suite** (`__test__/e2e/support/pathological/`, 21 cases from cmark's `pathological_tests.py`) is the **linear-time guarantee**: markdown's DoS vector is quadratic emphasis/link blowup, defeated by the delimiter stack. Three of the 21 are deep-nesting cases the depth guard correctly refuses — a `GUARD_REFUSED` set pins that posture; they are not failures. Budgets are **calibrated against a same-code-path baseline**, not raw milliseconds, because v8 coverage instrumentation costs a measured ~18x; an algorithmic regression still fails, because quadratic outruns any constant factor.
- **The reference map is keyed through a real `Map`** — link labels are attacker-controlled, so this is the prototype-pollution guard.
- **Parse is near-total.** CommonMark has no syntax errors — every string is a valid document. The `E` channel carries **only hardening-guard failures**; there is no "malformed markdown", so do not add parse errors for content. `MarkdownDocument.diagnostics` is real plumbing for warnings with few producers yet — expected, not an omission.

## Deliberate deviations — know this before "fixing" them

- **The default dialect is `gfm` at the facade, while the engine's `parseBlocks` substrate defaults `commonmark`.** Not an inconsistency: the substrate default is the registry-composition base. The **differential oracle stays pinned to dialect `commonmark`** — the `commonmark` npm package knows no GFM.
- **`definition` nodes are KEPT in the tree and linkReference/imageReference are emitted unresolved**, per mdast semantics; commonmark.js deletes definitions and resolves eagerly, which is wrong for an editing library. `MarkdownDocument.definitions` is the index. Reference *formation* still follows the spec exactly — a label with no matching definition stays literal text. The delta is node *shape* only.
- **`position` is required on every decoded node, but constructor-defaulted in `make`.** The offset-based edit layer depends on real spans, so decode — the mdast admission boundary — still demands a full position; `make` alone softens it, filling in `Position.synthetic` when omitted so a replacement fragment builds in one line (`Text.make({ value: "shipped" })`). This is a carve-out to the required-position posture, not its repeal: parsed trees always carry real spans, and trees on the synthetic sentinel serve tree-level workflows (stringify, visitor, `modify` fragments), never offset splicing.
- **A plain-object `position` literal throws in `make`** (`effect@4.0.0-beta.99`): the constructor default makes upstream's `SchemaParser.recurDefaults` **replace** the field's construction link rather than append to it, so an explicit `position` must be a `Position` instance. The type level still admits the literal, and decode is untouched. Pinned by a tripwire in `__test__/frontmatter.test.ts` that goes **red when upstream fixes it** — a red there means delete the pin, not patch the source.
- **`List.ordered`, `List.spread` and `ListItem.spread` are `optionalKey`** per mdast's `boolean?`: absence means **unknown**, not `false`. Consumers treat absent `spread` as tight.
- **Node discriminators are `Schema.Class` with an explicit field named `type`, never `Schema.TaggedClass`** — `TaggedClass` hardwires `_tag` and mdast's foreign contract requires exactly `type`. This rule is scoped to the mdast contract: the package's **own** `SchemaDeclaration` union in `FrontmatterResolver.ts` does use `TaggedClass`, correctly.
- **Frontmatter capture defaults OFF** — an enabled capture changes how `---` at offset 0 parses and the spec corpora contain such documents, so it is the consumer's opt-in via `MarkdownParseOptions.frontmatter` and the conformance harnesses run untouched. The fence grammar is a closed set (`---` yaml, `+++` toml, `---json` json); an unclosed fence is not frontmatter and emits no diagnostic.
- **Three engine-lineage divergences** (the commonmark.js port vs micromark's fixtures) are **masked symmetrically** in the interop harness and pinned by tripwire tests that fail if either side changes; likewise a narrow oracle-side correction for a genuine commonmark.js defect (a phantom empty paragraph). **Known-limitation tripwires** — gfm email re-linking of email-shaped plain text, and the other documented unrepresentable cases — **fail if a limitation is ever fixed silently.** A red tripwire may mean you fixed something; update the test with the fix.
- **`MarkdownEdit.applyAll` rejects overlapping edits as a thrown defect** and `format`'s range filter uses owning-node intersection: markdown standardizes on **toml's** posture on both counts. The overlap half is no longer a divergence — jsonc and yaml adopted the same guard, so all four format packages agree. The range half still diverges: yaml filters to edits falling **fully within** the range. The overlap guard only fires on hand-constructed arrays — it is a programmer-error guard, not input hardening.
- **`MarkdownVisitor` walks the parsed tree, not the text** — a `Data.TaggedEnum` event union (`Enter`/`Exit` with node, child-index path and depth, plus a terminal `Error`). This is the one deliberate divergence from the yaml/toml text-visitor convention, possible because parse and walk are separable here.
- **Schema construction costs ~15.8µs per node** (measured, closed, accepted): a ~50k-node document pays roughly a second, and `MakeOptions.disableChecks` does not help — the cost is `struct.make` field processing. `stringify` is 0.16µs/node and `Mdast.toMdast` 0.06µs/node; `Mdast.fromMdastResult` pays ~12.6µs/node because it **is** the checked admission boundary. Hot-path consumers keep trees in package types or project out via `toMdast`.

## Public surface

Exported from `src/index.ts`:

- `Markdown` — `parseResult`/`stringifyResult` (pure `Result` primitives), `parse`/`stringify` (`Effect`), the `MarkdownFromString` two-way codec; `MarkdownDialect`, `MarkdownParseOptions`, `MarkdownParseError`, `MarkdownStringifyError`.
- `MarkdownDocument` — source + tree + frontmatter + `diagnostics` + the `definitions` index, plus derived navigation getters `headings`/`sections`/`links` (`DocumentHeading`, `DocumentSection`, `DocumentLink`, `LinkBearingNode`). `sections` are delimited by **root-level** headings only, with ranges spanning subsections so the edit layer can splice whole sections; `links` pass `url` through unmodified (the OKF bundle-relative requirement). Plus `find`/`findAll`: a `MarkdownNodeType` tag narrows the result through `MarkdownNodeOfType` (`find("heading")` is `Heading | undefined`), and type-guard or plain predicates are accepted too. Pre-order, the same order `MarkdownVisitor` enters nodes, starting at the root; matches are returned **by identity**, so they feed `MarkdownFormat.modify` directly. Per the navigation-getter posture these are synchronous with no error channel: a tree past the depth cap is a thrown defect.
- `MarkdownNode.ts` classes — the mdast types (`Root`, `Paragraph`, `Heading`, `List`, `Code`, `Definition`, `Link`, `LinkReference`, `Table`/`TableRow`/`TableCell`, `Delete`, `FootnoteDefinition`/`FootnoteReference`, `Frontmatter`, …), the content unions, `Position` (including the public zero-width `Position.synthetic`) / `Point`, and the fidelity literals (`BulletChar`, `FenceChar`, `HeadingStyle`, `EmphasisChar`, …). Co-located in one file to break the recursive-AST cycle.
- `Mdast` — `toMdast` / `fromMdastResult`: projection to plain spec-valid mdast JSON (fidelity fields stripped) and checked decoding back; `MdastNode`, `MdastDecodeError`.
- `MarkdownEdit` (+ `applyAll`), `MarkdownRange`, `MarkdownPath`, `MarkdownSegment` — field-identical to `JsoncEdit`/`YamlEdit`/`TomlEdit`: the binding cross-package parity contract and pre-work for the deferred `@effected/text-edit` kernel.
- `MarkdownFormat` — `format`/`formatToString` (pure, marker-normalization only: `headingStyle`, `bulletChar`, `emphasisChar`, `fenceChar`, `thematicBreakChar`, hazardous conversions **skipped** rather than attempted cleverly) and `modify`/`modifyToString` (`Effect`, by node identity, replacements rendered through the canonical stringifier so results re-parse by construction).
- `MarkdownVisitor`, `MarkdownVisitorEvent` — lazy-per-subscription `Stream` tree walk. `MarkdownDiagnostic`, `MarkdownParseErrorCode`.
- `MarkdownFrontmatter` (the `.schema` read seam plus the `.set`/`.setToString` write mirror — prefixed because bare `Frontmatter` is the node class), `FrontmatterCodec`, and the five frontmatter errors, unioned two ways: `FrontmatterSchemaError` for reads, `FrontmatterWriteError` (FormatMismatch | Encode | Validation) for writes. **`encode` is a required `FrontmatterCodec` member, not decode-only** — a codec without it does not satisfy the interface. `set` emits **one** edit: a replacement spanning the whole capture node, or an insert at offset 0 when there is no frontmatter — which is why `FrontmatterWriteError` deliberately omits `FrontmatterMissingError`, absence being the insert path rather than a failure. Same `frontmatter: true` parse precondition as decode. It **never switches fences**: a codec whose format differs from the captured one fails typed. The block is re-serialized **whole** from the encoded data, so comments inside a yaml block do not survive — gray-matter parity, with per-key surgical editing a recorded future refinement.
- `SchemaResolver` (`classify`, `declarationOf`, `fromRegistry`) plus the `SchemaDeclaration` union (`ByUrl`/`ByPath`/`Inline`/`ByName`) and its four errors. Dependency-free by design — the `name[@version]` grammar (split at the **last** `@` so npm scopes survive; `X[.Y[.Z]]`, no prerelease, no ranges) is validated in ~30 lines rather than peering on `@effected/semver`. Resolution is **exact numeric version-segment equality** day one; prefix resolution is the committed semver-minor future.
- `YamlFrontmatter`, `TomlFrontmatter`, `JsonFrontmatter` — **three free-standing named codecs, one module each. Never collect them into a namespace object**: the config-file tree-shaking rule applies verbatim — a JSON-frontmatter consumer must not pay for the yaml engine. A namespace object is a barrel with different syntax.

## Testing discipline

Five vendored corpora, each pinned by a `VENDORED.md` (upstream repo, ref, license), all with **empty skip maps**:

1. **CommonMark spec.json 0.31.2** — all 652 examples, zero skips, zero deferrals, via normalized-HTML equivalence against the test-only writer.
2. **GFM spec extension sections** (cmark-gfm 0.29.0.gfm.13) — 22/22. It is 22, not 24: the two task-list spec examples are disabled upstream.
3. **cmark-gfm `extensions.txt`** — 30/30, the only official footnote corpus.
4. **cmark pathological cases** — 21, with the calibrated budgets and `GUARD_REFUSED` set above.
5. **mdast-util-from-markdown@2.0.3 fixtures** — 27 `.md`/`.json` pairs asserting AST-**plus-position** equality through `Mdast`, proving interop rather than rendering.

Plus the **dialect matrix**, running all 652 CommonMark examples under both dialects with an explicitly asserted bidirectional divergence list of **exactly 11 examples** (6 tagfilter, 5 autolink-literal) — changing that count means changing an assertion, deliberately. The **differential oracle** is `commonmark@0.31.2`, an exact-pinned devDependency imported only by `__test__/oracle.property.test.ts` — never a runtime dep, never elsewhere, never drifting from the ported version. **Corpus-wide re-parse equivalence** (1361 round-trips over all three corpora) is the stringify authority.

Tests live in `__test__/` only, never in `src/`; conformance in `__test__/e2e/`. Use `@effect/vitest` and assert with `assert.*` — **never `expect`**.

## Working here

```bash
pnpm vitest run packages/markdown/__test__   # this package's tests
pnpm build --filter @effected/markdown       # dev + prod, in order
```

Never run `node savvy.build.ts --target prod` directly. It skips `build:dev`, emits no `.d.ts`, and leaves a truncated `issues.json` shaped exactly like a clean gate.

`savvy.build.ts` carries one narrow API Extractor suppression: `{ messageId: "ae-forgotten-export", pattern: "_base" }`, covering the heritage symbols synthesized by inline class factories. Never widen it. `package.json` stays `"private": true` — the bundler emits the publishable manifest.

P1–P5 are complete; **P6 (docs and adoption) remains** — the api-extractor model plus website docs, dogfooded via the rspress-plugin-api-extractor swap (that repo's `mdast-util-from-markdown` + `gray-matter` stack is the identified consumer). Nothing here knows about any consumer; markdown's dependency arrow never points outward.
