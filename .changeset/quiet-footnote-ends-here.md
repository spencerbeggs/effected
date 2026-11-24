---
"@effected/markdown": patch
---

## Bug Fixes

* A GFM footnote definition's position now ends at its last child, or just past the `[^label]:` marker when it has none, instead of running on through the blank line that closed it.
