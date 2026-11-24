---
type: Module
title: "@effected/markdown-lint"
description: "A markdownlint-compatible lint rule shape over @effected/markdown trees: one LintRule definition with markdownlint metadata, a pure programmatic host (MarkdownLint) resolving markdownlint configuration and inline comments, a markdownlint custom-rule adapter (MarkdownlintAdapter), 25 ported built-in rules on ./rules held to markdownlint by a differential harness, and a ./config reader of markdownlint config files; every line, range and fix derived from kit offsets by PositionMapping."
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
  by: "okfit/claude-code"
  at: 2026-11-24T07:58:15Z
integrity:
  generated:
    body: cc9b03872fc80c8b
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

**[Boundary tier](../glossary/library-tier.md).** The root, `./rules` and
`./rules/all` perform no IO; the `./config` subpath reads files through core
`FileSystem` and `Path`, required in `R` and provided by the consumer's
platform layer. Three regular `workspace:^` dependencies, all pure and none a
shared-instance contract the
[peer discipline](../conventions/peer-dependency-discipline.md) would ask a
peer for: `@effected/markdown`, which every entry point uses, and
`@effected/jsonc` and `@effected/yaml`, which only `./config` imports. The
`effect` peer is the only peer, and there are **zero external runtime
dependencies**. `@effected/source`'s `LineIndex` comes through
`@effected/markdown`'s re-export, so there is no second edge.
**No markdownlint import, at any tier**: the adapter matches markdownlint's
custom-rule contract structurally with local types, so a consumer brings
their own markdownlint and the package cannot pin it.

## Entry points

| Entry | Holds | May import |
| --- | --- | --- |
| `.` | `LintRule`, `LintContext`, `LintDiagnostic`, `PositionMapping`, `LintConfig`, `InlineDirectives`, the `MarkdownLint` host and the `MarkdownlintAdapter` | `@effected/markdown` and `effect`; never a rule module, `./config`, `node:` or a format engine |
| `./rules` | the 25 ported built-in rules, one free-standing named export each (`MD001` … `MD060`) | the root, through the package's own name for types |
| `./rules/all` | `rules`, every port in markdownlint's order, and `uncovered`, the 28 built-in rule names with no port yet | the rule modules |
| `./config` | `MarkdownlintConfigFile` and `MarkdownlintConfigError` | the root, `@effected/jsonc`, `@effected/yaml`, `FileSystem` and `Path` |

The rules are separate exports so a consumer pays only for the rules it
imports; `./rules/all` is the one module that reaches every rule. The root
purity gate in `rules-metadata.test.ts` walks the source import graph and
fails if the root reaches a rule or config module, `node:` or a format
engine. The subpaths name root types through `import type * as Lint from
"@effected/markdown-lint"` and import values relatively, so one `LintRule`
class exists at runtime; `effected.toml` keeps that name external in the
declarations (`dtsExternals`) and scopes an `ae-forgotten-export` suppression
to the three subpath entries, the `cli-kit` `./ui` precedent, and
`subpaths.test.ts` pins that no subpath declaration leaks a local.

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
  count and lines), `mapping`, `config` (the rule's own settings, without
  `enabled` and `severity`), and `diagnostic(report)`, the builder a rule
  reports through. A `LintReport` names its anchor as a node or an offset
  span, plus optional `detail`, `context`, `range` (`true` for the anchor's
  span, or another span) and `fix` (a kit offset edit).
- `LintDiagnostic` — `ruleNames`, `lineNumber`, `column`, `severity`
  (`LintSeverity`, `"error"` or `"warning"`), and `Option`s of
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
  A line break in `fixInfo.insertText` is written `\n`, as markdownlint
  writes it and its `applyFix` expects it; the kit `edit` keeps the source's
  own ending.
  `lineStart(lineNumber)` is a line's start offset: the one line table the
  rules read, so no rule keeps a second one.
- `LintConfig` — static, pure: `effective(config, rules)` resolves
  markdownlint's configuration object (`default`, rule and tag keys,
  `enabled` and `severity` inside a rule's object) to per-rule
  `enabled`, `severity` and settings maps (a key naming a tag or a
  name, case-insensitive, reaches every rule it names), `merge(base, over)`
  is markdownlint's shallow `extends` merge, and `key(rule)` is the key a rule's
  entries live under.
