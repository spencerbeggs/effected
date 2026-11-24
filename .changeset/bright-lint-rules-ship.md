---
"@effected/markdown-lint": minor
---

## Breaking Changes

* Inline `markdownlint-*` comments are honoured by default, so a document carrying a disable comment now suppresses findings it did not before. Pass `noInlineConfig: true` to `MarkdownLint.lint` or `lintDocument` for the old behaviour.
* The host reads a file as markdownlint does: HTML comment bodies are masked in `LintContext.source`, front matter follows markdownlint's own pattern, and a `---json` block is content rather than front matter.
* `LintFrontmatter.node` is now an `Option`.
* `LintDiagnostic` carries a required `severity` (`"error"` or `"warning"`), stamped from the configuration.
* `MarkdownlintAdapter` passes markdownlint's `params.config` to the rule as `LintContext.config`, with `enabled` and `severity` removed.
* `lintDocument` drops one leading byte-order mark and re-parses the source when its reading and the parse it was given are not aligned.

## Features

### The markdownlint 0.42 rule set

`@effected/markdown-lint/rules` exports 22 built-in rules (`MD001` through `MD060`), one named export each. `@effected/markdown-lint/rules/all` exports `rules`, the full list, and `uncovered`, the built-ins not ported.

### Configuration and inline comments

* `LintConfig` and `InlineDirectives` on the package root resolve markdownlint's configuration and its inline comments.
* `MarkdownLint.lint` and `lintDocument` accept `config` and `noInlineConfig`; `lintDocument` also accepts `dialect`, used when it re-reads the source.
* `LintContext.config` gives a rule its own settings, `LintDiagnostic.severity` reports the configured severity, and `PositionMapping.lineStart` returns a line's start offset.
* `MarkdownLint.applyFixes(source, findings)` applies findings' fixes to a source as markdownlint's `applyFixes` does.

### Configuration files

`MarkdownlintConfigFile.read` and `resolve`, with `MarkdownlintConfigError`, come from the new `@effected/markdown-lint/config` subpath. They read `.markdownlint.jsonc`, `.json`, `.yaml` and `.yml`, follow `extends`, and find the nearest file as markdownlint-cli2 does. They need `FileSystem` and `Path` in `R`; the package root never imports them.

## Dependencies

| Dependency      | Type       | Action | From | To          |
| :-------------- | :--------- | :----- | :--- | :---------- |
| @effected/jsonc | dependency | added  | —    | workspace:^ |
| @effected/yaml  | dependency | added  | —    | workspace:^ |

Both are used only by `./config`.
