# A `SchemaIssue` as `{ code, path, message }` diagnostics

`SchemaIssue.makeFormatterStandardSchemaV1()` returns `{ message, path }` per
failure and no code. For a diagnostic-code surface, walk the issue tree
(`Issue` is `Leaf | Filter | Encoding | Pointer | Composite | AnyOf`,
`SchemaIssue.ts:147`), accumulate `Pointer` paths, and take the node's `_tag` as
the code, with `makeFormatterDefault()` for the message:

```ts
import { SchemaIssue } from "effect"

interface Diagnostic {
  readonly code: string
  readonly path: ReadonlyArray<PropertyKey>
  readonly message: string
}

const format = SchemaIssue.makeFormatterDefault()
const diagnostics = (issue: SchemaIssue.Issue, path: ReadonlyArray<PropertyKey> = []): Array<Diagnostic> => {
  switch (issue._tag) {
    case "Encoding":
      return diagnostics(issue.issue, path)
    case "Pointer":
      return diagnostics(issue.issue, [...path, ...issue.path])
    case "Composite":
      return issue.issues.flatMap((child) => diagnostics(child, path))
    case "AnyOf":
      if (issue.issues.length > 0) return issue.issues.flatMap((child) => diagnostics(child, path))
      return [{ code: issue._tag, path, message: format(issue) }]
    default:
      return [{ code: issue._tag, path, message: format(issue) }]
  }
}
```

Probed with `{ errors: "all" }` on `Struct({ name: NonEmptyString, age: Number, tags: Array(String) })`
against `{ name: "", age: "x", tags: [1] }`: `Filter` at `["name"]`
("Expected a value with a length of at least 1"), `InvalidType` at `["age"]` and
at `["tags", 0]`, and `MissingKey` at `["name"]` for a missing key; path and
message match the Standard Schema formatter's. A failed check reports as
`Filter`, so a code per check needs your own mapping.
