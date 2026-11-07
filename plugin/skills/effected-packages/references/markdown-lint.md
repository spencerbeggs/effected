# @effected/markdown-lint

Write a markdown lint rule once, against `@effected/markdown` trees, and run it two ways: with a pure programmatic linter, or inside markdownlint (and so markdownlint-cli2 and the VS Code extension) as a custom rule. Line numbers, ranges and fixes come from the kit's own positions, so the two hosts report the same findings on the same lines. Pure tier: one runtime dependency, `@effected/markdown`, and the `effect` peer. **It imports no markdownlint**: the adapter satisfies markdownlint's custom-rule contract structurally, so you bring your own and this package never pins it.

Reach for it when a rule would otherwise be written twice, over kit nodes for your own linter and over markdownlint's micromark tokens for the editor. To read a parse's own facts (`frontmatterFence`, `unresolvedFootnoteReferences`) without any rule machinery, `@effected/markdown` alone suffices.

## Import

```ts
import { LintDiagnostic, LintFixInfo, LintRule, MarkdownLint, MarkdownlintAdapter, PositionMapping } from "@effected/markdown-lint";
import type { LintCheck, LintContext, LintEditLike, LintFrontmatter, LintRange, LintReport, MarkdownLintDocumentOptions, MarkdownLintOptions } from "@effected/markdown-lint";
import type { MarkdownlintAdapterOptions, MarkdownlintErrorInfo, MarkdownlintFixInfo, MarkdownlintOnError, MarkdownlintRule, MarkdownlintRuleParams } from "@effected/markdown-lint";
```

There is no subpath.

## Core API

