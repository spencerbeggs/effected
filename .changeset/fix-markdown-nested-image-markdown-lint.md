---
"@effected/markdown-lint": patch
---

## Bug Fixes

* Images nested in one another's labels lint in linear time. Each nesting level's label was re-parsed with every level inside it, so a deep chain cost quadratic time under the rules that read image labels (MD049 and MD052 among them: about 11 s at 8,000 levels). Each level now re-parses only its own characters, reading the nested images from `@effected/markdown`'s image descriptions. A label holding a `$` is still re-read whole, because inline math can cross its brackets.
* Findings on nested image labels match markdownlint where they did not before: a label holding a `]` in a code span now ends where micromark ends it, and so does a nested image whose title holds a `]`. These are MD052, MD053 and MD054 references, and MD039 and MD042 links.