- `InlineDirectives` — static, pure: `resolve(lines, config, rules,
  options)` reads the `<!-- markdownlint-… -->` comments (`disable`,
  `enable`, `capture`, `restore`, the `-file`, `-line` and `-next-line`
  forms, `configure-file`) and returns the effective configuration and each
  line's enabled map; `noInlineConfig: true` ignores them.
- `MarkdownLint` — `lint(source, rules, options)` (total and synchronous),
  `lintDocument(document, rules, options)` for an already-parsed document
  (the same reading and findings as `lint` over `document.source`: one
  leading byte order mark is dropped, the parse is reused when it already is
  markdownlint's reading, otherwise the source is re-read with
  `options.dialect`, default gfm), and
  `applyFixes(source, findings)`, which applies findings' kit edits under
  markdownlint's `applyFixes` policy (the fix `markdownlint-cli2 --fix`
  makes: the findings first put in markdownlint's result order, rule name
  then line, so neither the rules' order nor the array's decides a tie;
  identical fixes once, one insert per line and column, the longest,
  an insert and a delete at one column made one replace, a fix running into
  the one to its right skipped, a whole-line delete taking its line's other
  fixes; then, as markdownlint does, every line break in the result is
  rewritten to the source's most common ending, so a mixed-ending file comes
  back with one ending), and
  `lintEffect`, the `Effect` under a `MarkdownLint.lint` span defined in
  terms of `lint`. Options (`MarkdownLintOptions`): `name`, `dialect`,
  `frontmatter`, `config` and `noInlineConfig`. Defaults: gfm, frontmatter
  capture on (markdownlint always strips front matter), `{ default: true }`,
  inline comments honoured. Findings come in rule order, then report
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
same text and tree in both hosts: front matter is found by markdownlint's
own pattern, run with the RE2 semantics markdownlint runs it under (ASCII
`\s`, `^` and `$` at `\n` only), HTML comment bodies after the front matter
are masked before the parse, and `LintFrontmatter.lineCount` and `lines` are
markdownlint's own front matter count (its closing `---` swallows trailing
blank lines). `LintFrontmatter.node` is `Option.some` only when the kit
captured that block too; a block the kit does not capture (`{…}`, a
`...`-closed one) is parsed as spaces of equal length, so no tree node lies
inside it and no offset moves. A `---json` block is not front matter to
markdownlint, so it is not captured either: it is read as content, a
thematic break and what follows. The text before masking is not on
`LintContext`: only the reader of an HTML block that is one comment needs
it (markdownlint reads that comment before masking it), the host records it
internally, and under markdownlint it equals the masked text.

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
`params.config` and the kit-side severity is `error`. A rule that reads
`front_matter_title` (MD001, MD025, MD041) takes a falsy value (`false`,
`0`, `null`, `""`) to mean front matter is ignored, as markdownlint does.
Every rule reads its settings as markdownlint's rule reads them, coerced
rather than type-checked, through one reader per upstream idiom in
`src/internal/settings.ts` (`Number(x ?? d)`, `!!x`, `x === undefined ||
!!x`, `String(x || d)`, `String(x === undefined ? d : x)`, a list of
strings): `"50"` is `50`, `0` is `false`, a number where a string goes is its
text. A setting never throws: where markdownlint's own reading throws or
hangs, the kit reads it as absent or bounds it (see Known divergences). A differential test
runs both hosts over the same inputs and configs and requires equal lines,
details and severities[^host-config-tests].

