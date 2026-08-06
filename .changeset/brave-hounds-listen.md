---
"@effected/git": minor
---

## Features

Added a pure `GitConfig` document model: a lossless git-config parser and
serializer that round-trips arbitrary git-config text byte-for-byte and
supports surgical, comment- and formatting-preserving edits, failing typed
(`GitConfigParseError`, `GitConfigEditError`) instead of throwing.

```ts
import { GitConfig } from "@effected/git";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const config = yield* GitConfig.parse(text);
	const updated = yield* Effect.fromResult(config.set("user", undefined, "name", "Ada"));
	return updated.stringify();
});
```

Added `Gitmodules`, a typed read view over `.gitmodules` (`GitmodulesEntry`,
a `FromString` codec), with mutation helpers (`setUrl`, `setPath`,
`setBranch`, `setShallow`, `add`, `remove`, `rename`) that compile to
surgical `GitConfig` edits rather than hand-rolled text editing.

Added a submodule tier to `Git`: `submoduleStatus`, `submoduleInit`,
`submoduleDeinit`, `submoduleSync`, `submoduleSetUrl`, `submoduleSetBranch`,
`submoduleAbsorbgitdirs`, `submoduleForeach`.

Added worktree-state, branch and shallow-repo members: `reset`, `clean`,
`restore` (a fail-loud posture — no silent partial application), `branchCreate`
(now also drives `checkout -B` / `branch -f` via a `force` option),
`branchDelete`, `isShallow`, `fetchUnshallow`. `StatusEntry` gained
`toLine`/the static `format` helper for rendering porcelain-shaped status
output back out, with a `StatusRenderOptions` controlling the new-path
default.

Added a second tier of members: `lsRemote` with `LsRemoteEntry`
(`shortName`/`nearMatches` for suggesting the closest ref on a typo), the
remote tier (`remoteAdd`, `remoteRemove`, `remoteSetUrl`), the stash tier,
`branchList`, `tagCreate`, `tagDelete`, `tagList`, `forEachRef`, `revList`,
`commit`, `push`, `pull`, `configList`, `configGetAll`, `configUnset`,
`rm`, `mv`, `checkIgnore`, the worktree tier (`worktreeAdd`, `worktreeList`,
`worktreeRemove`), and `lsFiles`. `Git` grew from 26 to 69 members.

Three new typed errors, added only alongside the new members that can raise
them — no existing member's error union changed: `NonFastForwardError` from
`push`, and `MergeConflictError` / `DirtyWorktreeError` from `pull`,
`stashPop` and `stashApply`.

## Breaking Changes

Every `GitCommand` constructor now returns a `GitInvocation` — the spawnable
command plus `redactedArgs`, the same argv with sensitive positionals
masked (a `configSet` value is masked wholesale; a URL's embedded
`userinfo@` is stripped) — instead of a bare command value. `GitCommandError`
now carries `redactedArgs` in `args`, and renders them in `message`, so raw
argv never reaches an error value. This only affects direct consumers of
`GitCommand`'s constructors; the `Git` service surface is unaffected.

```ts
import { GitCommand } from "@effected/git";

const { command, redactedArgs } = GitCommand.configSet("user.email", "secret@example.com");
```
