---
"@effected/git": minor
---

## Features

### Wider `submoduleUpdate`

`Git.submoduleUpdate` now accepts the full flag family `git submodule update` supports:

```ts
yield* git.submoduleUpdate(cwd, {
	init: true,
	checkout: true, // override submodule.<name>.update = none
	remote: true, // track the remote branch tip, not the recorded sha
	fetch: false, // --no-fetch
	recursive: true,
	force: true,
});
```

### Config section removal and rename

Two new mutating `Git` methods round out `GitConfig` editing: `configRemoveSection` (`git config --remove-section <section>`) and `configRenameSection` (`git config --rename-section <old> <new>`). Both fail loud — matching `configUnset` — when the named section does not exist.

### `fetch`: verbatim refspecs and an `unshallow` mode

`Git.fetch`'s `ref` option now passes through **verbatim**, so it accepts a full refspec (`src:dst`, optionally `+`-prefixed) as well as a bare ref:

```ts
yield* git.fetch(cwd, { ref: "+refs/heads/main:refs/remotes/origin/main" });
```

This matters under a single-branch clone (`actions/checkout`'s default): a bare-ref fetch there only updates `FETCH_HEAD` and never creates the remote-tracking ref, so the `+src:dst` spelling is the only one that materializes `origin/main`.

`fetch` also gains an `unshallow` option (a distinct mode git rejects outside a shallow repository, and never alongside `depth`), and a new dedicated probe, `Git.isShallow`, to check first.

### `Git.mergeBaseOption`

A new `Git.mergeBaseOption(cwd, a, b)` sits beside `Git.mergeBase`. Two refs with no common ancestor exit non-zero either way; `mergeBase` keeps surfacing that as a loud `GitCommandError`, while `mergeBaseOption` degrades it to `Option.none()` for callers that want a probe answer instead of a failure. `Git.mergeBase` itself is unchanged.