The `./config` subpath reads that object from disk, and is the package's only
file-system code: `MarkdownlintConfigFile` needs `FileSystem` and `Path` in
`R`, parses with `@effected/jsonc` and `@effected/yaml`, and nothing reachable
from the package root imports it (the root-purity gate in
`rules-metadata.test.ts`). `read(path)` reads one file and its `extends`
chain. A reference is a file path, relative to the extending file or absolute;
a package specifier or a leading `~`, which markdownlint also resolves, is
read as a relative path (see Known divergences).
Each file is merged over the one it extends with `LintConfig.merge`. The caps
are 16 links and 1 MiB per file, the size checked before parsing.
`resolve(filePath, { root })` follows markdownlint-cli2, as a probe of cli2
0.24.2 established. It walks from the file's directory up to `root`. In each
directory the first of `.markdownlint.jsonc`, `.json`, `.yaml`, `.yml` is
that directory's config. The nearest directory holding one decides, with its
own `extends` chain. A farther directory's config is **replaced**, not merged:
cli2 inherits an ancestor's config only into a directory with none. The
result, `ResolvedLintConfig`, is the `config`, the `files` it came from (the
nearest file then its `extends` chain) and the unsupported files the walk
`skipped`; with no config found it is `{}`. Every failure is a
`MarkdownlintConfigError`, a `Schema.TaggedError` with a `reason`
(`unreadable`, `parse`, `extends-missing`, `extends-cycle`,
`extends-depth`, `too-large`, `unsupported`), the offending `path`, and an
optional `detail` and `cause`[^config-file-tests]. Why the reader models
markdownlint's configuration and not markdownlint-cli2's options files is
[the config-model decision](../decisions/markdown-lint-targets-markdownlint.md).

## The ported rules

`./rules` ports 25 of markdownlint 0.42's 53 built-in rules: MD001, MD003, MD004, MD009, MD010, MD012, MD013, MD018, MD019, MD020, MD021, MD022, MD023, MD024, MD025, MD026, MD031, MD032, MD033, MD035, MD040, MD041, MD045, MD047 and MD060. Each is an
ordinary `LintRule` carrying markdownlint's own names, description, tags and
documentation link, and a rule with settings reads them from
`LintContext.config` under markdownlint's names and defaults, coerced as
markdownlint coerces them. `./rules/all`'s `uncovered` lists the
other 28 by first name. The metadata gate in `rules-metadata.test.ts` reads
the installed markdownlint's rule list and requires every port's metadata
to equal it, both lists to be in markdownlint's order, every built-in rule
to be ported or uncovered exactly once, and `./rules` to export exactly
`./rules/all`'s rules.

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
  exact-pinned `markdownlint` devDependency, 0.42.2 like the vendored
  source and the copy the workspace root's `markdownlint-cli2` 0.24.2
  resolves, through a variable specifier so no `src/` type resolves
  against its declarations, and runs the adapted rules in it:
  byte-identical to the golden, `applyFixes` over the mapped `fixInfo` equal
  to `MarkdownEdit.applyAll` over the kit edits (LF, CRLF, frontmatter,
  astral characters), `frontMatter` numbering, inline disable comments, one
  parse per file, and every adapted rule accepted by markdownlint's own
  custom-rule validation[^host-tests].
- `position-mapping.test.ts` pins setext, multi-line, frontmatter, CRLF,
  bare `\r`, UTF-16 and every `fixInfo` branch.
- **The differential harness** (`__test__/helpers/differential.ts`) proves
  every rule port: it runs one kit rule and the markdownlint rule of the same
  name, each alone, over every fixture of the corpus (as written, as LF and as
  CRLF) plus each test's extra inputs, compares the findings as an ordered
  list field by field, then compares the text the two engines' fixes produce
  (`MarkdownLint.applyFixes` against markdownlint's `applyFixes`). Each rule's
  test asserts the exact list of divergences, normally empty, so a divergence
  that appears or disappears fails. `differential-harness.test.ts` holds the
  harness to a positive control (a faithful throwaway MD047, zero
  divergences) and negative ones (a late line, a missing finding, a wrong
  fix). The oracle is the exact-pinned `markdownlint` devDependency, 0.42.2.
  `fixesDifferential` applies the fixes of several rules enabled together in
  both engines over the corpus as written, as CRLF and as bare CR, and
  compares the text: `multi-rule-fixes.test.ts` runs every ported rule
  together and five pairs whose fixes meet, each at zero divergence.
  `settingsDifferential` runs the same comparison over named settings cases
  and a few probe documents without the corpus: every rule with settings is
  held to zero divergence on non-canonical values (quoted numbers, `0` and
  `1` for booleans, `null`, numbers for strings, per-level items as
  written), and the residues below are pinned by count.
- **The vendored corpus.** `__test__/fixtures/markdownlint/` holds 437
  byte-identical copies of upstream's `test/*.md` at tag `v0.42.2`, copied
  from the `.repos/markdownlint` submodule by
  `scripts/capture-markdownlint-corpus.mjs` (no arguments, idempotent), whose
  `README.md` records the tag, the commit and the count. Never edit a fixture
  by hand; re-run the script after re-pinning the submodule.
- **Hostile-input ceilings.** `hostile-inputs.test.ts` lints seven shapes that
  once made a lint with all 22 rules superlinear (a 400-column table with CJK
  cells, 2,000 unclosed fences in list items, a 9,000-block mixed document,
  3,000 lines in blockquotes 40 deep with inline HTML, one paragraph of
  60,000 code-span, link and lone `$` groups, one 198 KB line holding an
  inline data-URI image, one line of 16,000 HTML comments), `applyFixes` over
  90,000 fixes, and three settings that drive a loop or a repeat
  (`lines_above: 1e999` and `spaces_per_tab: 1e9` in a `configure-file`
  comment, `lines_above: 1e8`), and holds each to a 5,000 ms ceiling: far
  above the fixed times (under 1 s) and far below the unfixed ones (9 to
  21 s, or never returning). The reading pass's own ceilings (the comment
  mask and the front matter count) sit there too, at 1,000 ms. It is in the root `vitest.config.ts`'s `SLOW_TESTS` and
  `TIMING_TESTS`, so it runs in the timing tier, alone on its runner, and
  never in the fast tier (see [the test tiers](../decisions/vitest-test-tiers.md)).

