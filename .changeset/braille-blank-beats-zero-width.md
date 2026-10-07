---
"@effected/github-commands": minor
---

## Bug Fixes

### Security: neutralized workflow commands were still executed by the runner

`CommandNeutralizer` marked a neutralized line with a zero-width space (U+200B). The GitHub Actions runner matches `::` and `##[` with ICU culture-sensitive comparisons, which skip zero-width and other ignorable characters, so a line neutralized that way was still parsed as a workflow command. Text that was meant to be inert, such as an error message or a document body, could inject `::add-mask::`, `::error::` or `##[error]` in every earlier release. Treat any release that neutralizes with U+200B as affected, and upgrade.

- The marker is now U+2800 BRAILLE PATTERN BLANK. The runner does not trim it, ICU gives it a weight of its own so `::` and `##[` no longer match across it, and renderers that drop ignorable characters keep it.
- Detection now sees through the full set of code points ICU ignores: controls, format characters, combining marks, variation selectors and tag characters. A line such as `":​:add-mask::x"` is neutralized.
- Text that already carries a U+200B in front of a command is neutralized again, so output stored by an earlier release is made safe on its next pass.
- Neutralization stays idempotent, and a bare `##` heading is still left alone.

## Breaking Changes

Neutralized text now carries U+2800, which draws as one blank column, where it used to carry an invisible zero-width space. Output is one column wider per marker (one for a line that starts with `::`, plus one for each `##[` in it), and anything that compared against the old U+200B marker must expect U+2800.
