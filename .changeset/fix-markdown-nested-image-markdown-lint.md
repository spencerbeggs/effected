---
"@effected/markdown-lint": patch
---

## Bug Fixes

* Images nested in one another's labels lint in linear time. Each nesting level's label was re-parsed with every level inside it, so a deep chain cost quadratic time under the rules that read image labels (MD049 and MD052 among them: about 11 s at 8,000 levels). Each level now re-parses only its own characters, reading the nested images from `@effected/markdown`'s image descriptions, and its findings are unchanged.
