---
"@effected/git": minor
---

## Features

### Relative-mode diffs and a working-tree change query

`Git.changedFiles` now accepts a `relative` option: pass `relative: true` and paths come back relative to `cwd` instead of the repository top level, with changes outside that subtree excluded. This is what a workspace nested inside a larger git repository needs — without it, a `git diff` reports repository-top-level paths that resolve to nothing under the workspace root.

A new `workingChanges` method reads the working tree directly: the deduplicated union of unstaged, staged and untracked paths, also with a `relative` option. It never fails with `UnknownRefError`, since no ref is involved.

```ts
import { Effect, Layer } from "effect";
import { NodeServices } from "@effect/platform-node";
import { Git } from "@effected/git";

const AppLayer = Git.layer.pipe(Layer.provideMerge(NodeServices.layer));

const program = Effect.gen(function* () {
	const git = yield* Git;
	const committed = yield* git.changedFiles(process.cwd(), { base: "main", head: "HEAD", relative: true });
	const pending = yield* git.workingChanges(process.cwd(), { relative: true });
	return [...new Set([...committed, ...pending])];
});

Effect.runPromise(program.pipe(Effect.provide(AppLayer)));
```

`GitCommand` gains three pure constructors backing these: `unstagedChanges`, `stagedChanges` and `untrackedFiles`, each taking the same `relative` flag, for callers who want to build the `ChildProcess.StandardCommand` themselves without going through the `Git` service.
