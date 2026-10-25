---
"@effected/github-actions": patch
---

## Refactoring

* Exports that carry statics now declare real signatures instead of `typeof` the local value, so the published declarations and API docs show them. There is no runtime or call-shape change.
