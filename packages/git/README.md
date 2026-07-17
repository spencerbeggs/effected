# @effected/git

[![npm](https://img.shields.io/npm/v/@effected%2Fgit?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/git)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Typed git introspection as an Effect service. A read tier answers the questions monorepo tooling actually asks — `Git.show` reads a file's content at any ref without checking it out, `Git.nameStatus` types each changed path as added, renamed, deleted and so on, `Git.workingChanges` gathers the full working-tree delta, `Git.commitInfo` returns a commit's sha, signature verdict and raw message — and a clearly-marked mutating tier (`checkout`, `fetch`, the submodule pair, `sparseCheckoutSet`, `configSet`, `add`) changes repository state on purpose. Subprocesses run through Effect core's `ChildProcessSpawner` contract, required in `R` and provided once at your application's edge, so this package has zero runtime dependencies and zero `node:` imports.

> **Pre-release.** This package is part of the `@effected/*` kit, in pre-`1.0.0`
> development against a single pinned Effect v4 beta. Packages graduate to
> `1.0.0` once Effect `4.0.0` ships. To hold your own `effect` versions at
> exactly the ones the kit is built and tested against, install
> [`@effected/pnpm-plugin-effect`](https://www.npmjs.com/package/@effected/pnpm-plugin-effect).
>
> **Stability: unstable.** This package's API surface is not yet considered
> complete and may change across `0.x` releases. Pin an exact version — even a
> package marked *stable* before `1.0.0` can introduce a breaking change by
> accident, and an exact pin turns that into a type-check error rather than a
> runtime surprise. Full policy: [release strategy](https://github.com/spencerbeggs/effected#release-strategy).

## Why @effected/git

Shelling out to git looks easy until you have to interpret the answers. git speaks through exit codes and stderr prose, and the prose changes with the question: an unknown ref, a directory that is not a repository, a path absent at a ref, and a genuinely failed command all come back as "non-zero exit plus a sentence". Code that string-matches stderr at every call site gets this wrong somewhere, eventually, in a different way each time.

This package reads git's exit codes and stderr in exactly one classification step and hands you typed answers instead: a path absent at a valid ref is `Option.none` from `show` (a fact about the ref, not an error), a ref that does not resolve is `false` from `refExists` and a typed `UnknownRefError` elsewhere, a directory outside any work tree is `NotARepositoryError`, and everything else is a `GitCommandError` carrying the exit code and stderr intact. Spawn-level platform failures and the 30-second per-run ceiling are absorbed into that same taxonomy — no `PlatformError` and no timeout defect ever leaks from a `Git` method. Every command pins `LC_ALL=C`, so the classification is stable across locales, and tree listings use NUL-terminated output, so a path containing a space — or a newline — survives parsing.

`GitCommand` is exported alongside the service: 24 pure constructors producing Effect core `Command` values you can inspect, log, or test against without spawning anything.

## Install

```bash
npm install @effected/git effect
```

```bash
pnpm add @effected/git effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency, and it is the only one — git has no runtime dependencies of its own.

All `@effected/*` packages are ESM-only: the exports maps publish only `import` conditions, so `require()` — including tools that resolve in CJS mode — fails with Node's `ERR_PACKAGE_PATH_NOT_EXPORTED` rather than loading a CJS build that does not exist. Import from an ES module.

The subprocess spawner comes from Effect core's `ChildProcessSpawner` contract, not from a platform package. A consumer provides it once at the edge — `NodeServices.layer` from `@effect/platform-node` on Node — and a test provides a scripted spawner built with `ChildProcessSpawner.make`, no processes involved.

## Quick start

Read a file at a ref, list what changed, and probe a branch — all without touching the working tree:

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
// { manifest: "…the package.json as it was at v1.2.0…", changed: ["src/index.ts"], released: true }
```

The error channel tells you what can actually happen — and `show` on a path that did not exist at the ref is not one of those things:

```ts
import { Git, NotARepositoryError, UnknownRefError } from "@effected/git";
import { Effect, Option } from "effect";

const contentAt = (cwd: string, ref: string, path: string) =>
  Effect.gen(function* () {
    const git = yield* Git;
    return yield* git.show(cwd, ref, path);
  }).pipe(
    Effect.catchTag("UnknownRefError", () => Effect.succeed(Option.none<string>())),
    Effect.catchTag("NotARepositoryError", (e) => Effect.die(e)),
  );
// Effect<Option<string>, GitCommandError, Git> — absent-at-ref was already Option.none, no catch needed
```

## Features

Twenty-five service methods: eighteen that read repository state and seven that mutate it, all funneled through the same one-step classification.

- Content and trees: `Git.show(cwd, ref, path)` — file content at a ref, `Option.none` when the path is absent there — and `Git.lsTree(cwd, ref)` with an optional pathspec, returning typed `LsTreeEntry` values (mode, type, oid, path), NUL-parsed.
- Diffs: `Git.changedFiles(cwd, { base, head })` — paths changed across a range — and `Git.nameStatus`, which types each change as added, modified, deleted, renamed, copied and more, carries `oldPath` on renames, and takes either a `base...head` range or the working tree versus a single ref.
- Working tree: `Git.unstagedChanges`, `Git.stagedChanges`, `Git.untrackedFiles` and `Git.workingChanges` (their deduplicated union), plus `Git.status` as typed porcelain `StatusEntry` values.
- Probes: `Git.refExists` (`true`/`false`, including `false` for refs that do not resolve at all), `Git.mergeBase` and `Git.revParse` (resolved SHAs), `Git.repoRoot`, and the `Option`-answering `Git.defaultBranch` (unset remote HEAD → `Option.none`, remote prefix stripped), `Git.currentBranch` (detached HEAD → `Option.none`), `Git.configGet` and `Git.remoteUrl`.
- Commits: `Git.commitInfo(cwd, ref?)` — a typed `CommitInfo` with the sha, the `%G?` signature verdict and the raw, untrimmed message.
- Mutating tier, each method marked as such: `Git.checkout` (with a detach option), `Git.fetch` (remote, ref, depth, tag), `Git.submoduleUpdate`, `Git.submoduleAdd`, `Git.sparseCheckoutSet` (explicit cone flag), `Git.configSet` and `Git.add`. Nothing here serializes concurrent access — the caller owns that, per working tree.
- `GitCommand.*` — all 24 invocations as pure, inspectable `Command` values.
- Errors: `GitCommandError`, `NotARepositoryError`, `UnknownRefError` — classification happens once, inside the service. A ref the remote does not have surfaces as `UnknownRefError` too, the typed signal a tag-then-branch fetch fallback branches on with `Effect.orElse`.

## License

[MIT](LICENSE)
