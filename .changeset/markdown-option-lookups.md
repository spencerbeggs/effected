---
"@effected/markdown": minor
---

## Breaking Changes

### Lookups return `Option`

`MarkdownDocument.frontmatter` returns `Option<Frontmatter>`, `firstSection` and `sectionByHeading` return `Option<DocumentSection>`, and every `find` overload returns `Option`. They used to return the value or `undefined`.

**Migration:** replace `undefined` checks with `Option.isSome`, `Option.match` or `Option.getOrUndefined`.

## Features

- `MarkdownVisitor.walk(root)` returns a synchronous `Iterable<MarkdownVisitorEvent>`. `visit` is now built from it and behaves as before.
