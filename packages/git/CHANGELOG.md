# @effected/git

## 0.11.0

### Breaking Changes

#### `@effected/schemastore` no longer ships `AnnotationCarriers`

- `AnnotationCarriers` and `CarrierDepthExceededError` are removed, and the module is deleted.

- Effect `4.0.0-rc.112` ("Make JSON Schema dialect conversions preserve custom keywords") changed the Draft-07 lowering to carry unknown and custom keywords through as opaque values, in place — including across the tuple coordinate moves (`prefixItems[i]` to `items[i]`, and a trailing `items` to `additionalItems`). The post-lowering re-graft those symbols performed is therefore redundant, and **emitted documents are unchanged**.

- If you imported either symbol, delete the call: annotate a schema node and the key now reaches the document on its own.

#### `StoreDocument` and `SchemaPipeline` error channels are wider

- `StoreDocument.fromSchema`, `StoreDocument.fromSchemaResult`, and `SchemaPipeline.run` / `check` / `runOne` / `checkOne` can now fail with `UndeclaredAnnotationKeyError`. Callers matching exhaustively on the error channel need one new branch.

### Features

#### `@effected/schemastore` refuses undeclared annotation keys instead of dropping them

- `StoreDocument.fromSchema` now fails with the new `@public` `UndeclaredAnnotationKeyError` — carrying the document's `$id` and every offending key — when a caller-supplied `includeAnnotationKey` admits a key outside the declared keyword families (the vscode set, `x-taplo`, `x-tombi-*`, `x-intellij-*`, `x-ai-*`).

- Previously such keys were admitted into the Draft 2020-12 document and silently discarded by the Draft-07 lowering, so the package's compatibility guarantee was really a side effect of a dependency's behavior. Since rc.112 no longer discards them, that guarantee is now enforced by the package itself — and enforced loudly, because a caller who asks for a key and silently does not get it has no way to notice.

- Declared families are still admitted unconditionally, regardless of the caller's predicate.

```ts
// Fails: UndeclaredAnnotationKeyError, keys: ["x-custom"]
yield* StoreDocument.fromSchema(schema, {
  $id: "https://example.com/schemas/tool.json",
  jsonSchema: { includeAnnotationKey: (key) => key === "x-custom" },
});
```

#### The whole kit tracks Effect `4.0.0-rc.112`

- Every package's `effect` peer moves to the new pin. The kit uses exact prerelease pins rather than a caret, so a consumer must move with it.

### Bug Fixes

