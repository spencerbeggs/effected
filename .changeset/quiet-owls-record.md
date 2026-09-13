---
"@effected/walker": minor
---

## Breaking Changes

### `descend`'s `onUnreadable: "record"` overload now carries the cause of each unreadable directory

`DescendResult.unreadable` was `ReadonlyArray<string>`. It is now `ReadonlyArray<UnreadableDirectory>`, where `UnreadableDirectory` is `{ path: string; cause: PlatformError.PlatformError }` — the `readDirectory` failure the walk absorbed now travels with the entry, so a caller reporting why a directory was unreadable no longer needs a second syscall.

Migrate a path-based check to match on the new shape's `path` field:

```ts
// before
if (result.unreadable.includes("")) { ... }

// after
if (result.unreadable.some((u) => u.path === "")) { ... }
```

The walk base still records as `path: ""` when it is itself unreadable, and a `NotFound` mid-walk is still never recorded — both unchanged from before.

## Features

- New export `UnreadableDirectory`.

Closes #648.
