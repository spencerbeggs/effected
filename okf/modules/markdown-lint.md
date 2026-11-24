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
  - id: config-file-tests
    resource: ../../packages/markdown-lint/__test__/config-file.test.ts
  - id: systems-804
    resource: https://github.com/savvy-web/systems/issues/804
generated:
  by: "claude-code/opus-5.5"
  at: 2026-11-24T00:58:24Z
integrity:
  generated:
    body: 10197b53d94b2d15
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
  `applyFixes(source, findings)`, which applies findings' kit edits under
  markdownlint's `applyFixes` policy (the fix `markdownlint-cli2 --fix`
  makes: identical fixes once, one insert per line and column, the longest,
  an insert and a delete at one column made one replace, a fix running into
  the one to its right skipped, a whole-line delete taking its line's other
  fixes), and
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

The `./config` subpath reads that object from disk, and is the package's only
file-system code: `MarkdownlintConfigFile` needs `FileSystem` and `Path` in
`R`, parses with `@effected/jsonc` and `@effected/yaml`, and nothing reachable
from the package root imports it (the root-purity gate in
`rules-metadata.test.ts`). `read(path)` reads one file and its `extends`
chain. A reference is a file path, relative to the extending file or absolute.
Each file is merged over the one it extends with `LintConfig.merge`. The caps
are 16 links and 1 MiB per file, the size checked before parsing.
`resolve(filePath, { root })` follows markdownlint-cli2, as a probe of cli2
0.24.2 established. It walks from the file's directory up to `root`. In each
directory the first of `.markdownlint.jsonc`, `.json`, `.yaml`, `.yml` is
that directory's config. The nearest directory holding one decides, with its
own `extends` chain. A farther directory's config is **replaced**, not merged:
cli2 inherits an ancestor's config only into a directory with none. Every
failure is a `MarkdownlintConfigError` with a `reason` and the offending
`path`[^config-file-tests].

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
  its per-line enabled state. The kit reports nothing there, which the pin
  asserts. Pinned by a test as an upstream failure, not a port difference.
- MD012 under `maximum: 0` on a document of nothing but blank lines:
  markdownlint deletes every line. n lines hold n - 1 line breaks, so n
  disjoint kit edits cannot each delete one: the last line's delete is an
  empty edit, which carries no `fixInfo`, since an empty edit changes
  nothing where markdownlint's delete of that line alone would remove a
  line break. The kit edits still apply to markdownlint's text. Pinned by a
  test (two and three blank lines, 2 inputs).

- `./config` loads no JavaScript config (`.markdownlint.cjs`, `.mjs`) and
  none of cli2's own options files (`.markdownlint-cli2.*`). A directory
  holding only such files goes in `ResolvedLintConfig.skipped` and the walk
  continues to its parent; cli2 would load the JS config and stop there.
  Named directly or by `extends`, such a file fails `unsupported`. Beside a
  supported file it is not reported: cli2 prefers the supported file.
  cli2's `.markdownlint-cli2.*` layering, its `config` merge across
  directories and its `overrides` are not modelled. Pinned by a test.
- `./config` parses content as JSONC (trailing commas allowed) and then as
  YAML, whatever the extension, as cli2 does, but without the TOML parser
  cli2 tries between them.
- `./config` fails `parse` for a parsed value that is not an object (an
  array, a scalar), where markdownlint reads it as `{}`; an empty document
  (empty, whitespace or comments only, a bare `null` or `~`) reads as `{}`,
  as in cli2. It
  fails `parse` for a truthy non-string `extends`, where markdownlint throws
  a `TypeError` out of its callback. A falsy `extends` is left in place
  and not followed, as markdownlint does. Pinned by tests.

## Known limitations

- Fixes from several findings can meet (MD022's two headings asking for the
  blank line between them). `MarkdownEdit.applyAll` applies every edit and
  refuses an overlap; apply findings with `MarkdownLint.applyFixes`, which
  follows markdownlint's policy and is what the differential harness
  compares with markdownlint's own `applyFixes`.

- markdownlint's micromark runs the math extension; the kit tree carries no
  math. The rules read `$$` blocks from each container's own lines instead
  (the document's, a blockquote's, a list item's, a footnote's, as the tree
  places them, with the container's markers and indentation removed): an
  opening line of two or more `$` with no `$` in its meta, indented at most
  three columns, outside code and HTML blocks, to a closing line of at
  least as many `$` indented at most three columns; an unclosed block ends
  at a lazy line or where its container ends. The headings the kit reads
  inside a block are dropped, and so are lists, fences and tables starting
  past a block's opening line. A line the kit reads as lazy continuation of
  a child container is read at its parent's level when it opens a block,
  since math interrupts a paragraph in micromark. A footnote's indentation
  is taken as four columns from its marker.

- The math extension's inline `$` math is read the same way, from each
  paragraph's, heading's and table cell's source: a run of `$` closed by
  the next run of exactly as many, unless a code span, inline HTML, an
  autolink, an image or a link destination starts first. Inline HTML and
  images inside it are not reported.

- markdownlint re-parses an HTML block (other than one comment) as
  Markdown with HTML blocks and indented code turned off, and MD033 and
  MD045 report the tags it finds there. The kit's dialects cannot turn a
  construct off, so the kit parses the block's lines as written and
  neutralizes what those two constructs read, then parses again, until a
  parse finds neither. An HTML block that interrupts a paragraph is
  indented four columns, which makes it a continuation line. One right
  after a table gets a leading pipe, which makes it a body row. Any other
  HTML block or indented code block gets a stub line before it. Fences,
  headings, lists, blockquotes, thematic breaks and tables are read as
  written. The parse runs at most eight times, and a block still unsettled
  after that is read as the last parse read it. No corpus block needs more
  than three.

- MD060 measures with a port of string-width 8.3.0 and
  get-east-asian-width 1.7.0's Wide and Fullwidth ranges, the copies
  markdownlint 0.42.1 installs. It does not strip ANSI escape sequences
  first, as string-width does.

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
[^config-file-tests]: `packages/markdown-lint/__test__/config-file.test.ts`.