- `@effected/schemastore`: the `#/definitions` to `#/$defs` `$ref` rewrite no longer descends into declared-family annotation values. A `$ref`-shaped string inside an `x-taplo` or `x-ai-*` payload is opaque advice addressed to a language server, and was being rewritten in transit.
- A known limitation, still open upstream as [Effect-TS/effect#8084](https://github.com/Effect-TS/effect/issues/8084): a `Schema.Class`'s class-level annotations — `title` and `description` as well as the declared families — never reach the emitted document, because core generates the definition from the class's encoded AST. A hoisted `Schema.Struct` keeps its annotations. Annotate a `Schema.Struct` root instead.

### Documentation

#### The Claude Code and Copilot plugins are Effect v4 only

- The v3-to-v4 migration material is retired: the `effect-migrator` agent and the `effect-v4-construct-map` skill are removed, along with the migration framing that ran through the remaining skills. The facts underneath it are kept, restated as statements of what v4 is rather than what changed.

- The SessionStart briefing now states plainly that an agent's recall of Effect is out of date by construction, and routes it to the specialist agents or the skills rather than to a guess. It also reports whether the repo vendors Effect source at `.repos/effect` and whether that pin matches the kit's — a stale vendored tree is worse than none, because it answers confidently and wrongly.

- Several skill claims were re-measured against rc.112 and corrected, including one whose stated mitigation pointed at the wrong signal: for a zero-collection vitest run it is the `Tests: 0/0 passed` line that lies, while the exit code is honest. [#623][#623]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/tsgo | devDependency | updated | 0.36.5 | 0.41.0 |
| @effect/vitest | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | devDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#623]: https://github.com/spencerbeggs/effected/pull/623

## 0.10.0

### Features

- `configList` and `configGet` accept a new `scope` option (`{ scope: "local" }`) to read only the checkout's own declared configuration instead of the merged (repository + global + system) view. Passing both `scope` and `file` (on `configList`) fails typed as a `GitCommandError` rather than silently preferring one — git itself accepts only one source selector. `configSet` is unaffected: it always writes repository-local config and offers no scope option, deliberately, to avoid leaking a setting onto a shared machine or CI runner. [#497][#497]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#497]: https://github.com/spencerbeggs/effected/pull/497

## 0.9.0

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | :-- | :-- | :-- | :-- | :-- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.107 | 4.0.0-rc.109 | [#389][#389] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Minor Changes

[#389]: https://github.com/spencerbeggs/effected/pull/389

## 0.8.0

### Features

- ### Wider `submoduleUpdate`
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

- Construction/decode failures now throw a generic `"Schema validation failed"` message with the structured `SchemaIssue.Issue` available on `error.cause` — format it with `SchemaIssue.makeFormatterDefault()` for a human-readable report. [#322][#322]

### Refactoring

- Migrated error classes to Effect's renamed `Schema.TaggedError` (was `Schema.TaggedErrorClass`); the call shape is unchanged and no consumer action is required.
- Updated `Gitmodules`' internal `SchemaIssue.InvalidValue` construction to the new `(annotations, input)` argument order (the `Option`-wrapped first argument is gone).

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-beta.101 | 4.0.0-beta.107 |

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#322]: https://github.com/spencerbeggs/effected/pull/322

## 0.6.0

### Breaking Changes

- Every `GitCommand` constructor now returns a `GitInvocation` — the spawnable
  command plus `redactedArgs`, the same argv with sensitive positionals
  masked (a `configSet` value is masked wholesale; a URL's embedded&#10;`userinfo@` is stripped) — instead of a bare command value. `GitCommandError`&#10;now carries `redactedArgs` in `args`, and renders them in `message`, so raw
  argv never reaches an error value. This only affects direct consumers of&#10;`GitCommand`'s constructors; the `Git` service surface is unaffected.
  ````ts
  import { GitCommand } from "@effected/git";

  const { command, redactedArgs } = GitCommand.configSet("user.email", "secret@example.com");
  ``` [#295](https://github.com/spencerbeggs/effected/pull/295) Thanks [@spencerbeggs](https://github.com/spencerbeggs)!
  ````

### Features

- Added a pure `GitConfig` document model: a lossless git-config parser and
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
  a `FromString` codec), with mutation helpers (`setUrl`, `setPath`,&#10;`setBranch`, `setShallow`, `add`, `remove`, `rename`) that compile to
  surgical `GitConfig` edits rather than hand-rolled text editing.

  Added a submodule tier to `Git`: `submoduleStatus`, `submoduleInit`,&#10;`submoduleDeinit`, `submoduleSync`, `submoduleSetUrl`, `submoduleSetBranch`,&#10;`submoduleAbsorbgitdirs`, `submoduleForeach`.

  Added worktree-state, branch and shallow-repo members: `reset`, `clean`,&#10;`restore` (a fail-loud posture — no silent partial application), `branchCreate`&#10;(now also drives `checkout -B` / `branch -f` via a `force` option),&#10;`branchDelete`, `isShallow`, `fetchUnshallow`. `StatusEntry` gained&#10;`toLine`/the static `format` helper for rendering porcelain-shaped status
  output back out, with a `StatusRenderOptions` controlling the new-path
  default.

  Added a second tier of members: `lsRemote` with `LsRemoteEntry`&#10;(`shortName`/`nearMatches` for suggesting the closest ref on a typo), the
  remote tier (`remoteAdd`, `remoteRemove`, `remoteSetUrl`), the stash tier,&#10;`branchList`, `tagCreate`, `tagDelete`, `tagList`, `forEachRef`, `revList`,&#10;`commit`, `push`, `pull`, `configList`, `configGetAll`, `configUnset`,&#10;`rm`, `mv`, `checkIgnore`, the worktree tier (`worktreeAdd`, `worktreeList`,&#10;`worktreeRemove`), and `lsFiles`. `Git` grew from 26 to 69 members.

  Three new typed errors, added only alongside the new members that can raise
  them — no existing member's error union changed: `NonFastForwardError` from&#10;`push`, and `MergeConflictError` / `DirtyWorktreeError` from `pull`,&#10;`stashPop` and `stashApply`.

## 0.5.2

### Maintenance

- Switching internal dependency versioning from `~` to `^` ranges.

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.5.1

### Refactoring

- `GitCommand` is now a static class with a private constructor rather than an&#10;`as const` namespace object. Call syntax is unchanged (`GitCommand.show(...)`);
  each member's TSDoc now ships in the built `.d.ts`, where an `as const`&#10;object's inferred member types previously dropped it. [#180][#180]

### Patch Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#180]: https://github.com/spencerbeggs/effected/pull/180

## 0.5.0

### Features

- ### `Git.makeTest` and `Git.layerTest`
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

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.99 | 4.0.0-beta.101 | [#162][#162] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#162]: https://github.com/spencerbeggs/effected/pull/162

## 0.4.1

### Dependencies

- | Dependency | Type | Action | From | To |  |
  | --- | --- | --- | --- | --- | --- |
  | effect | peerDependency | updated | 4.0.0-beta.98 | 4.0.0-beta.99 | [#122][#122] Thanks [@spencerbeggs](https://github.com/spencerbeggs)! |

### Patch Changes

[#122]: https://github.com/spencerbeggs/effected/pull/122

## 0.4.0

### Features

- `GitCommandError` now carries a `kind` discriminant that separates a pre-spawn guard rejection from a genuine git failure. `"refused"` means a pre-spawn guard (an option-like ref) rejected the invocation before any process spawned; `"failed"` means git actually ran and exited non-zero, or the spawn itself failed. Composed retry and fallback logic can route on the discriminant instead of parsing the `detail` prose.
  - `Git.fetchAny` drops its duplicated up-front guard and short-circuits a refused ref by routing on `error.kind === "refused"`, with identical behavior [#106][#106]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#106]: https://github.com/spencerbeggs/effected/pull/106

## 0.3.0

### Features

- ### `Git.fetchAny` — fetch a ref without knowing whether it's a tag
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

- `NameStatusEntry.status` decodes git's one-letter diff codes using this package's own spelling — notably `"typeChanged"` and `"broken"`, not porcelain's `"typechange"` — now called out explicitly in the TSDoc for consumers mapping onto an existing enum that follows porcelain's spelling. [#91][#91]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#91]: https://github.com/spencerbeggs/effected/pull/91

## 0.2.0

### Features

- `Git` grew from 8 to 25 service methods, closing [#82][#82].
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

  All changes are additive and non-breaking. [#85][#85]

### Minor Changes

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#82]: https://github.com/spencerbeggs/effected/issues/82

[#85]: https://github.com/spencerbeggs/effected/pull/85

## 0.1.0

### Features

- Initial release: typed git introspection as an Effect service. Read a repository's state at any ref without checking it out, plus `checkout` — the one deliberately-marked mutation. Subprocesses run through Effect core's `ChildProcessSpawner` contract, required in `R` and provided once at the edge, so the package has zero runtime dependencies and zero `node:` imports.
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
