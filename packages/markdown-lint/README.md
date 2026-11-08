# @effected/markdown-lint

[![npm](https://img.shields.io/npm/v/@effected%2Fmarkdown-lint?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/markdown-lint)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 7.0](https://img.shields.io/badge/TypeScript-7.0-3178c6.svg)](https://www.typescriptlang.org/)

Write a markdown lint rule once, against [`@effected/markdown`](../markdown) trees, and run it two ways: with a pure programmatic linter, or inside [markdownlint](https://github.com/DavidAnson/markdownlint) (and so markdownlint-cli2 and the VS Code extension) as a custom rule. Line numbers, ranges and fixes come from the kit's own positions, so the two hosts report the same findings on the same lines.

> **Pre-`1.0.0`.** This package is part of the `@effected/*` kit, still in `0.x`
> development. It depends on `@effected/markdown` and peers on `effect`.
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version. Full
> policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/markdown-lint

A markdownlint custom rule reads markdownlint's tokens. A linter of your own reads a markdown tree. A team that wants both ends up writing every rule twice, against two parsers, and the two copies drift: a setext heading one parser counts and the other misses, a backslash escape one resolves and the other does not. This package gives a rule one reading of the document — the kit's parsed tree — and adapts the result to whichever host runs it.

It imports no markdownlint. The adapter produces an object that satisfies markdownlint's custom-rule contract structurally, so you bring your own markdownlint and this package never pins it.

## Install

```bash
npm install @effected/markdown-lint effect
```

```bash
pnpm add @effected/markdown-lint effect
```

## Define a rule

A rule is markdownlint-style metadata plus a `check`. The check reads a `LintContext` — the parsed document, the source, its lines and any frontmatter — and reports through `context.diagnostic`, naming a node (or an offset span) rather than counting lines:

```ts
import { LintRule } from "@effected/markdown-lint";

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
```

`LintRule.make` checks the metadata against markdownlint's own custom-rule validation — non-empty names and tags, no name used twice ignoring case, no tag equal to a name, a URL for `information` — and throws on a violation, so markdownlint never refuses an adapted rule at lint time. `MarkdownVisitor.traverse` from `@effected/markdown` is the synchronous, skip-aware walk a check usually wants.

## Run it programmatically

```ts
import { MarkdownLint } from "@effected/markdown-lint";
import { Option } from "effect";

const findings = MarkdownLint.lint("---\ntitle: Notes\n---\n\n# Notes\n", [NoH1], { name: "notes.md" });
for (const finding of findings) {
  console.log(finding.ruleNames[0], finding.lineNumber, finding.column, Option.getOrNull(finding.detail));
}
// no-h1 5 1 Use ## for top-level sections
```

`lint` is pure, synchronous and total. Line numbers count the whole file, frontmatter included. Findings come in rule order, then in the order each rule reported them. A document the kit refuses to parse — only one nested past its hardening cap — is reported as one finding per rule rather than thrown. `lintDocument` runs rules over an already-parsed `MarkdownDocument`, and `lintEffect` is `lint` as an `Effect` under a `MarkdownLint.lint` span.

Each finding is a `LintDiagnostic`: `ruleNames`, `lineNumber`, `column`, and `Option`s of `detail`, `context`, `range` (`[column, length]`), `fixInfo` (markdownlint's one-line fix) and `edit` (the fix as a kit `MarkdownEdit`, for `MarkdownEdit.applyAll`).

## Run it inside markdownlint

```js
// .markdownlint-cli2.mjs
import { MarkdownlintAdapter } from "@effected/markdown-lint";
import { NoH1 } from "./rules/no-h1.js";

export default {
  customRules: MarkdownlintAdapter.rules([NoH1]),
};
```

The adapted rule asks markdownlint for no parser. It rebuilds the file from markdownlint's `frontMatterLines` and `lines`, parses it with the kit once per file however many adapted rules run, runs the check exactly as `MarkdownLint.lint` does, and forwards each finding with `onError`, renumbered the way markdownlint expects: lines after the front matter count from the first content line, and a line inside the front matter sets `frontMatter: true`. markdownlint adds the front matter back when it reports, so its line numbers equal the programmatic host's. Inline `<!-- markdownlint-disable -->` comments, `--fix` and every markdownlint output format work as they do for markdownlint's own rules.

Two things a rule sees differently under markdownlint, because markdownlint hides them from every rule: line endings are `\n`, and the text inside HTML comments is replaced by `.` characters of the same length. Positions are unaffected. Both hosts drop a leading byte order mark before the parse, as markdownlint does, so a BOM-prefixed file's first line is markdown in both.

The adapter is checked against markdownlint-cli2 0.24 (markdownlint 0.42).

## Positions

`PositionMapping` is the one place an offset becomes a markdownlint coordinate:

- A finding's line is its anchor's start line: a setext heading reports on its text line, a multi-line node on its first line.
- A `range` lies on the finding's own line, as markdownlint requires: a span is cut to that line, and the range is absent when nothing of the span is on it, because markdownlint rejects a range of length 0 or one measured on another line (and then fails the lint of the whole file).
- A fix maps to `fixInfo` when it stays within one line, or deletes exactly one whole line (`deleteCount: -1`). Any other fix has no `fixInfo` but keeps its kit `edit`.
- Columns count UTF-16 code units, as markdownlint's string indexes do. `\n`, `\r\n` and a bare `\r` end a line, as they do for markdownlint.

## API

- `LintRule` — a rule: `names`, `description`, `tags`, optional `information`, and `check`. `name` is its first name.
- `LintContext` / `LintReport` / `LintFrontmatter` — what a check reads, and what it reports through `context.diagnostic`.
- `LintDiagnostic` / `LintFixInfo` / `LintRange` — one finding, in markdownlint's `onError` fields.
- `PositionMapping` — offsets to `lineNumber`, `column`, `range` and `fixInfo`; `of(source)` or `fromDocument(document)`.
- `MarkdownLint` — `lint`, `lintDocument` and `lintEffect`, the programmatic host, with `MarkdownLintOptions` (`name`, `dialect`, `frontmatter`).
- `MarkdownlintAdapter` — `rule` and `rules`, to markdownlint custom rules, with `MarkdownlintAdapterOptions` and the structural markdownlint types (`MarkdownlintRule`, `MarkdownlintRuleParams`, `MarkdownlintOnError`, `MarkdownlintErrorInfo`, `MarkdownlintFixInfo`).

## License

[MIT](./LICENSE)
