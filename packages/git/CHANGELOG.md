# @effected/git

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
