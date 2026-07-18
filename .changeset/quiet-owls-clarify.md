---
"@effected/yaml": patch
---

## Documentation

- Clarify that `lineWidth` scalar folding is a value-path-only feature:
  `Yaml.stringify`/`Yaml.stringifySync` honor it, while `YamlDocument#stringify`
  and the `YamlFormat` helpers accept the option but never fold — callers
  needing folded output on that path should render the plain value instead
  (`Yaml.stringify(doc.toValue(), options)`).
- Fixed two `{@link Result}` cross-package references that produced
  `ae-unresolved-link` warnings in the production build; the package now
  builds warning-free.
