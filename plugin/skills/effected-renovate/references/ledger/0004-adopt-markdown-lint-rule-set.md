---
id: "0004"
title: "@effected/markdown-lint: a markdownlint rule set, configuration and a config-file reader"
kind: adopt
shows: none
applies:
  "@effected/markdown-lint": ">=0.3.0"
detect: ["markdownlint-cli2", "markdownlint/(sync|async|promise)", "\\.markdownlint(-cli2)?\\.(jsonc|json|yaml|yml|cjs|mjs)"]
changesets: ["bright-lint-rules-ship"]
---

The package can now lint markdown style without markdownlint installed. Offer this where a tool shells out to `markdownlint-cli2` or imports `markdownlint` to lint files it already parses with the kit; do not apply it unasked.

- `@effected/markdown-lint/rules` exports 22 of markdownlint's built-in rules, one named export each, differentially tested against markdownlint 0.42. `@effected/markdown-lint/rules/all` exports `rules`, the whole list in markdownlint's order, and `uncovered`, the names of the built-in rules not ported. Report `uncovered` to the user rather than implying full coverage. Import single rules from `./rules` when you need a few: `./rules/all` pulls in every rule.
- `LintConfig` on the package root is markdownlint's configuration object. Pass one as `config` to `MarkdownLint.lint`; rule names, aliases and tags, `default`, per-rule settings and `"error"` / `"warning"` severities resolve as markdownlint resolves them.
- `MarkdownLint.applyFixes(source, findings)` applies fixes with markdownlint's own policy. Use it instead of applying the edits yourself.
- `@effected/markdown-lint/config` exports `MarkdownlintConfigFile`. `read` loads one `.markdownlint.jsonc`, `.json`, `.yaml` or `.yml` and follows `extends`; `resolve` finds the nearest one above a file. Both need `FileSystem` and `Path` and fail with a typed `MarkdownlintConfigError`.

The target is markdownlint's own configuration, not markdownlint-cli2's. A `.markdownlint-cli2.*` file is not read, and JavaScript config files are not executed. Before adopting, move the `config` block of a cli2 file into a `.markdownlint.jsonc`; globs, ignores, `overrides` and custom-rule module loading stay with the calling tool. A few named differences from markdownlint remain; the `effected-packages` skill's `markdown-lint` reference lists them.
