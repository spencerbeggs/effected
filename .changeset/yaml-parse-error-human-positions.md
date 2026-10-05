---
"@effected/yaml": patch
---

## Bug Fixes

- `YamlParseError.message` now renders each diagnostic's position 1-based (`line + 1:character + 1`), so a CLI printing the message shows the line and column a person counts in their editor. The structured `YamlDiagnostic` `line`/`character` fields are unchanged and remain 0-based per LSP convention.
- `YamlStyleConflictError.message` renders each candidate's first-seen position 1-based the same way; the structured `StyleVoteTally` fields remain 0-based.
