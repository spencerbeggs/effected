---
"@effected/markdown-lint": minor
---

## Breaking Changes

* Inline `markdownlint-*` comments are honoured by default, so a document carrying a disable comment now suppresses findings it did not before. Pass `noInlineConfig: true` to `MarkdownLint.lint` or `lintDocument` for the old behaviour.
* The host reads a file as markdownlint does: HTML comment bodies are masked in `LintContext.source`, front matter follows markdownlint's own pattern, and a `---json` block is content rather than front matter.
* `LintFrontmatter.node` is now an `Option`.
* `LintContext` carries a required `config`, so code that builds a `LintContext` by hand must supply it.
* `LintDiagnostic` carries a required `severity` (`"error"` or `"warning"`), stamped from the configuration.
* `MarkdownlintAdapter` passes markdownlint's `params.config` to the rule as `LintContext.config`, with `enabled` and `severity` removed.
* `lintDocument` drops one leading byte-order mark and re-parses the source when its reading and the parse it was given are not aligned.
* `fixInfo.insertText` writes a line break as `"\n"` on CRLF and bare-CR documents, as markdownlint does, where it carried the document's own line ending. The kit `edit` is unchanged, so code that applies `edit` sees no difference; code that applies `fixInfo` itself should write each `\n` as the document's line ending, as markdownlint's `applyFix` does.

## Features

### The markdownlint 0.42 rule set

`@effected/markdown-lint/rules` exports all 53 built-in rules (`MD001` through `MD060`), one named export each. `@effected/markdown-lint/rules/all` exports `rules`, the full list, and `uncovered`, the built-ins not ported, which is empty.

Every markdownlint 0.42 rule has a port, so `rules` reports on the same document everything markdownlint does. The rules most documents trip are among the later additions: `MD007` and `MD029` for list indentation and numbering, `MD034` for bare URLs, `MD044` for proper names, `MD051` and `MD052` for fragment and reference links, `MD053` for unused definitions, and `MD055`, `MD056` and `MD058` for tables.

`LintReport` and the fix information a diagnostic carries gain an optional `deletesLine`, and `MarkdownLint.applyFixes` applies a whole-line deletion as markdownlint does. `MD053` uses it to remove an unused link reference definition.

### Configuration and inline comments

* `LintConfig` and `InlineDirectives` on the package root resolve markdownlint's configuration and its inline comments.
* `MarkdownLint.lint` and `lintDocument` accept `config` and `noInlineConfig`; `lintDocument` also accepts `dialect`, used when it re-reads the source.
* `LintContext.config` gives a rule its own settings, `LintDiagnostic.severity` reports the configured severity, and `PositionMapping.lineStart` returns a line's start offset.
* `MarkdownLint.applyFixes(source, findings)` applies findings' fixes to a source as markdownlint's `applyFixes` does.

### Configuration files

`MarkdownlintConfigFile.read` and `resolve`, with `MarkdownlintConfigError`, come from the new `@effected/markdown-lint/config` subpath. They read `.markdownlint.jsonc`, `.json`, `.yaml` and `.yml`, follow `extends`, and find the nearest file as markdownlint-cli2 does. They need `FileSystem` and `Path` in `R`; the package root never imports them.

## Bug Fixes

* `MD032`, `MD027` and the table rules end lists, paragraphs and tables at a directive line, as markdownlint does.
* `MD022`'s fix keeps a container's line prefix, `MD009` reads the line after indented code as markdownlint does, and `MD044` and `MD014` report on the last line of an unclosed fence.

## Dependencies

| Dependency      | Type       | Action | From | To          |
| :-------------- | :--------- | :----- | :--- | :---------- |
| @effected/jsonc | dependency | added  | —    | workspace:^ |
| @effected/yaml  | dependency | added  | —    | workspace:^ |

Both are used only by `./config`.