## Known divergences

- GFM pads a short table row to the header's width, and the kit tree
  carries the padding as zero-width cells, so a kit rule cannot count the
  cells an author wrote; the CSH005 port reports a short row's padded cells
  as empty values where systems' micromark rule reports "too few columns".
  Pinned by a test.
- A parse refusal (a document nested past the hardening cap) is reported
  per rule at severity `error` in the programmatic host, whatever the rule's
  configured `severity`; under the adapter markdownlint applies the
  configured severity to the same refusal finding. Pinned by a test
  (`host-config.test.ts`).
- `InlineDirectives` creates its comment regex per `resolve` call.
  markdownlint's is global and module-level, so an unclosed inline comment
  leaves its `lastIndex` set and the next document's first line is searched
  from that position. The kit carries the position from line to line within
  one document, as markdownlint does (pinned by a test), and never into the
  next document, so a lint does not depend on what was linted before it.
  Deliberate; no cross-document test pins it.
- MD047's fix and `MarkdownLint.applyFixes`'s line-ending rewrite use the
  source's most common line ending, and `\n` when the source has none. markdownlint takes `os.EOL` there, so on Windows it writes
  `\r\n` into a file with no line break where the kit writes `\n`. Identical
  on every other platform; not pinned, since CI runs on Linux.
- Under `MarkdownlintAdapter`, MD025 and MD041 read an HTML block's comment
  from markdownlint's masked lines, because markdownlint hands a custom rule
  no unmasked text, where the programmatic host and markdownlint's own rules
  read the comment as written. The mask keeps `<!--` and `-->` and replaces
  the body with `.` runs, so a comment that is not one to markdownlint
  because its body ends in `-` (`<!-- a --->`) reads as one under the
  adapter: before `# Title`, markdownlint's MD041 reports line 1 and the
  adapted MD041 nothing; before two h1s, markdownlint's MD041 reports line 1
  and the adapted MD025 reports the second h1 instead. A comment whose body
  starts with `>` or `->` keeps those characters through the mask, so both
  hosts agree there. Pinned by a test (`markdownlint-host.test.ts`, the two
  inputs and a control).
- MD012 under `maximum: 0`: markdownlint 0.42.2 throws on a file that is
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
- Two or more leading byte order marks: markdownlint drops one before it
  reads front matter, so a second is text there and no block after it is
  front matter. micromark then drops one more before it parses, while
  markdownlint slices each token's text from the text it kept, so every
  token text it reads runs one character behind: an ATX `#` sequence reads
  as a line break and a setext underline as a line break and `--`, and
  markdownlint's `getHeadingLevel` reads both as level 1. `@effected/markdown`
  drops no mark, so any source opening with two or more marks can diverge
  wherever a rule reads a heading level, a range or a token's text. Observed
  against markdownlint 0.42.1 over 1 to 4 marks, and the pinned inputs hold
  under 0.42.2: two marks before `# Title`
  are a heading there and text here (MD041); two marks before a `---` block
  give a thematic break and a setext heading on line 2 there, a setext
  heading on line 1 here (MD022); three or four marks before a `---` block,
  with or without a title, make its setext heading markdownlint's level-1
  title (MD025 reports the later h1s, MD041 nothing) where the kit reports
  MD041 on line 1. Matching it needs the parser to drop the mark. Pinned by
  a test (MD041 2 inputs, MD022 1, MD025 1).
