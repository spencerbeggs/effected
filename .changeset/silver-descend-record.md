---
"@effected/walker": minor
---

## Features

### `descend` gains an `onUnreadable: "record"` mode

`descend` accepts a new `onUnreadable: "record"` option, resolving to a `DescendResult` — the matched file paths plus the `cwd`-relative path of every mid-walk directory whose `readDirectory` failed for a reason other than `NotFound` — instead of failing the whole walk (`"fail"`, the default) or silently discarding the unreadable directory (`"skip"`). The walk base itself is reported as the empty string `""` when it is the unreadable directory (#629).

```ts
const result = yield* descend(pattern, { cwd, onUnreadable: "record" });
// result.matches, result.unreadable
```

Existing calls are unaffected: `descend` is now overloaded, and every call without `onUnreadable: "record"` still resolves to the plain match array it always did.

The two modes are discriminated by two separate options types rather than by a literal, and `DescendRecordOptions` is exported alongside `DescendOptions` for that reason. `"record"` is deliberately not a member of `DescendOptions`: if it were, a value widened to that type — annotated as such, or passed through a function taking it — would select the array-returning overload at compile time while the walk resolved a `DescendResult` at runtime, and every array method on that result would fail with no type error anywhere. The same narrowing applies to `CompileAndExpandOptions`, which extends it, so `compileAndExpand` cannot be handed `"record"` under its array contract either.
