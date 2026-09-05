---
"@effected/markdown": patch
---

## Bug Fixes

- `Markdown.stringify` emits a plain newline for a soft line break that sits at the boundary of a text node, next to inline code, emphasis, strong or a link, instead of `&#10;`. The entity is kept only where a bare newline would end the paragraph: beside another newline, or at a fresh line start. `parse ∘ stringify` now round-trips wrapped prose beside code spans byte-for-byte.
