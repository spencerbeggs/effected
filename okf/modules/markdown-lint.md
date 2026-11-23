---
type: Module
title: "@effected/markdown-lint"
description: "A markdownlint-compatible lint rule shape over @effected/markdown trees: one LintRule definition with markdownlint metadata, a pure programmatic host (MarkdownLint) and a markdownlint custom-rule adapter (MarkdownlintAdapter), with every line, range and fix derived from kit offsets by PositionMapping."
status: draft
kind: package
resource: ../../packages/markdown-lint
layer: L2
tags:
  - architecture
sources:
  - id: issue-1030
    resource: https://github.com/spencerbeggs/effected/issues/1030
    title: "markdown: a markdownlint-compatible lint shape so a rule is defined once over kit trees"
  - id: markdownlint-types
    resource: https://github.com/DavidAnson/markdownlint/blob/v0.42.0/lib/markdownlint.d.mts
    title: "markdownlint 0.42 Rule, RuleParams, RuleOnError, RuleOnErrorInfo, RuleOnErrorFixInfo"
  - id: golden-readme
    resource: ../../packages/markdown-lint/__test__/fixtures/changesets/README.md
  - id: host-tests
    resource: ../../packages/markdown-lint/__test__/markdownlint-host.test.ts
  - id: host-config-tests
    resource: ../../packages/markdown-lint/__test__/host-config.test.ts
  - id: systems-804
    resource: https://github.com/savvy-web/systems/issues/804
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-23T22:50:33Z
integrity:
  generated:
    body: 9ce56889b5a70d7d
---

# `@effected/markdown-lint`

`@effected/markdown-lint` lets a markdown lint rule be written once, against
`@effected/markdown` nodes, and run in two hosts: a pure programmatic linter
and markdownlint (so markdownlint-cli2 and the VS Code extension) through an
adapter. It exists because savvy-web/systems implemented each of its five
changeset rules twice — once over kit nodes for its own linter, once over
markdownlint's micromark tokens — and that duplication was what kept
systems#804 on two stacks[^issue-1030]. Placement and its rejected
alternatives are in [the placement decision](../decisions/markdown-lint-package.md).

## Tier and dependency posture

**Pure tier.** No IO and no runtime dependency beyond `@effected/markdown`
(`workspace:^`, a regular dependency: pure, and no shared-instance contract
the [peer discipline](../conventions/peer-dependency-discipline.md) would
ask a peer for) and the `effect` peer. `@effected/source`'s `LineIndex`
comes through `@effected/markdown`'s re-export, so there is no second edge.
**No markdownlint import, at any tier**: the adapter matches markdownlint's
custom-rule contract structurally with local types, so a consumer brings
their own markdownlint and the package cannot pin it.

## Surface

One file per concept under `src/`, plus `src/internal/host.ts` — the parse,
context construction and rule run both hosts share, which is what makes
"the hosts agree" a property of one module rather than of two copies.

- `LintRule` — a `Schema.Class` of `names`, `description`, `tags`, optional
  `information` (a URL string) and `check: (context, report) => void`.
  `make` validates the metadata to markdownlint's own custom-rule validation
  (non-empty names and tags, no name twice ignoring case, no tag equal to a
  name, an absolute URL), so an adapted rule is never refused by markdownlint
  at lint time. The first name is the rule's identity (`name` getter).
- `LintContext` — type-only: `name`, `document` (`MarkdownDocument`),
  `root`, `source` (the whole text, frontmatter included), `lines`,
  `frontmatter: Option<LintFrontmatter>` (the kit capture node, its line
  count and lines), `mapping`, and `diagnostic(report)`, the builder a rule
  reports through. A `LintReport` names its anchor as a node or an offset
  span, plus optional `detail`, `context`, `range` (`true` for the anchor's
  span, or another span) and `fix` (a kit offset edit).
- `LintDiagnostic` — `ruleNames`, `lineNumber`, `column`, and `Option`s of
  `detail`, `context`, `range` (`[column, length]`), `fixInfo`
  (`LintFixInfo`, markdownlint's one-line fix with its own optional field
  names) and `edit` (the kit `MarkdownEdit`). Absence is `Option.none()`
  everywhere; an empty `detail`/`context` reads as absent, as markdownlint
  reads it.
