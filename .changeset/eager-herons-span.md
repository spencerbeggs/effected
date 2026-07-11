---
"@effected/yaml": patch
---

## Bug Fixes

* Anchor and alias token spans now cover the leading `&`/`*` sigil. `YamlAlias` nodes previously reported a span one character short, so `YamlNode.findAtOffset` missed the last character of an alias name.
* Folded multi-line plain scalars now span the full folded value instead of only the first line fragment, in block-map value position, block-seq entries and flow collections. `YamlNode.findAtOffset` resolves characters on continuation lines, and the nodes carry `sourceMultiline: true` like block and flow collections already did.
