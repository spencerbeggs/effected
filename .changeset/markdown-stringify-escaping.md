---
"@effected/markdown": minor
---

## Features

### Minimal inline escaping in `Markdown.stringify`

Inline text now escapes `_`, `&`, `>` and a heading's `#` only where CommonMark would actually treat them as markup, so `parse ∘ stringify` is the identity on ordinary prose. Consumers asserting on stringified bytes that contained these escapes need to update their expectations.

* `_` stays raw between two Unicode alphanumerics (`DEFAULT_PIPELINE_OPTIONS`, `snake_case`); at a word edge or beside punctuation it still escapes
* `&` stays raw unless the text that follows is entity-shaped (`Getters & Setters`, `Q&A`, `AT&T;` are raw; a literal `&amp;` or `&#123;` still escapes)
* `>` escapes only at a line start, where it would open a blockquote (`a > b` and `<T>` no longer pay a `\>`)
* `#` inside a heading escapes only when it heads a closing-sequence run (`Issue #12` and the VitePress anchor form `Setters {#setters}` are raw; `Trailing #` still escapes)
* A setext heading whose text starts with a line-start construct (`-`, `+`, `#`, `=`, `1.`) now receives the line-start escape it always needed

## Tests

* New `parse ∘ stringify` identity suite pinning every rule above, including the string identities `# A_B\n` and `Getters & Setters\n`