- `PositionMapping` — the one place a position is translated: offsets to
  1-based lines and UTF-16 columns over `LineIndex`'s "lsp" line breaks
  (markdownlint's own `\r\n?|\n` split), `range` cut to one line (the
  diagnostic's own line, which `LintContext.diagnostic` passes, else the
  span's first) and `Option.none()` when nothing of the span is on it —
  markdownlint rejects a range measured on another line and fails the whole
  file's lint — and `fixInfo` for an edit
  inside one line or a whole-line delete (`deleteCount: -1`). An edit that
  crosses a line break otherwise has no `fixInfo` and keeps the kit `edit`.
- `MarkdownLint` — `lint(source, rules, options)` (total and synchronous),
  `lintDocument(document, rules)` for an already-parsed document (the same
  reading and findings as `lint` over `document.source`: the parse is
  reused when it already is markdownlint's reading, otherwise the source is
  re-read with `options.dialect`), and
  `lintEffect`, the `Effect` under a `MarkdownLint.lint` span defined in
  terms of `lint`. Defaults: gfm, frontmatter capture on (markdownlint
  always strips front matter). Findings come in rule order, then report
  order. Two rules sharing a name throws, as a wiring error.
- `MarkdownlintAdapter` — `rule(lintRule, options)` and `rules(lintRules,
  options)` return objects satisfying markdownlint's `Rule` with
  `parser: "none"`; the local types (`MarkdownlintRule`,
  `MarkdownlintRuleParams`, `MarkdownlintOnError`, `MarkdownlintErrorInfo`,
  `MarkdownlintFixInfo`) are a subset of markdownlint's
  `lib/markdownlint.d.mts`, mutable where markdownlint's are so the object
  is assignable to its `Rule`[^markdownlint-types].

## The mapping

Line numbers on a `LintDiagnostic` count the whole source. A setext
heading reports on its text line (where markdownlint's `setextHeading`
token starts), a multi-line node on its first line, a node after a
frontmatter block on the line an editor shows. Nothing special-cases any of
these: a position is its start offset's line.

The adapter rebuilds the file as `frontMatterLines` then `lines`, parses it
with the kit — once per file, cached on the identity of markdownlint's
frozen `params.lines`, which every rule run over one file shares — runs the
rule exactly as `MarkdownLint.lint` does, and translates at the boundary: a
line after markdownlint's front matter counts from its first content line;
a line inside it keeps its number and sets `frontMatter: true`. markdownlint
adds the front matter back when it reports, so its `lineNumber`s equal the
programmatic host's. The rebuilt text carries markdownlint's
normalizations (`\n` endings, HTML comment bodies masked as `.` runs of the
same length); positions are unaffected. markdownlint also drops a leading
byte order mark before splitting lines, so `MarkdownLint.lint` drops one
too — otherwise a BOM-prefixed `# H` is a heading in one host and text in
the other. The mark is invisible to rules but not to the result:
`MarkdownLint.lint` shifts each finding's kit `edit` past it, so edit offsets
address the source as given and `MarkdownEdit.applyAll` needs no BOM
knowledge, while `lineNumber`, `column`, `range` and `fixInfo` stay in
markdownlint's own BOM-free coordinates (a differential test applies both to a
BOM fixture and compares).

`MarkdownLint.lint` and `lintDocument` read a file as markdownlint does, so a rule sees the
same text and tree in both hosts: HTML comment bodies after the front matter
are masked before the parse, and `LintFrontmatter.lineCount` and `lines` are
markdownlint's own front matter count (its closing `---` swallows trailing
blank lines). `LintFrontmatter.node` is `Option.some` only when the kit
captured that block too; a block the kit does not capture (`{…}`, a
`...`-closed one) is parsed as spaces of equal length, so no tree node lies
inside it and no offset moves, and a `---json` block markdownlint does not
read as front matter is not captured either.

## Configuration

Both host options take markdownlint's configuration object (`config`,
default `{ default: true }`) and `noInlineConfig`. `MarkdownLint` resolves
them with `LintConfig` and `InlineDirectives`, as markdownlint's
`lintContent` does: inline comments are read from the whole unmasked text,
front matter included — markdownlint's per-line state is indexed by
whole-file line, so a comment inside the front matter counts and no line
translation is needed. Only rules enabled on some line run; each sees its
settings (without `enabled` and `severity`) as `LintContext.config`; a
finding on a line where its rule is disabled is dropped; each carries the
rule's configured `severity` (a parse refusal is always `error`). Under the
adapter markdownlint does all of that itself: `context.config` is
`params.config` and the kit-side severity is `error`. A differential test
runs both hosts over the same inputs and configs and requires equal lines,
details and severities[^host-config-tests].

## Failure posture

A markdown document always parses except one nested past the kit's
hardening cap. Both hosts report that as one finding per rule at the
refusal, `detail` the parse error's message, because markdownlint gives a
rule no failure channel and the two hosts must agree. A rule's own `throw`
propagates (in `lintEffect`, a defect); markdownlint reports or rethrows it
per its `handleRuleFailures`. `LintRule.make` with bad metadata throws.

