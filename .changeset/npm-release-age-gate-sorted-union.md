---
"@effected/npm": minor
---

## Breaking Changes

### `ReleaseAgeGate.combine` returns a sorted exclude union

The combined gate previously preserved the order in which exclude patterns were contributed. It now returns them deduplicated and lexicographically sorted, so the union is a canonical value that does not depend on the order the contributions arrived in.

Assertions written against an insertion-ordered union need updating:

```ts
const combined = ReleaseAgeGate.combine({ exclude: ["c", "b"] }, { exclude: ["b", "a"] });

// before — order followed the contributions
assert.deepStrictEqual(combined.exclude, ["c", "b", "a"]);

// after — canonical order, whichever way the gates were combined
assert.deepStrictEqual(combined.exclude, ["a", "b", "c"]);
```

Consumers that only call `isExcluded` or `filterVersions` are unaffected.