- **`LintRule.make({ names, description, tags, information?, check })`** → `LintRule`. Metadata is validated to markdownlint's custom-rule validation (non-empty names and tags, no name twice ignoring case, no tag equal to a name, an absolute URL for `information`) and a violation **throws**, so markdownlint never refuses an adapted rule at lint time. The first name is the rule's identity (`name` getter); the rest are aliases.
- **`LintCheck`** — `(context: LintContext, report: (diagnostic: LintDiagnostic) => void) => void`. Synchronous, because markdownlint calls a custom rule synchronously. A `throw` is a broken rule, not a finding, and no host catches it.
- **`LintContext`** — `name`, `document` (`MarkdownDocument`), `root`, `source` (the whole text, frontmatter included), `lines`, `frontmatter: Option<LintFrontmatter>` (`node`, `lineCount`, `lines`), `mapping` (`PositionMapping`), and **`diagnostic(report: LintReport)`** → `LintDiagnostic`, stamped with the running rule's names.
- **`LintReport`** — `at` (a node or an offset span; its start gives the line and column), optional `detail`, `context`, `range` (`true` for `at`'s span, or another span), `fix` (`LintEditLike`, a kit offset edit over `source`).
- **`LintDiagnostic`** — `ruleNames`, `lineNumber`, `column`, and `Option`s of `detail`, `context`, `range` (`LintRange`, `[column, length]`), `fixInfo` (`LintFixInfo`: optional `lineNumber`, `editColumn`, `deleteCount`, `insertText`) and `edit` (the kit `MarkdownEdit`, for `MarkdownEdit.applyAll`).
- **`MarkdownLint.lint(source, rules, options?)`** → `ReadonlyArray<LintDiagnostic>`. Pure, synchronous and total. `MarkdownLintOptions`: `name` (default `"<input>"`), `dialect` (default `"gfm"`), `frontmatter` (default `true`). **`MarkdownLint.lintDocument(document, rules, options?)`** runs over an already-parsed `MarkdownDocument`. **`MarkdownLint.lintEffect(source, rules, options?)`** → `Effect<ReadonlyArray<LintDiagnostic>>` is `lint` under a `MarkdownLint.lint` span; a rule's `throw` or a name clash is a defect.
- **`MarkdownlintAdapter.rule(lintRule, options?)`** → `MarkdownlintRule` and **`MarkdownlintAdapter.rules(lintRules, options?)`** → `Array<MarkdownlintRule>`, with `parser: "none"`. The adapter rebuilds the file from `frontMatterLines` and `lines`, parses once per file however many adapted rules run, and renumbers: a line after the front matter counts from the first content line, and a line inside it sets `frontMatter: true`. markdownlint adds the front matter back when it reports, so its line numbers equal the programmatic host's. Inline disable comments, `--fix` and every output format work as for markdownlint's own rules.
- **`PositionMapping.of(source)`** / **`PositionMapping.fromDocument(document)`** — the one place an offset becomes a markdownlint coordinate: `lineCount`, `lines()`, `lineText(lineNumber)`, `lineNumber(offset)`, `column(offset)`, `nodeLineNumber(node)`, `range(span, lineNumber?)` → `Option<LintRange>`, `fixInfo(edit, lineNumber)` → `Option<LintFixInfo>`, and static `edit(edit)` → `MarkdownEdit`.

## Usage

```ts
import { LintRule, MarkdownLint } from "@effected/markdown-lint";
import { Option } from "effect";

export const NoH1 = LintRule.make({
  names: ["no-h1", "X001"],
  description: "No level-1 headings",
  tags: ["headings"],
  information: "https://example.com/rules/no-h1",
  check: (context, report) => {
    for (const heading of context.document.findAll("heading")) {
      if (heading.depth !== 1) continue;
      const start = heading.position.start.offset;
      report(
        context.diagnostic({
          at: heading,
          detail: "Use ## for top-level sections",
          range: true,
          fix: { offset: start, length: 1, content: "##" },
        }),
      );
    }
  },
});

for (const finding of MarkdownLint.lint("---\ntitle: Notes\n---\n\n# Notes\n", [NoH1], { name: "notes.md" })) {
  console.log(finding.ruleNames[0], finding.lineNumber, finding.column, Option.getOrNull(finding.detail));
}
// no-h1 5 1 Use ## for top-level sections
```

```js
// .markdownlint-cli2.mjs
import { MarkdownlintAdapter } from "@effected/markdown-lint";
import { NoH1 } from "./rules/no-h1.js";

export default { customRules: MarkdownlintAdapter.rules([NoH1]) };
```

`MarkdownVisitor.traverse` from `@effected/markdown` is the synchronous, skip-aware walk a check usually wants.

## Traps

- **A parse refusal is a finding, not a throw.** A document nested past the kit's hardening cap is reported as one finding per rule, in both hosts; markdownlint gives a rule no failure channel, and the hosts must agree.
- **A fix does not always map to `fixInfo`.** Only an edit within one line, or one deleting exactly one whole line (`deleteCount: -1`), does. Any other fix has `fixInfo` absent and keeps its kit `edit`: markdownlint's `--fix` skips it, `MarkdownEdit.applyAll` does not.
- **A `range` lies on the finding's own line.** A span is cut to that line and absent when nothing of it is there, because markdownlint rejects a range of length 0 or one measured on another line, and then fails the lint of the whole file.
- **Two rules sharing a name throw**, ignoring case, as a wiring error in `lint` and `lintDocument`.
- **Under markdownlint a rule sees normalized text.** Line endings are `\n`, and the text inside HTML comments is replaced by `.` characters of the same length; positions are unaffected. Both hosts drop a leading byte order mark.
- **`LintFrontmatter.lines` is the kit capture, not markdownlint's `frontMatterLines`,** which can differ (a trailing blank after `---`, `{…}` and `...`-closed blocks). A rule walking `root.children` sees the `frontmatter` node first and decides for itself whether it is content.
- **Findings are ordered differently across hosts.** `MarkdownLint.lint` keeps rule order then report order; markdownlint sorts by rule name then line. The findings themselves match.
- **A GFM short table row is padded in the tree** with zero-width cells, so a rule cannot count the cells an author wrote.
- **`params.config` is not on `LintContext`:** rule configuration is not surfaced, so close over any options when you build the rule.

## Not included

The rules themselves (the package ships the shape and the two hosts, no built-in rule set) and any markdownlint dependency. The adapter is checked against markdownlint-cli2 0.24 (markdownlint 0.42).
