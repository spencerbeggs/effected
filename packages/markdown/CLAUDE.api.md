# Public surface — @effected/markdown

Child context file for what `src/index.ts` exports and the shape rules inside
each module. `src/index.ts` is the authority; this is orientation, not a listing
to keep in sync line by line.

**Parent:** [CLAUDE.md](./CLAUDE.md)

---

- **`Markdown`** — `parseResult`/`stringifyResult` (pure `Result` primitives),
  `parse`/`stringify` (`Effect`), the `MarkdownFromString` two-way codec;
  `MarkdownDialect`, `MarkdownParseOptions`, `MarkdownParseError`,
  `MarkdownStringifyError`. Plus `parsePhrasingResult`/`parsePhrasing`: a text
  fragment parsed as ONE paragraph's inline content — blank lines stay inline,
  no reference context (dangling `[x]`/`[^x]` stay literal), positions correct
  relative to the input, `frontmatter` option a documented no-op. Same error
  posture (hardening trips only).
- **`MarkdownDocument`** — source + tree + frontmatter (+ `hasFrontmatterBlock`,
  the capture-off discriminant) + `diagnostics` + the `definitions` index, plus
  derived navigation getters `headings`/`sections`/`links` and the
  `firstSection`/`sectionByHeading` finders. **`DocumentSection` is a value CLASS,
  not an interface and not a `Schema.Class`** — it carries `text`, `bodyRange`
  (heading end → section end) and lazy `source`/`body` slices, which need a
  reference to the document source. It is a navigation projection, not a
  serializable model, so it adds no `_base` symbol. `sections` are delimited by
  **root-level** headings only, with ranges spanning subsections so the edit layer
  can splice whole sections; `links` pass `url` through unmodified (the OKF
  bundle-relative requirement). Plus `find`/`findAll`: a `MarkdownNodeType` tag
  narrows the result through `MarkdownNodeOfType` (`find("heading")` is
  `Heading | undefined`), and type-guard or plain predicates are accepted too.
  Pre-order, the same order `MarkdownVisitor` enters nodes, starting at the root;
  matches are returned **by identity**, so they feed `MarkdownFormat.modify`
  directly. Per the navigation-getter posture these are synchronous with no error
  channel: a tree past the depth cap is a thrown defect.
- **`MarkdownNode.ts` classes** — the mdast types (`Root`, `Paragraph`, `Heading`,
  `List`, `Code`, `Definition`, `Link`, `LinkReference`,
  `Table`/`TableRow`/`TableCell`, `Delete`, `FootnoteDefinition`/`FootnoteReference`,
  `Frontmatter`, …), the content unions, `Position` (including the public
  zero-width `Position.synthetic`) / `Point`, and the fidelity literals
  (`BulletChar`, `FenceChar`, `HeadingStyle`, `EmphasisChar`, …). Co-located in one
  file to break the recursive-AST cycle. The MDX vocabulary lives here too,
  shaped verbatim to the mdast-util-mdx oracle contracts (construct + serialize
  only; the parser reads no MDX syntax): `MdxJsxFlowElement`/`MdxJsxTextElement`
  (fragment = `name: null`, and a fragment with attributes is **unconstructible**
  — a schema check, not a serializer error), the attribute carriers
  (`MdxJsxAttribute` with `value?: string | expr | null` — both `null` and
  absence admitted per the oracle — `MdxJsxExpressionAttribute`,
  `MdxJsxAttributeValueExpression`, unioned as `MdxJsxAttributeContent` and
  deliberately **outside** `MarkdownNode`/visitor/find), plus
  `MdxFlowExpression`/`MdxTextExpression` and root-only `MdxjsEsm`. No
  `data.estree` field anywhere — the kit has no estree model; the `Mdast`
  boundary drops it silently like every foreign `data`.
- **`Mdast`** — `toMdast` / `fromMdastResult`: projection to plain spec-valid
  mdast JSON (fidelity fields stripped) and checked decoding back; `MdastNode`,
  `MdastDecodeError`.
- **`MarkdownEdit`** (+ `applyAll`), `MarkdownRange`, `MarkdownPath`,
  `MarkdownSegment` — field-identical to `JsoncEdit`/`YamlEdit`/`TomlEdit`: the
  binding cross-package parity contract and pre-work for the deferred
  `@effected/text-edit` kernel.
