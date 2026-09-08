---
"@effected/yaml": minor
---

## Bug Fixes

### `YamlFormat.modify` recursively lowers object and array values

`modify` used to lower only scalar-compatible values into AST nodes; a mapping or sequence value fell through to the node stringifier's `String(value)` fallback and silently corrupted the document with the literal text `[object Object]`. `modify` now lowers a whole object graph the same way `Yaml.stringify` does — an array becomes a block sequence and any other non-null object a block mapping over its own enumerable string keys — so the two agree on what a given JavaScript value means (#642).

A replacement value with no finite rendering fails typed instead of hanging or overflowing the stack: a circular reference raises `YamlModifyErrorCode.CircularReference`, and a graph nested more than 256 levels deep raises `NestingDepthExceeded`. `YamlModifyErrorCode` gains these two members.

### Block-collection spans no longer swallow a disowned trailing comment

A block map or sequence's reported `offset`/`length` used to run past a floating comment at a shallower indent that the comment model had already reattributed to an enclosing scope — so a caller splicing text at the end of the collection (via `findAtOffset` or similar) inserted after that comment instead of before it. The span now stops where the comment model says the collection actually ends, which shrinks the observable `offset`/`length` on any document with this shape (#643).
