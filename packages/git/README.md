# @effected/git

[![npm](https://img.shields.io/npm/v/@effected%2Fgit?label=npm&color=cb3837)](https://www.npmjs.com/package/@effected/git)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Typed git introspection as an Effect service. `Git.show` reads a file's content at any ref without checking it out, `Git.lsTree` lists a ref's tree, `Git.refExists` probes a ref, `Git.mergeBase`, `Git.changedFiles` and `Git.revParse` answer the questions monorepo tooling actually asks — and `Git.checkout` is the one deliberately-marked mutation. Subprocesses run through Effect core's `ChildProcessSpawner` contract, required in `R` and provided once at your application's edge, so this package has zero runtime dependencies and zero `node:` imports.

## Why @effected/git

Shelling out to git looks easy until you have to interpret the answers. git speaks through exit codes and stderr prose, and the prose changes with the question: an unknown ref, a directory that is not a repository, a path absent at a ref, and a genuinely failed command all come back as "non-zero exit plus a sentence". Code that string-matches stderr at every call site gets this wrong somewhere, eventually, in a different way each time.

This package reads git's exit codes and stderr in exactly one classification step and hands you typed answers instead: a path absent at a valid ref is `Option.none` from `show` (a fact about the ref, not an error), a ref that does not resolve is `false` from `refExists` and a typed `UnknownRefError` elsewhere, a directory outside any work tree is `NotARepositoryError`, and everything else is a `GitCommandError` carrying the exit code and stderr intact. Spawn-level platform failures and the 30-second per-run ceiling are absorbed into that same taxonomy — no `PlatformError` and no timeout defect ever leaks from a `Git` method. Every command pins `LC_ALL=C`, so the classification is stable across locales, and tree listings use NUL-terminated output, so a path containing a space — or a newline — survives parsing.

`GitCommand` is exported alongside the service: seven pure constructors producing Effect core `Command` values you can inspect, log, or test against without spawning anything.

## Install

```bash
npm install @effected/git effect
```

```bash
pnpm add @effected/git effect
```

Requires Node.js >=24.11.0. `effect` v4 is a peer dependency, and it is the only one — git has no runtime dependencies of its own.

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

- `Git.show(cwd, ref, path)` — file content at a ref; `Option.none` when the path is absent there.
- `Git.lsTree(cwd, ref)` — the ref's full tree as typed entries (mode, type, oid, path), NUL-parsed.
- `Git.refExists(cwd, ref)` — `true`/`false`, including `false` for refs that do not resolve at all.
- `Git.mergeBase(cwd, a, b)` / `Git.revParse(cwd, ref)` — resolved SHAs.
- `Git.changedFiles(cwd, { base, head })` — paths changed across a range, NUL-parsed.
- `Git.checkout(cwd, ref)` — the one mutating operation, documented as such.
- `GitCommand.*` — the seven invocations as pure, inspectable `Command` values.
- Errors: `GitCommandError`, `NotARepositoryError`, `UnknownRefError` — classification happens once, inside the service.

## License

[MIT](LICENSE)
