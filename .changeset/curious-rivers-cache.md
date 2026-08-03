---
"@effected/github-actions": minor
---

## Features

### `GitHubContext.headRef` and `branch`

`GitHubContext` now carries `headRef`, the pull request's source branch as an
`Option<string>`. `GITHUB_HEAD_REF` is only set for `pull_request` events, and
on every other event the runner may write it as the **empty string** rather
than omitting it — both spellings of absence now decode to `Option.none()`,
so a consumer can't build a cache key segment out of an empty branch name by
accident.

The new `branch` getter owns the fallback chain every consumer used to
hand-roll: `headRef` when present (a pull request, where `refName` is the
useless `123/merge`), otherwise `refName`.

```ts
import { GitHubContext } from "@effected/github-actions";

const branch = context.branch; // headRef, or refName when absent
```

### `CacheKey.digest`

`CacheKey.digest(input, length = 8)` is a segment-safe short digest for
**non-file** key inputs — a sorted version list, a branch name — replacing
the by-hand SHA-256-and-truncate every compound key used to repeat. The
result is lowercase hex, guaranteed nonempty and free of the characters the
restore-key protocol reserves, so it drops straight into `CacheKey.of` with
nothing to check at the call site. A `length` outside `1..64` throws a
`RangeError` rather than silently answering fewer characters than asked for.

```ts
import { CacheKey } from "@effected/github-actions";

const key = CacheKey.of(
	"Linux",
	CacheKey.digest("node:24.4.0,pnpm:10.13.1"),
	CacheKey.digest("feat/my-branch"),
);
```

### `ChildEnv`

A new zero-import module for building the environment additions a spawned
child process needs to see prepended `PATH` entries, without the three traps
that cost a cross-OS matrix round each: `prependPath(dirs, { base, platform })`
answers `{ env, extendEnv: true }` as one value (a bare `env` silently
replaces the child's whole environment), writes through the inherited `PATH`
key's own casing (Windows spells it `Path`), and appends nothing for an
absent inherited value. `needsShell(platform)` reports the win32 rule for
`.cmd` shims required since CVE-2024-27980.

```ts
import { ChildEnv } from "@effected/github-actions";
import { ChildProcess } from "effect/unstable/process";

const command = ChildProcess.make("pnpm", ["install"], {
	...ChildEnv.prependPath(["/opt/hostedtoolcache/pnpm/10.13.1/x64/bin"], {
		base: process.env,
		platform: process.platform,
	}),
	...(ChildEnv.needsShell(process.platform) ? { shell: true } : {}),
});
```
