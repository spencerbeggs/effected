---
"@effected/app": patch
---

## Documentation

### The wrapped-code-span cascade is documented where it misdirects

The effected plugin's `effect-api-extractor-bases` skill now explains that a single TSDoc code span wrapped across comment lines fans out into `tsdoc-escape-right-brace` and `tsdoc-malformed-inline-tag` warnings with declaration-relative line numbers — and that chasing those by escaping braces is the wrong fix, since a properly closed one-line span protects `{`/`}` as-is. Rejoin the one wrapped span and the whole fan collapses.
