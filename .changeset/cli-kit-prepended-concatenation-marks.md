---
"@effected/cli-kit": patch
---

## Bug Fixes

* Display width counts a spacing prepended concatenation mark, such as ARABIC NUMBER SIGN (U+0600), as one visible column instead of zero, unless the grapheme after it is wide and takes the mark into its own cell. Columns, truncation and padding that contain these marks now line up with what a terminal draws, and agree with `string-width` 9 across every assigned code point.
