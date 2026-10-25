---
"@effected/yaml": patch
---

## Refactoring

- Rebuilt instances are now created by spreading the original, so a field added later cannot be dropped silently. Behaviour is unchanged.
