# @effected/git

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
