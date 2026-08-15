# @effected/git

## 0.8.0

### Features

* ### Wider `submoduleUpdate`

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

  A new `Git.mergeBaseOption(cwd, a, b)` sits beside `Git.mergeBase`. Two refs with no common ancestor exit non-zero either way; `mergeBase` keeps surfacing that as a loud `GitCommandError`, while `mergeBaseOption` degrades it to `Option.none()` for callers that want a probe answer instead of a failure. `Git.mergeBase` itself is unchanged. [#366][#366]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#366]: https://github.com/spencerbeggs/effected/pull/366

## 0.7.0

### Bug Fixes

* Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

* Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
* Updated `Gitmodules`' internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

* | Dependency | Type           | Action  | From           | To             |
  | :--------- | :------------- | :------ | :------------- | :------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.6.0

### Breaking Changes

* Every `GitCommand` constructor now returns a `GitInvocation` — the spawnable
  command plus `redactedArgs`, the same argv with sensitive positionals
  masked (a `configSet` value is masked wholesale; a URL's embedded
  `userinfo@` is stripped) — instead of a bare command value. `GitCommandError`
  now carries `redactedArgs` in `args`, and renders them in `message`, so raw
  argv never reaches an error value. This only affects direct consumers of
  `GitCommand`'s constructors; the `Git` service surface is unaffected.

  ````ts
  import { GitCommand } from "@effected/git";

  const { command, redactedArgs } = GitCommand.configSet("user.email", "secret@example.com");
  ``` [#295](https://github.com/spencerbeggs/effected/pull/295) Thanks [@spencerbeggs](https://github.com/spencerbeggs)!
  ````

### Features

* Added a pure `GitConfig` document model: a lossless git-config parser and
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

## 0.5.2

### Maintenance

* Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.5.1

### Refactoring

* `GitCommand` is now a static class with a private constructor rather than an
  `as const` namespace object. Call syntax is unchanged (`GitCommand.show(...)`);
  each member's TSDoc now ships in the built `.d.ts`, where an `as const`
  object's inferred member types previously dropped it. [#180][#180]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

## 0.5.0

### Features

* ### `Git.makeTest` and `Git.layerTest`

  Testing anything git-backed previously meant constructing all 26 methods of the service by hand, so a test that scripted two of them carried 24 lines of stubs that existed only to satisfy the interface — and every one of them broke whenever the service gained a method.

  The sanctioned double supplies overrides per method:

  ```ts
  const layer = Git.layerTest({
    show: () => Effect.succeed("file contents"),
    lsTree: () => Effect.succeed([]),
  });
  ```

  Anything not overridden dies with a named message identifying the method, so a test still proves that nothing else was touched. The TSDoc records what the double deliberately does not model — stderr classification, the option-injection guard, and the spawn environment all stay with the real layer. [#175][#175]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#175]: https://github.com/spencerbeggs/effected/pull/175

## 0.4.2

### Dependencies

* | Dependency | Type           | Action  | From          | To             |                                                                       |
  | ---------- | -------------- | ------- | ------------- | -------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.4.1

### Dependencies

* | Dependency | Type           | Action  | From          | To            |                                                                       |
  | ---------- | -------------- | ------- | ------------- | ------------- | --------------------------------------------------------------------- |
  | effect     | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.4.0

### Features

* `GitCommandError` now carries a `kind` discriminant that separates a pre-spawn guard rejection from a genuine git failure. `"refused"` means a pre-spawn guard (an option-like ref) rejected the invocation before any process spawned; `"failed"` means git actually ran and exited non-zero, or the spawn itself failed. Composed retry and fallback logic can route on the discriminant instead of parsing the `detail` prose.

  * `Git.fetchAny` drops its duplicated up-front guard and short-circuits a refused ref by routing on `error.kind === "refused"`, with identical behavior [#106][#106]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#106]: https://github.com/spencerbeggs/effected/pull/106

## 0.3.0

### Features

* ### `Git.fetchAny` — fetch a ref without knowing whether it's a tag

  `Git.fetchAny(cwd, { ref, remote?, depth? })` fetches a ref that might be a tag or a branch without the caller needing to know which. It tries the tag form first (`git fetch [--depth <n>] <remote> tag <ref>`), and falls back to the plain form (`git fetch [--depth <n>] <remote> <ref>`) when the tag attempt fails with `UnknownRefError` or any `GitCommandError`. A `NotARepositoryError` from the tag attempt propagates immediately rather than retrying. When both attempts fail, the plain fetch's error is the one surfaced.

  ```ts
  import { Git } from "@effected/git";
  import { Effect } from "effect";

  const program = Effect.gen(function* () {
  	const git = yield* Git;
  	yield* git.fetchAny("/repo", { ref: "v1.2.3" });
  });
  ```

  ### `GitShape` is now exported

  The `Git` service's interface is exported as `GitShape`, so a consumer can type a variable, field or test fake holding the service without re-declaring the surface: `Layer.succeed(Git, fake)` accepts any `GitShape`.

### Documentation

* `NameStatusEntry.status` decodes git's one-letter diff codes using this package's own spelling — notably `"typeChanged"` and `"broken"`, not porcelain's `"typechange"` — now called out explicitly in the TSDoc for consumers mapping onto an existing enum that follows porcelain's spelling. [#91][#91]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

## 0.2.0

### Features

* `Git` grew from 8 to 25 service methods, closing [#82][#82].

  ### Expanded read tier

  * `nameStatus(cwd, { base, head?, relative? })` — each changed path typed as added, modified, deleted, renamed, copied, and more, with `oldPath` carried on renames. Omit `head` to diff the working tree against `base`; supply it to diff a `base...head` range.
  * `unstagedChanges`, `stagedChanges`, and `untrackedFiles` are now first-class service methods (previously internal to `workingChanges`). `workingChanges` now composes them, and its `options` parameter is optional.
  * `lsTree(cwd, ref, { pathspec? })` gained an optional pathspec to scope the listing.
  * `defaultBranch`, `currentBranch`, `configGet`, and `remoteUrl` are new `Option`-answering probes. An unset remote `HEAD`, a detached `HEAD`, or a missing config key/remote all degrade to `Option.none()` rather than an error.
  * `repoRoot(cwd)` returns the absolute repository root path.
  * `commitInfo(cwd, ref?)` returns a commit's sha, `%G?` signature verdict, and raw message as a new `CommitInfo` model.
  * `status(cwd)` returns the working tree's porcelain status listing as `StatusEntry` values.

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

  All changes are additive and non-breaking. [#85][#85]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#82]: https://github.com/spencerbeggs/effected/issues/82

[#85]: https://github.com/spencerbeggs/effected/pull/85

## 0.1.0

### Features

* Initial release: typed git introspection as an Effect service. Read a repository's state at any ref without checking it out, plus `checkout` — the one deliberately-marked mutation. Subprocesses run through Effect core's `ChildProcessSpawner` contract, required in `R` and provided once at the edge, so the package has zero runtime dependencies and zero `node:` imports.

  ### Reading repository state

  `Git.show` reads a file at any ref, `Git.changedFiles` lists a range, `Git.refExists` probes a ref — none of them touch the working tree.

  ```ts
  import { Git } from "@effected/git";
  import { NodeServices } from "@effect/platform-node";
  import { Effect, Layer, Option } from "effect";

  const program = Effect.gen(function* () {
    const git = yield* Git;
    const manifest = yield* git.show("/repo", "v1.2.0", "package.json");
    const changed = yield* git.changedFiles("/repo", { base: "main", head: "HEAD" });
    const released = yield* git.refExists("/repo", "refs/tags/v1.2.0");
    return { manifest: Option.getOrNull(manifest), changed, released };
  });

  const GitLive = Git.layer.pipe(Layer.provide(NodeServices.layer));

  Effect.runPromise(program.pipe(Effect.provide(GitLive))).then(console.log);
  ```

  ### Classification into typed answers

  git's exit codes and stderr are read in exactly one classification step: a path absent at a valid ref is `Option.none` from `show`, an unresolvable ref is `false` from `refExists` or a typed `UnknownRefError` elsewhere, a directory outside a work tree is `NotARepositoryError`, and everything else is a `GitCommandError` carrying the exit code and stderr intact.

  ```ts
  import { Git } from "@effected/git";
  import { Effect, Option } from "effect";

  const contentAt = (cwd: string, ref: string, path: string) =>
    Effect.gen(function* () {
      const git = yield* Git;
      return yield* git.show(cwd, ref, path);
    }).pipe(
      Effect.catchTag("UnknownRefError", () => Effect.succeed(Option.none<string>())),
      Effect.catchTag("NotARepositoryError", (e) => Effect.die(e)),
    );
  ```

  Also ships `Git.lsTree`, `Git.mergeBase`, `Git.revParse` and `Git.checkout`, plus `GitCommand.*` — the seven invocations as pure, inspectable `Command` values you can test against without spawning anything. [#81][#81]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#81]: https://github.com/spencerbeggs/effected/pull/81
