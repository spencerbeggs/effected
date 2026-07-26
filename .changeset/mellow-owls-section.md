---
"@effected/markdown": minor
---

## Features

Added `DocumentSection`, a navigation projection over a parsed document's
root-level headings, with `MarkdownDocument.firstSection` and
`.sectionByHeading` finder methods. A section's `bodyRange` spans from the end
of its heading to the end of its (sub)section content, so the range can be
handed straight to the edit layer to splice a whole section. Heading-text
matching against `sectionByHeading` is exact against trimmed text, never a
substring match, so `"1.2.3"` cannot accidentally match a `## 1.2.30` heading.
