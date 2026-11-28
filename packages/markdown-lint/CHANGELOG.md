# @effected/markdown-lint

## 0.3.2

### Bug Fixes

- Images nested in one another's labels lint in linear time. Each nesting level's label was re-parsed with every level inside it, so a deep chain cost quadratic time under the rules that read image labels (MD049 and MD052 among them: about 11 s at 8,000 levels). Each level now re-parses only its own characters, reading the nested images from `@effected/markdown`'s image descriptions. A label holding a `$` is still re-read whole, because inline math can cross its brackets.
- Findings on nested image labels match markdownlint where they did not before: a label holding a `]` in a code span now ends where micromark ends it, and so does a nested image whose title holds a `]`. These are MD052, MD053 and MD054 references, and MD039 and MD042 links.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | dependency | updated | 0.31.0 | 0.32.0 |

## 0.3.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | dependency | updated | 0.30.0 | 0.31.0 |
| @effected/yaml | dependency | updated | 0.30.0 | 0.31.0 |

## 0.3.0

### Breaking Changes

- Inline `markdownlint-*` comments are honoured by default, so a document carrying a disable comment now suppresses findings it did not before. Pass `noInlineConfig: true` to `MarkdownLint.lint` or `lintDocument` for the old behaviour.
- The host reads a file as markdownlint does: HTML comment bodies are masked in `LintContext.source`, front matter follows markdownlint's own pattern, and a `---json` block is content rather than front matter.
- `LintFrontmatter.node` is now an `Option`.
- `LintContext` carries a required `config`, so code that builds a `LintContext` by hand must supply it.
- `LintDiagnostic` carries a required `severity` (`"error"` or `"warning"`), stamped from the configuration.
- `MarkdownlintAdapter` passes markdownlint's `params.config` to the rule as `LintContext.config`, with `enabled` and `severity` removed.
- `lintDocument` drops one leading byte-order mark and re-parses the source when its reading and the parse it was given are not aligned.
- `fixInfo.insertText` writes a line break as `"\n"` on CRLF and bare-CR documents, as markdownlint does, where it carried the document's own line ending. The kit `edit` is unchanged, so code that applies `edit` sees no difference; code that applies `fixInfo` itself should write each `\n` as the document's line ending, as markdownlint's `applyFix` does.

### Features

#### The markdownlint 0.42 rule set

- `@effected/markdown-lint/rules` exports all 53 built-in rules (`MD001` through `MD060`), one named export each. `@effected/markdown-lint/rules/all` exports `rules`, the full list, and `uncovered`, the built-ins not ported, which is empty.

- Every markdownlint 0.42 rule has a port, so `rules` reports on the same document everything markdownlint does. The rules most documents trip are among the later additions: `MD007` and `MD029` for list indentation and numbering, `MD034` for bare URLs, `MD044` for proper names, `MD051` and `MD052` for fragment and reference links, `MD053` for unused definitions, and `MD055`, `MD056` and `MD058` for tables.

- `LintReport` and the fix information a diagnostic carries gain an optional `deletesLine`, and `MarkdownLint.applyFixes` applies a whole-line deletion as markdownlint does. `MD053` uses it to remove an unused link reference definition.

#### Configuration and inline comments

- `LintConfig` and `InlineDirectives` on the package root resolve markdownlint's configuration and its inline comments.
- `MarkdownLint.lint` and `lintDocument` accept `config` and `noInlineConfig`; `lintDocument` also accepts `dialect`, used when it re-reads the source.
- `LintContext.config` gives a rule its own settings, `LintDiagnostic.severity` reports the configured severity, and `PositionMapping.lineStart` returns a line's start offset.
- `MarkdownLint.applyFixes(source, findings)` applies findings' fixes to a source as markdownlint's `applyFixes` does.

#### Configuration files

- `MarkdownlintConfigFile.read` and `resolve`, with `MarkdownlintConfigError`, come from the new `@effected/markdown-lint/config` subpath. They read `.markdownlint.jsonc`, `.json`, `.yaml` and `.yml`, follow `extends`, and find the nearest file as markdownlint-cli2 does. They need `FileSystem` and `Path` in `R`; the package root never imports them.

### Bug Fixes

- `MD032`, `MD027` and the table rules end lists, paragraphs and tables at a directive line, as markdownlint does.
- `MD022`'s fix keeps a container's line prefix, `MD009` reads the line after indented code as markdownlint does, and `MD044` and `MD014` report on the last line of an unclosed fence.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | dependency | updated | 0.29.0 | 0.30.0 |
| @effected/jsonc | dependency | added | — | workspace:^ |
| @effected/yaml | dependency | added | — | workspace:^ |

- Both are used only by `./config`.

## 0.2.0

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | dependency | updated | 0.28.0 | 0.29.0 |

### Maintenance

- Force release all packages to pin new effect versions.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.1

### Maintenance

- Republish with no code changes, to confirm the package's npm trusted-publishing connection [#1310][#1310]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1310]: https://github.com/spencerbeggs/effected/pull/1310

## 0.1.0

### Features

#### Initial release

- `@effected/markdown-lint` lets you write a markdown lint rule once, against `@effected/markdown` trees, and run it two ways: with a pure programmatic linter, or inside markdownlint as a custom rule. Line numbers, ranges and fixes come from the kit's own positions, so the two hosts report the same findings on the same lines. It imports no markdownlint: you bring your own, and the adapter is checked against markdownlint-cli2 0.24 (markdownlint 0.42).

```ts
import { LintRule, MarkdownLint, MarkdownlintAdapter } from "@effected/markdown-lint";

const NoH1 = LintRule.make({
  names: ["no-h1", "X001"],
  description: "No level-1 headings",
  tags: ["headings"],
  check: (context, report) => {
    for (const heading of context.document.findAll("heading")) {
      if (heading.depth !== 1) continue;
      report(context.diagnostic({ at: heading, detail: "Use ## for top-level sections", range: true }));
    }
  },
});

// Run it programmatically: pure, synchronous and total.
const findings = MarkdownLint.lint("---\ntitle: Notes\n---\n\n# Notes\n", [NoH1], { name: "notes.md" });

// Or inside markdownlint, from `.markdownlint-cli2.mjs`.
export default { customRules: MarkdownlintAdapter.rules([NoH1]) };
```

- `LintRule.make` checks a rule's metadata against markdownlint's own custom-rule validation and throws on a violation, so markdownlint never refuses an adapted rule at lint time
- `MarkdownLint.lint` counts lines across the whole file, frontmatter included. `lintDocument` runs rules over a parsed document, and `lintEffect` is `lint` under a span
- `MarkdownlintAdapter` parses each file once however many adapted rules run, and inline disable comments, `--fix` and every output format work as for markdownlint's own rules
- `PositionMapping` turns kit offsets into markdownlint's lines, columns, ranges and fixes, and each finding also keeps its fix as a kit `MarkdownEdit` [#1250][#1250]

### Bug Fixes

- Edits for a file that starts with a BOM are reported against the original text, so their offsets line up with the file on disk
- `lintDocument` keeps the BOM, and its documentation says so [#1295][#1295]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | dependency | updated | 0.27.0 | 0.28.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#1250]: https://github.com/spencerbeggs/effected/pull/1250

[#1295]: https://github.com/spencerbeggs/effected/pull/1295
