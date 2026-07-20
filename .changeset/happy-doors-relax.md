---
"@effected/walker": minor
---

## Features

### `compileAndExpand`: compile a glob pattern and expand it against the filesystem, in one call

```ts
import { compileAndExpand } from "@effected/walker";
import { GlobPatternOptions } from "@effected/glob";

const files = yield* compileAndExpand("packages/*/src/**/*.ts", {
	cwd: "/repo",
	glob: GlobPatternOptions.make({ dot: true }),
});
```

New `compileAndExpand(pattern, options)` returns `Effect<ReadonlyArray<string>, GlobExpansionError, FileSystem | Path>`, matching FILE paths relative to `options.cwd`. No package previously owned the "compile a pattern and expand it against the filesystem" seam, so a downstream consumer had written four differently-shaped variants of this recipe and ended up with two divergent `dot` semantics inside one package.

The new `GlobExpansionError` is the single typed failure for the whole recipe: its `cause` is a discriminated union of `GlobPatternError | DescendError`, with a derived `stage` getter (`"compile" | "descend"`) for callers that only need the phase. `CompileAndExpandOptions` extends `DescendOptions` with one addition — `glob`, the options the pattern compiles under — and that field is **deliberately required**, so every call site states its own matching dialect instead of one site silently defaulting and drifting from another.

## Bug Fixes

### `Walker.ascend` normalizes `stopAt` before comparing, so an unnormalized ceiling no longer fails open

`stopAt` matched the ceiling by raw string equality, so a ceiling that named a real ancestor in any form other than its exact resolved spelling matched nothing and the ascent ran silently past it to the filesystem root — the unbounded walk the option exists to prevent. There was no error and no warning; from the call site the bounded walk simply looked like it worked.

`ascend` now compares each directory's `Path.resolve` form against the resolved ceiling. A trailing separator (`/repo/`), a `.` or `..` segment (`/repo/packages/..`) and a duplicated separator all stop where they name. Normalization is idempotent, so callers already resolving at the call site — `@effected/workspaces`' `WorkspaceRoot.find` does — are unaffected.

Two points of the contract are unchanged and now pinned by tests: `stopAt` is still **inclusive**, and normalization governs the **comparison only** — the returned chain is still the lexical one derived from `start`, unrewritten, so `ascend` through a symlinked start still follows the path it was given.

### A relative `stopAt` is now rejected instead of resolved against the working directory

`Walker.ascend` requires an **absolute** `stopAt` and rejects a relative one. Pass an absolute path:

```ts
// Before: silently resolved against process.cwd()
yield* Walker.ascend(start, { stopAt: "packages" });

// Now: resolve at the call site, where the intended base is known
yield* Walker.ascend(start, { stopAt: path.resolve("packages") });
```

A cwd-relative ceiling has no fixed meaning: the same `stopAt` bounds the walk at a different directory in a lint-staged hook, in a CLI invoked from a package directory, and under a test runner — and the caller cannot see which one they got. That is the same fail-open failure the raw string comparison above produced, reached through a different door, so `ascend` refuses it rather than guessing. Rejecting costs one `path.resolve` at the site that knows the answer; resolving silently costs a wrong walk that cannot be detected. `ascend` consequently reads `process.cwd()` nowhere.

The rejection is a **defect** (`Effect.die`), not a typed failure, so `ascend`'s error channel stays `never` and no call site needs to change its own signature. That follows the guard for an invalid `maxDepth` directly above it: a statically-wrong caller-supplied option is bad wiring, not a recoverable condition. It also has to be a defect to work at all — a typed failure would be absorbed by `@effected/config-file`'s resolver contract, which catches every failure into `Option.none()`, and would resurface as a clean-looking "no config file found". `Effect.catch` does not catch defects, so only a defect survives that absorption; a test reconstructs the absorbing caller and pins it.

Only the **ceiling** is constrained. A relative `start` is still fine and still ascends to the relative root. Absoluteness is judged by the injected `Path` service, so the win32 layer accepts `C:\repo`.
