---
"@effected/jsonc": minor
---

## Breaking Changes

### `JsoncModifier.modify` fails typed on unserializable values

The error channel of `JsoncModifier.modify` widens from `JsoncModificationError` to `JsoncModificationError | JsoncStringifyError`. Circular and `bigint` values, and a function or symbol at the root or at an existing key, used to die as defects and now fail with `JsoncStringifyError`, which carries no path.

**Migration:** an exhaustive match over the modify error needs a `JsoncStringifyError` arm.

## Bug Fixes

- Inserting a function or symbol value used to report success while writing the invalid text `"key": undefined`. It now fails with `JsoncStringifyError` and leaves the text unchanged.
