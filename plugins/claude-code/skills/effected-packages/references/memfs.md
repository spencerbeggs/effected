# @effected/memfs

In-memory implementation of core Effect's `FileSystem` service: one class, `MemoryFileSystem`, providing an isolated virtual POSIX volume — files, directories, symlinks, hard links, open descriptors, temporary resources, globbing, watching — behind the standard `FileSystem.FileSystem` key. Pure tier: `effect` is the only peer, zero runtime dependencies, and the layers' `R` is `never` — the package *provides* `FileSystem`, requiring nothing. Born in the 2026-08-14 wave (effected#249): a hand-rolled `FileSystem.layerNoop` stub answering unarranged reads with `""` caused a real silent-changeset-drop bug, and this package exists to kill that footgun.

## Import

```ts
import { MemoryFileSystem } from "@effected/memfs";
import type { MemoryFileSystemSeed } from "@effected/memfs";
```

Single entrypoint; no subpaths.

## Core API

- **`MemoryFileSystem.layer`** — `Layer<FileSystem.FileSystem>` backed by a fresh, empty volume.
- **`MemoryFileSystem.layerWith(seed)`** — same, pre-populated from a `MemoryFileSystemSeed`: absolute POSIX paths mapped to contents, `string` (UTF-8-encoded) or `Uint8Array` (written verbatim). Parent directories are created recursively before each file — a seed never lists directories, and therefore cannot express an *empty* one; call `makeDirectory` on the built filesystem for that. A self-contradictory seed (a file seeded at a path another entry needs as a directory) is a test-wiring bug and **dies** with the typed error as its cause.
- **`MemoryFileSystem.make` / `makeWith(seed)`** — the effect-level constructors: `Effect<FileSystem.FileSystem>` / `Effect<FileSystem.FileSystem, PlatformError>`. `makeWith` keeps seeding failures in the typed error channel where `layerWith` converts them to a defect.

## The founding contract: honest absence

Any read, stat, or open-without-create-flag of an unseeded path fails typed `NotFound` (`SystemError`) — the volume never fabricates content for a path nothing arranged. That is the whole reason to reach for it over hand-stubbing `FileSystem.layerNoop`: a stub answering unarranged reads with `""` produces a silent false green (a phantom file parsing as empty), where memfs fails typed and the test names the missing fixture.

## Usage

```ts
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem } from "effect";

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString("/repo/package.json");
});

const SeededFs = MemoryFileSystem.layerWith({
  "/repo/package.json": `{ "name": "fixture" }`,
});

program.pipe(Effect.provide(SeededFs));
```

## Testing machinery

The package *is* testing machinery — reach for it in any test needing a filesystem, in any kit package: it has **zero `@effected/*` edges by law** (runtime, peer, or dev), so any package — `glob` included — may devDepend on it without creating a cycle.

## Gotchas

- **`layerWith` is a parameterized layer factory** — fresh reference per call, and layers memoize by reference: bind the result to a `const` and reuse it. One layer *value* is one shared volume; wrap in `Layer.fresh` for per-test isolation.
- Malformed input fails through the typed `PlatformError` channel (`badArgument`/`systemError`), never as a defect; pathological directory or brace-nesting depth fails typed at the engine's bound (`MAX_NESTING_DEPTH = 256`), never a stack overflow.
- Relative paths resolve from the virtual root `/` — the `FileSystem` contract has no working-directory operation.
- `access` checks existence only; its `readable`/`writable`/`ok` options are deliberately ignored (the volume models no process identity).
- The engine is a vendored port of Effect-TS/effect PR #6573 (pinned `c0528bd5`) with PR #6555's conformance suite, run against both the memory volume and `@effect/platform-node`'s real filesystem as a differential oracle — with a planned **sunset when core ships its own** in-memory `FileSystem`. Do not "deduplicate" its embedded mini-glob with `@effected/glob`; the zero-edges law forbids the import.
