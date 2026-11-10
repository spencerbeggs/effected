---
id: "0056"
title: "isAnyOf rejects keys that are not tags of the union, and Struct fields named after Object.prototype members need an own property"
kind: breaking
shows: typed
applies:
  effect: ">=4.1.3"
detect: ["\\.isAnyOf\\(", "(toString|valueOf|constructor|hasOwnProperty|toLocaleString|isPrototypeOf|propertyIsEnumerable):[[:space:]]*Schema\\.", "onBefore"]
---

This applies to code that uses `Schema.TaggedUnion` or `Schema.toTaggedUnion`, or a `Schema.Struct` whose field names collide with `Object.prototype`.

- **`isAnyOf` is now checked against the union's tags** (Effect-TS/effect#10355). A misspelled tag or a wide `string[]` is now a type error. Bound a generic key parameter by the union's tags (`<K extends Types.Tags<typeof Shape.Type>>` or `<K extends keyof typeof Shape.cases>`) instead of `<K extends string>`. For a tag list known only at runtime, use a plain predicate such as `(value) => names.includes(value._tag)`. Filtering the list down to the union's tags compiles, but its false branch then excludes every tag in the filtered type, even when the list is empty at runtime.
- **A declared field named after an `Object.prototype` member now needs an own property** (Effect-TS/effect#9612). `Schema.Struct({ toString: Schema.optionalKey(Schema.String) })` now accepts `{}`, where before the inherited `toString` function failed the field. A missing required field of that name now reports a missing key, even on an input with a custom prototype. Other field names keep inherited-property support. This is behavioural: only a test sees it.
- **`Schema.toFormatter`'s `onBefore` hook now receives type-side AST nodes**, without encoding transformations (Effect-TS/effect#10453). A hook that read encoding metadata or compared original AST identities must use the decoded nodes, or attach formatting with `Schema.overrideToFormatter`.

Check the installed `effect/Schema` `.d.ts`. Verify with your typecheck, then run the schema tests.
