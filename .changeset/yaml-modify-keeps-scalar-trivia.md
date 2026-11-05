---
"@effected/yaml": minor
---

## Breaking Changes

`modify` with `indent` or `indentSequences` (#1219) no longer re-lays out the whole document on a scalar edit. It splices the one region, so the scalar's comment and quote style survive. Callers who relied on the re-layout should call `YamlFormat.format` for it.
