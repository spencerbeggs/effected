# `Schema.optional` is not exact-optional

Under `exactOptionalPropertyTypes: true` the two optionality combinators differ
in exactly the way that setting cares about:

```ts
Schema.optional(Schema.String)      // field?: string | undefined  — { field: undefined } is LEGAL
Schema.optionalKey(Schema.String)   // field?: string             — { field: undefined } is TS2375
```

The mechanism is in the vendored source — `optional` is `optionalKey` widened
with `UndefinedOr`:

```ts
// Schema.ts:2472 — the docstring at Schema.ts:2449 reads "Equivalent to `optionalKey(UndefinedOr(S))`"
export const optional: optionalLambda = Struct_.lambda<optionalLambda>((self) => {
  const schema = UndefinedOr(self)
  return make(SchemaAST.optional(self.ast), { schema })
})
```

**The trap is that `Schema.optional` reads like the neutral default and
compiles clean.** Nothing fails; the schema simply admits a present-but-
`undefined` key forever after. A partial-merge patch schema
(`{ name, url?, path?, sha? }`) built with `Schema.optional` type-checks, and
`{ name: "a", url: undefined }` still compiles — violating the "omitted fields
are absent" invariant a patch depends on. Only review catches it.

Probed (control: `Schema.optionalElement` → TS2339, harness live):

```text
optional    + explicit undefined -> compiles (no error)          <-- the bug
optionalKey + explicit undefined -> TS2375 ... with 'exactOptionalPropertyTypes: true'
```

`optionalKey` also lowers cleaner: the field is absent from `required` in the
derived JSON Schema, with no `undefined`/`null` sentinel in the type. Reach for
`Schema.optional` **only** when the value genuinely must carry `undefined` as a
distinct inhabitant — not merely because the field is optional.
