---
"@effected/markdown": patch
---

## Bug Fixes

- `MarkdownParseError.message` now renders the diagnostic's position 1-based (`line + 1:character + 1`), so a CLI printing the message shows the line and column a person counts in their editor. The structured `MarkdownDiagnostic` `line`/`character` fields are unchanged and remain 0-based per LSP convention.
