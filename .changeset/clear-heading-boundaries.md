---
"@effected/markdown": patch
---

## Performance

Reduced the work `MarkdownDocument.sections` performs when computing section boundaries by indexing root-level headings first and deriving boundaries from that index instead of rescanning non-heading root blocks for each section.

- Output stays identical: section ranges, ordering, heading matching behavior, and body spans are unchanged.
