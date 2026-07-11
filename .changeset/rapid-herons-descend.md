---
"@effected/jsonc": patch
---

## Performance

`Jsonc.parseTree` no longer degrades super-linearly with nesting depth. Tree construction previously re-validated every subtree per node, doubling cost per nesting level (roughly four seconds at depth 20 and effectively hanging past 25). The parser now builds nodes through a validation-free internal path it alone can reach, so parsing at the 256-level depth cap completes in milliseconds.

* Public `JsoncNode.make` / `new JsoncNode` behavior is unchanged — hand-built trees are still fully validated
* Regression tests pin deep (250-level) and wide (10,000-element) documents, plus structural equality between parser-built and `JsoncNode.make`-built nodes

## Refactoring

* The three bracket-balancing skip implementations (parser depth cap, modifier navigation, visitor depth cap) are consolidated into one internal `skipBalancedValue` helper, so recursion-hardening fixes now land in a single place
