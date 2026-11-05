---
"@effected/markdown": minor
---

## Features

* `MarkdownDocument.headingSlugs` (#1188) returns the GitHub-style anchor slug of every heading, parallel to the document's headings. Repeats are deduplicated the way `github-slugger` does it (`-1`, `-2`, …).
* `MarkdownDocument.slug` slugs a single heading text, undeduplicated. Parity is with `github-slugger`, not with GitHub itself.