## Observability

One named span, `MarkdownLint.lint`, on `lintEffect`. Everything else is a
plain synchronous function; no logging, no metrics.

## Testing

- **The golden corpus.** savvy-web/systems' five changeset rules
  (CSH001–CSH005, savvy-web's house style, which no kit package provides)
  are kept as test-only copies under `__test__/rules/`, an engine-fidelity
  corpus rather than API, and
  `__test__/fixtures/changesets/golden.json` holds all 113 markdown inputs
  systems' own rule tests lint, with both systems engines' diagnostics,
  captured by a committed harness that regenerates the file byte for
  byte[^golden-readme]. The programmatic host equals systems' markdownlint
  output exactly on all 113, and systems' programmatic output exactly
  (order, line, column, message) on the 102 where systems' two engines agree.
  The eleven disagreements are all CSH005; the port follows systems'
  markdownlint engine, and the count is pinned.
- **A real markdownlint.** `markdownlint-host.test.ts` imports the
  markdownlint that this repository's own `markdownlint-cli2` installs at
  the workspace root (through a variable specifier: it ships no types, and
  the package takes no dependency on it), and runs the adapted rules in it:
  byte-identical to the golden, `applyFixes` over the mapped `fixInfo` equal
  to `MarkdownEdit.applyAll` over the kit edits (LF, CRLF, frontmatter,
  astral characters), `frontMatter` numbering, inline disable comments, one
  parse per file, and every adapted rule accepted by markdownlint's own
  custom-rule validation[^host-tests].
- `position-mapping.test.ts` pins setext, multi-line, frontmatter, CRLF,
  bare `\r`, UTF-16 and every `fixInfo` branch.

## Known divergences

- GFM pads a short table row to the header's width, and the kit tree
  carries the padding as zero-width cells, so a kit rule cannot count the
  cells an author wrote; the CSH005 port reports a short row's padded cells
  as empty values where systems' micromark rule reports "too few columns".
  Pinned by a test.
- A parse refusal (a document nested past the hardening cap) always
  reports severity `error` in the programmatic host, where markdownlint
  would apply the rule's configured severity to the adapter's refusal
  finding.
- MD012 under `maximum: 0`: markdownlint 0.42.1 throws on a file that is
  all front matter with no final line break (`front-matter-no-crlf.md`,
  LF and CRLF, 2 inputs). Its content is one empty line numbered one past
  its per-line enabled state. The kit reports nothing there. Pinned by a
  test as an upstream failure, not a port difference.

## Known limitations

- markdownlint's micromark runs the math extension; the kit tree carries no
  math. The rules read `$$` blocks from raw lines instead (an opening line
  of two or more `$` with no `$` in its meta, behind any blockquote markers
  and indentation, outside code and HTML blocks, to a closing line of at
  least as many `$`), and drop the headings the kit reads inside them. The
  reader does not track a list item's indentation, so a block inside a list
  is found by its own line alone.

- Two findings can carry inserts at one position (MD022, when two headings
  each ask for blank lines between them). `MarkdownEdit.applyAll` applies
  every edit; markdownlint's `applyFixes` applies one insert per line and
  column, the longest, and drops identical fixes. The differential harness
  applies kit edits under markdownlint's policy, so its applied-fix
  comparison holds; a caller applying the kit edits directly gets every
  insert.

- MD012 under `maximum: 0` on a document of several lines that are all
  blank: the last line's delete, after every earlier line is deleted
  forward, is an empty edit, which carries no `fixInfo`. The kit edits still
  apply to markdownlint's result. No corpus input reaches it; an empty
  document's one line does map, to `deleteCount: -1`.

- `lintDocument` cannot know the dialect a document was parsed with:
  `MarkdownDocument` does not record it. When the given parse is not
  already markdownlint's reading, the source is re-read with
  `options.dialect` (default gfm), so a caller who parsed as commonmark
  passes `dialect: "commonmark"`.

[^issue-1030]: <https://github.com/spencerbeggs/effected/issues/1030>
[^markdownlint-types]: markdownlint's `lib/markdownlint.d.mts`, checked against the markdownlint 0.42 that markdownlint-cli2 0.24 runs.
[^golden-readme]: `packages/markdown-lint/__test__/fixtures/changesets/README.md` — producing commit, versions, the capture command and what each field pins.
[^host-tests]: `packages/markdown-lint/__test__/markdownlint-host.test.ts`.
[^host-config-tests]: `packages/markdown-lint/__test__/host-config.test.ts`.
