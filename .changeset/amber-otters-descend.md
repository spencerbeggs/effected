---
"@effected/walker": minor
---

## Features

### Downward glob expansion — `descend`

`@effected/walker` gains a second traversal primitive alongside the upward `Walker`: `descend(pattern, options)` expands a compiled `@effected/glob` `GlobPattern` under `options.cwd` and returns the matching file paths (POSIX-separated, relative to `cwd`, sorted).

```ts
import { descend } from "@effected/walker";
import { GlobPattern } from "@effected/glob";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const pattern = yield* GlobPattern.compile("src/**/*.ts");
	return yield* descend(pattern, { cwd: "/repo" });
});
```

`DescendOptions` accepts `maxDepth` (default `256`), `prune` (directory names never descended into; defaults to `["node_modules", ".git"]`), and `onUnreadable` (`"fail"` by default, or `"skip"` to absorb an unreadable directory instead of failing).

The walker is semantics-free — dotfile handling, case folding and every other matching option live on the compiled pattern, not on `descend` itself. Only files match; a symlinked directory is never descended into. An unreadable directory mid-walk or a walk past `maxDepth` fails typed as the new `DescendError`, distinct from the upward walker's per-candidate absorption: a swallowed subtree in a downward enumeration would silently understate membership, so the default is to fail rather than degrade.

This adds a new peer dependency on `@effected/glob` (type-only: `descend` imports `GlobPattern` as a type and calls its `matches()` method).
