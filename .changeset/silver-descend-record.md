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
