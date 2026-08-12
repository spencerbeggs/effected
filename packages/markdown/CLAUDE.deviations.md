# Deliberate deviations — @effected/markdown

Child context file for the places this package deliberately differs from
commonmark.js, mdast or its sibling format packages. **Know this before "fixing"
any of them.** The one-line rules are in the parent; here is why each holds.

**Parent:** [CLAUDE.md](./CLAUDE.md)

---

## Dialect and node shape

- **The default dialect is `gfm` at the facade, while the engine's `parseBlocks`
  substrate defaults `commonmark`.** Not an inconsistency: the substrate default
  is the registry-composition base. The **differential oracle stays pinned to
  dialect `commonmark`** — the `commonmark` npm package knows no GFM.
- **`definition` nodes are KEPT in the tree and linkReference/imageReference are
  emitted unresolved**, per mdast semantics; commonmark.js deletes definitions and
  resolves eagerly, which is wrong for an editing library.
  `MarkdownDocument.definitions` is the index. Reference *formation* still follows
  the spec exactly — a label with no matching definition stays literal text. The
  delta is node *shape* only.
- **`List.ordered`, `List.spread` and `ListItem.spread` are `optionalKey`** per
  mdast's `boolean?`: absence means **unknown**, not `false`. Consumers treat
  absent `spread` as tight.
- **Node discriminators are `Schema.Class` with an explicit field named `type`,
  never `Schema.TaggedClass`** — `TaggedClass` hardwires `_tag` and mdast's
  foreign contract requires exactly `type`. This rule is scoped to the mdast
  contract: the package's **own** `SchemaDeclaration` union in
  `FrontmatterResolver.ts` does use `TaggedClass`, correctly.

## Positions and construction

- **`position` is required on every decoded node, but constructor-defaulted in
  `make`.** The offset-based edit layer depends on real spans, so decode — the
  mdast admission boundary — still demands a full position; `make` alone softens
  it, filling in `Position.synthetic` when omitted so a replacement fragment builds
  in one line (`Text.make({ value: "shipped" })`). This is a carve-out, not a
  repeal: parsed trees always carry real spans, and trees on the synthetic
  sentinel serve tree-level workflows (stringify, visitor, `modify` fragments),
  never offset splicing.
- **`make` re-constructs a nested class value; never assert `position` by
  reference.** The beta.99 limitation here (a plain-object `position` literal
  threw, because `SchemaParser.recurDefaults` *replaced* the field's construction
  link) was fixed upstream in `effect@4.0.0-beta.101` —
  [Effect-TS/effect#6491](https://github.com/Effect-TS/effect/issues/6491), which
  this package filed and tripwired; the tripwire fired on the advance and is
  retired. The flip side of the fix: the field's construction link now always
  runs, so `Text.make({ position: p }).position !== p` — structurally equal,
  distinct instance — for an explicit value and for the `Position.synthetic`
  default alike. `Position` is an immutable value class with structural equality,
  so assert positions with `deepStrictEqual`, never `strictEqual`.

## Frontmatter capture

**Frontmatter capture defaults OFF** — an enabled capture changes how `---` at
offset 0 parses and the spec corpora contain such documents, so it is the
consumer's opt-in via `MarkdownParseOptions.frontmatter` and the conformance
harnesses run untouched. The fence grammar is a closed set (`---` yaml, `+++`
toml, `---json` json); an unclosed fence is not frontmatter and emits no
diagnostic. **`MarkdownDocument.hasFrontmatterBlock` disambiguates the resulting
`undefined`**: it re-runs the parser's own pre-scan over the source, so
`frontmatter === undefined` with `hasFrontmatterBlock === true` means exactly
"parsed with capture off" — and the two can never drift, because it is the same
scan. It recomputes per access like the other navigation getters; bind it when
checking repeatedly.

## Sibling-package divergences

- **Three engine-lineage divergences** (the commonmark.js port vs micromark's
  fixtures) are **masked symmetrically** in the interop harness and pinned by
  tripwire tests that fail if either side changes; likewise a narrow oracle-side
  correction for a genuine commonmark.js defect (a phantom empty paragraph).
  **Known-limitation tripwires** — gfm email re-linking of email-shaped plain
  text, and the other documented unrepresentable cases — **fail if a limitation is
  ever fixed silently.** A red tripwire may mean you fixed something; update the
  test with the fix.
- **`MarkdownEdit.applyAll` rejects overlapping edits as a thrown defect** and
  `format`'s range filter uses owning-node intersection: markdown standardizes on
  **toml's** posture on both counts. The overlap half is no longer a divergence —
  jsonc and yaml adopted the same guard, so all four format packages agree. The
  range half still diverges: yaml filters to edits falling **fully within** the
  range. The overlap guard only fires on hand-constructed arrays — it is a
  programmer-error guard, not input hardening.
- **`MarkdownVisitor` walks the parsed tree, not the text** — a `Data.TaggedEnum`
  event union (`Enter`/`Exit` with node, child-index path and depth, plus a
  terminal `Error`). This is the one deliberate divergence from the yaml/toml
  text-visitor convention, possible because parse and walk are separable here.

## Section finders

- **`sectionByHeading`'s string match is EXACT against trimmed text — never relax
  it to a substring.** `"1.2.3"` must not match a `## 1.2.30` heading, and the
  direction of the bug is what makes it nasty: in a changelog `1.2.30` is newer,
  so it sits *earlier*, and a substring implementation returns it first —
  publishing the wrong release notes silently. Callers wanting looser matching
  pass a `RegExp` or a predicate, visibly. `depth` is likewise **equality, not a
  maximum**: `{ depth: 2 }` means "the H2 sections", and a maximum returns the H1
  title instead. Both are pinned by named tests in
  `__test__/document-sections.test.ts`.
- **`DocumentSection.body` is untrimmed on purpose.** It is exactly the bytes
  `bodyRange` describes, so the string and the offsets can never disagree —
  publishing a span's offsets and handing back a different span is a lie the edit
  layer would eventually trip over. Consumers write `.trim()`.

---

**Related context:** [CLAUDE.api.md](./CLAUDE.api.md) for the surface these shape;
[CLAUDE.engine.md](./CLAUDE.engine.md) for the parser that produces them.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the package overview.*
