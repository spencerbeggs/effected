---
"@effected/git": minor
---

## Features

`Git` grew from 8 to 25 service methods, closing [#82](https://github.com/spencerbeggs/effected/issues/82).

### Expanded read tier

- `nameStatus(cwd, { base, head?, relative? })` — each changed path typed as added, modified, deleted, renamed, copied, and more, with `oldPath` carried on renames. Omit `head` to diff the working tree against `base`; supply it to diff a `base...head` range.
- `unstagedChanges`, `stagedChanges`, and `untrackedFiles` are now first-class service methods (previously internal to `workingChanges`). `workingChanges` now composes them, and its `options` parameter is optional.
- `lsTree(cwd, ref, { pathspec? })` gained an optional pathspec to scope the listing.
- `defaultBranch`, `currentBranch`, `configGet`, and `remoteUrl` are new `Option`-answering probes. An unset remote `HEAD`, a detached `HEAD`, or a missing config key/remote all degrade to `Option.none()` rather than an error.
- `repoRoot(cwd)` returns the absolute repository root path.
- `commitInfo(cwd, ref?)` returns a commit's sha, `%G?` signature verdict, and raw message as a new `CommitInfo` model.
- `status(cwd)` returns the working tree's porcelain status listing as `StatusEntry` values.

### New mutating tier

`checkout` gained a `detach` option, and six new mutating methods join it: `fetch`, `submoduleUpdate`, `submoduleAdd`, `sparseCheckoutSet`, `configSet`, and `add`. Every mutating method's TSDoc opens with "Mutating:" — nothing in the package serializes concurrent access, so a caller running two mutating calls (or a mutating call alongside a read) against the same `cwd` at once owns the race.

```ts
import { Git } from "@effected/git";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";

const program = Effect.gen(function* () {
  const git = yield* Git;
  yield* git.fetch("/repo", { ref: "main" });
  yield* git.checkout("/repo", "main");
  const info = yield* git.commitInfo("/repo");
  return info.sha;
});

const GitLive = Git.layer.pipe(Layer.provide(NodeServices.layer));
Effect.runPromise(program.pipe(Effect.provide(GitLive)));
```

`fetch`, `submoduleUpdate`, and `submoduleAdd` classify git's "couldn't find remote ref" stderr as `UnknownRefError` — the typed signal a tag-then-branch fetch fallback (`Effect.orElse`) can branch on. `configSet` refuses a leading-dash value on `key`, `value`, or `options.file` rather than risk git reading it as a flag; a legitimate config value starting with `-` cannot be written through this method.

### New exported models

`NameStatusEntry`, `CommitInfo`, and `StatusEntry` join `LsTreeEntry` as exported parsed-result models.

All changes are additive and non-breaking.