- **The kit bounds a setting where markdownlint hangs or throws.** Settings
  are document content (an inline `configure-file` comment), so a count or a
  width that drives a loop or a `repeat` is input. MD022 counts blank lines
  beside a heading, and every line past the document's edge reads as blank:
  markdownlint loops through them one by one, forever under `lines_above:
  1e999`, where the kit stops at the edge and counts the rest at once (the
  same count for any finite setting, pinned against markdownlint up to 500).
  A repeat is capped at 1,000: MD010's spaces per tab (markdownlint throws
  `RangeError` at `spaces_per_tab: 1e9`) and the blank lines an MD022 fix
  inserts. No fix differs below the cap. Pinned by ceiling tests.
- **The kit reads a setting markdownlint throws on.** An invalid
  `front_matter_title` pattern (`"("`) reads as the default pattern in
  MD001, MD025 and MD041, where markdownlint's `new RegExp` throws; a truthy
  `ignore_code_languages` that is not a list reads as no languages in MD010,
  where markdownlint calls `.map` on it and throws; a value whose conversion
  to a primitive throws reads as absent. Pinned by tests (MD001 42 inputs,
  MD025 32, MD041 32, MD010 33, each a markdownlint throw).
- **A fractional MD013 limit reports no range.** markdownlint reports a
  fractional limit's overflow as fractional columns (`[51.5, 69.5]`); a kit
  range is whole columns, so the kit's finding carries none, with the same
  line and detail. Before this the kit threw a schema error out of `lint`.
  Pinned by a test (29 inputs).
- **An empty insert carries no `fixInfo`.** MD022 compares a per-level
  `lines_above` / `lines_below` item as written (`["2"]`, `[null]`,
  `[true]`) and a fractional count as a number, so markdownlint can report a
  heading whose blank lines are right, with a fix inserting nothing
  (`{ insertText: "" }`). The kit reports the same finding, but an empty edit
  maps to no `fixInfo`. MD012 under a negative `maximum` reports every line,
  which is the all-blank case above: the last line's delete differs. The
  text the fixes leave is markdownlint's in both. Pinned by tests (MD022 41
  inputs, MD012 16).
- **A decoded and an escaped reference in one text node.** MD013 tells a
  decoded named reference from one the parse left as text by looking for it
  in the text node's value, so an escaped `\&amp;` later in the same node
  makes an earlier decoded `&amp;` read as text, and its link line stops
  being link-only. Pinned by a test (1 input).
- **A tab after spaces before a math fence in a container.** The math fence
  patterns read spaces only, where micromark expands a tab to its column, so
  in a blockquote `> \t$$` opens math to micromark and not to the kit, and
  `>   \t$$` the reverse. A probe across containers found 92 such readings,
  all in blockquotes, in MD033, MD045 and MD060. Pinned by a test (MD060 1
  input, MD033 1).
- **HTML inside an undefined reference is reported twice by markdownlint.**
  From 0.42.2 markdownlint's micromark-parse copies a bracket's `htmlText`
  events into the artificial `undefinedReference` token it builds for MD052,
  so its MD033 reports an element in `[<b>x</b>]`, `[<b>x</b>][]`,
  `[x][<i>y</i>]` or a label spanning a line break twice, at the same
  column. The kit reports it once, as 0.42.1 did; a defined reference is
  reported once by both. Pinned by a test (MD033 4 inputs). The same copy
  takes `autolink*`, `codeText*`, `attentionSequence` and `mathText*`
  events, so expect the same double count when MD034, MD038, MD049 or MD050
  is ported.