- **`MarkdownFormat`** — `format`/`formatToString` (pure, marker-normalization
  only: `headingStyle`, `bulletChar`, `emphasisChar`, `fenceChar`,
  `thematicBreakChar`, `codeBlockStyle`, hazardous conversions **skipped** rather
  than attempted cleverly). `CodeBlockStyle` (`fenced` | `indented`) is a
  formatting target, **not** a node fidelity field — the two spellings are told
  apart by the presence of `fenceChar`, and a language-less `Code` node with none
  serializes **indented** by default, which is the one canonical default that
  surprises people. Both conversion directions are whole-block rewrites, so both
  are restricted to root-level flush-left blocks (a container's continuation
  prefix is not reproducible by one splice), and the indented direction skips
  every re-parse hazard: a non-blank preceding line, a preceding list or footnote
  definition, an adjacent language-less block that would merge, and values with
  blank first/last or interior whitespace-only lines. Absent the option, a code
  block keeps whichever spelling it has. Also `modify`/`modifyToString` (`Effect`,
  by node identity, replacements rendered through the canonical stringifier so
  results re-parse by construction).
- **`MarkdownVisitor`**, `MarkdownVisitorEvent` — lazy-per-subscription `Stream`
  tree walk. `MarkdownDiagnostic`, `MarkdownParseErrorCode`.
- **`MarkdownFrontmatter`** (the `.schema` read seam plus the `.set`/`.setToString`
  write mirror — prefixed because bare `Frontmatter` is the node class),
  `FrontmatterCodec`, and the five frontmatter errors, unioned two ways:
  `FrontmatterSchemaError` for reads, `FrontmatterWriteError`
  (FormatMismatch | Encode | Validation) for writes. **`FrontmatterMissingError`
  carries a `reason`** (`FrontmatterMissingReason`: `"absent"` |
  `"captureDisabled"`) computed from `hasFrontmatterBlock`, so "there is no block"
  and "you parsed with the toggle off" — whose fix is a parse option, not a
  document edit — stop looking identical, and the error can never contradict the
  accessor. **`encode` is a required `FrontmatterCodec` member, not decode-only**.
  `set` emits **one** edit: a replacement spanning the whole capture node, or an
  insert at offset 0 when there is no frontmatter — which is why
  `FrontmatterWriteError` deliberately omits `FrontmatterMissingError`, absence
  being the insert path rather than a failure. Same `frontmatter: true` parse
  precondition as decode. It **never switches fences**: a codec whose format
  differs from the captured one fails typed. The block is re-serialized **whole**
  from the encoded data, so comments inside a yaml block do not survive —
  gray-matter parity, with per-key surgical editing a recorded future refinement.
- **`FrontmatterSource`** — string-level `split`/`join` over the SAME closed
  fence grammar as the parser's pre-scan (shared `FENCES` table in
  `internal/blocks/frontmatter.ts`), usable without parsing the body (MDX
  pages, snapshot-hash contracts). Both total, pure sync — no Result/Effect
  twins because nothing can fail; absence is representable (one fact here: no
  capture toggle exists at string level). `FrontmatterSourceBlock.value` is the
  exact bytes between the fence LINES — each value line WITH its terminator,
  deliberately unlike the `Frontmatter` node's value — which keeps `""` vs
  `"\n"` distinct and makes `join` byte-exact for unmodified round-trips
  (two documented normalizations: close-fence-at-EOF gains a final newline,
  mismatched fence terminators re-emit as the opening one).
  `body === source.slice(bodyOffset)` always; no U+0000 substitution and no
  BOM handling at this level.
- **`SchemaResolver`** (`classify`, `declarationOf`, `fromRegistry`) plus the
  `SchemaDeclaration` union (`ByUrl`/`ByPath`/`Inline`/`ByName`) and its four
  errors. Dependency-free by design — the `name[@version]` grammar (split at the
  **last** `@` so npm scopes survive; `X[.Y[.Z]]`, no prerelease, no ranges) is
  validated in ~30 lines rather than peering on `@effected/semver`. Resolution is
  **exact numeric version-segment equality** day one; prefix resolution is the
  committed semver-minor future.
- **`YamlFrontmatter`, `TomlFrontmatter`, `JsonFrontmatter`** — three free-standing
  named codecs, one module each. **Never collect them into a namespace object**:
  the config-file tree-shaking rule applies verbatim — a JSON-frontmatter consumer
  must not pay for the yaml engine. A namespace object is a barrel with different
  syntax.

---

**Related context:** [CLAUDE.deviations.md](./CLAUDE.deviations.md) for why these
shapes differ from mdast and the sibling format packages.

*Child context file. See [CLAUDE.md](./CLAUDE.md) for the package overview.*
