---
"@effected/markdown": patch
---

## Bug Fixes

The upstream defect this package filed as [Effect-TS/effect#6491](https://github.com/Effect-TS/effect/issues/6491) is fixed in `effect@4.0.0-beta.101`, so a plain-object `position` literal is accepted by `make` again and promoted to real `Position` / `Point` instances:

```ts
Frontmatter.make({
  type: "frontmatter",
  format: "yaml",
  value: "a: 1",
  position: { start: { line: 1, column: 1, offset: 0 }, end: { line: 3, column: 4, offset: 12 } },
});
```

Through `beta.99` that threw, because `SchemaParser.recurDefaults` *replaced* the field's class-construction link with the default link rather than appending to it — while the type level still admitted the literal. No change was needed in this package; the tripwire test pinning the old behavior fired on the advance and is retired.

## Tests

The same fix means a nested class field's construction link now always runs, so `make` **re-constructs** a nested class value instead of passing it through by reference — `Text.make({ position: p }).position !== p`, structurally equal but a distinct instance. This holds for an explicit position and for the `Position.synthetic` default alike, and for fields with no constructor default at all, so it is `make`'s nested-field semantics rather than anything about the default.

`Position` is an immutable value class with structural equality, so identity was never the contract worth pinning:

- Synthesized-position tests now assert by value (`deepStrictEqual`) instead of by reference
- The explicit-position test additionally asserts the default did **not** win, which is the behavior it was really guarding

## Documentation

- The known-limitation notes in the package context file and design doc are replaced with the resolution, plus the re-construction consequence and the rule that positions are never asserted by identity
