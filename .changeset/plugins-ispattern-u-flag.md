---
"@effected/claude-code-plugin": patch
"@effected/copilot-plugin": patch
---

## Documentation

The schema and testing skills now tell agents to write every `Schema.isPattern` regular expression with the `u` flag, and never lookaround or the `i`, `m` or `v` flags. Without `u`, the JSON Schema export silently drops the pattern, and the earlier "flag-free" advice led agents to remove exactly the flag that keeps it.
