---
"@effected/markdown": patch
---

## Documentation

- Corrected the `RowContent` API docs. `make` passes an already-constructed class instance through a nested class-typed field by reference, whether or not the field is wrapped in a `Schema.Union`. The category unions behind the `children` fields of `TableRow`, `Table` and `List` exist to mirror mdast's content-model vocabulary, not for construction speed as the docs previously claimed.