- **Findings come in rule order.** `MarkdownLint.lint` returns findings in
  the order of the rules it was given, each rule's in the order it reported
  them; markdownlint sorts its results by rule name, then line. With the
  rules in name order (`./rules/all`'s order) the two agree except where one
  rule reports lines out of order: over the corpus in LF and CRLF, 2 of 874
  inputs, `lists-in-blockquote.md`, where MD004 walks a nested list in a
  blockquote and reports lines 68 and 69 before 65. With the rule list
  reversed, 64 differ. `MarkdownLint.applyFixes` sorts its findings into
  markdownlint's order itself, so the fixed text does not depend on either.
  Pinned by a test (`multi-rule-fixes.test.ts`).

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
  cli2 tries between them: TOML content in a `.markdownlint.json` (or any
  config) fails `parse`, where cli2 accepts it. No `.markdownlint.toml` is
  looked for on the walk, in either. Pinned by a test.
- `./config` reads `extends` as a file path only. markdownlint falls back to
  module resolution when the path is not a file, so `"extends":
  "markdownlint/style/prettier"` or a shared `@org/markdownlint-config`
  works there, and it expands a leading `~` to the home directory. The kit
  reads each as a path relative to the extending file and fails
  `extends-missing`. Deliberate: the design limits `extends` to relative or
  absolute paths. Pinned by a test.
- `./config` detects an `extends` cycle by resolved path, lexically, without
  following symlinks: a chain that re-enters one file through a symlink
  alias runs to the 16-link cap and fails `extends-depth` rather than
  `extends-cycle`.
- `./config` refuses, as `unreadable`, a config file that is not a regular
  file (a directory, a FIFO, a device), before reading it: a device or FIFO
  reports size 0, so the size cap alone would not bound the read.
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
  autolink, a footnote call, or a link's or image's destination starts
  first. A link's or image's label is read inline, so math can open
  there. Inline HTML and images inside math are not reported.

- markdownlint re-parses an HTML block (other than one comment) as
  Markdown with HTML blocks and indented code turned off, and MD033 and
  MD045 report the tags it finds there. The kit's dialects cannot turn a
  construct off, so the kit parses the block's lines as written and
  neutralizes what those two constructs read, then parses again, until a
  parse finds neither. An HTML block that interrupts a paragraph is
  indented four columns, which makes it a continuation line. One right
  after a table gets a leading pipe, which makes it a body row. Any other
  HTML block or indented code block gets a stub line before it. A
  neutralized node is handled whole in one pass: every run after a blank
  line, and every line opening a deeper blockquote, gets its own stub.
  Fences, headings, lists, blockquotes, thematic breaks and tables are
  read as written. The parse runs at most eight times; no corpus block
  and no adversarial shape tried needs more than four. Past the cap, a
  terminal sweep gives every remaining node's lines a stub each and reads
  the block from one more parse, so no line is left unread as code. The
  swept lines and their stubs read as one paragraph, so a tag spanning two
  lines is still read as one tag, with a stub's `x` inside it.

- MD060 measures with a port of string-width 8.3.0 and
  get-east-asian-width 1.7.0's Wide and Fullwidth ranges, the copies
  markdownlint 0.42.2 installs. It does not strip ANSI escape sequences
  first, as string-width does.

- `lintDocument` cannot know the dialect a document was parsed with:
  `MarkdownDocument` does not record it, so it trusts `options.dialect`
  (default gfm) to match the parse on both of its paths. When the given
  parse is not already markdownlint's reading, the source is re-read with
  `options.dialect`; when it is, the parse is reused and the option is never
  checked against it. A caller who parsed as commonmark passes `dialect:
  "commonmark"`; one who omits it gets a gfm re-read on the first path and
  their own commonmark tree on the second.

[^issue-1030]: <https://github.com/spencerbeggs/effected/issues/1030>
[^markdownlint-types]: markdownlint's `lib/markdownlint.d.mts`, checked against the markdownlint 0.42 that markdownlint-cli2 0.24 runs.
[^golden-readme]: `packages/markdown-lint/__test__/fixtures/changesets/README.md` — producing commit, versions, the capture command and what each field pins.
[^host-tests]: `packages/markdown-lint/__test__/markdownlint-host.test.ts`.
[^host-config-tests]: `packages/markdown-lint/__test__/host-config.test.ts`.
[^config-file-tests]: `packages/markdown-lint/__test__/config-file.test.ts`.
