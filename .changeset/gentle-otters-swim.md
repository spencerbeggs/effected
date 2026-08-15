---
"@effected/memfs": minor
---

## Features

### `@effected/memfs` — an in-memory `FileSystem`

First release. `MemoryFileSystem` is an in-memory implementation of core Effect's `FileSystem` service: an isolated virtual POSIX volume — files, directories, symlinks, hard links, open descriptors, globbing, watching — behind the standard `FileSystem.FileSystem` key, for tests and dry-run programs that need filesystem behavior without host filesystem IO.

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

`MemoryFileSystem.layer` / `.make` build an empty volume; `.layerWith(seed)` / `.makeWith(seed)` pre-populate one from a `path → content` map. The founding contract is **honest absence**: reading, statting, or opening (without a create flag) a path nothing seeded fails typed with a `NotFound` `SystemError` — the volume never fabricates content.

The engine is a vendored port, with attribution, of Effect-TS/effect PR #6573 (pinned `c0528bd5`) and the conformance suite of PR #6555 — carrying a documented sunset for whenever core ships its own in-memory backend. It has zero `@effected/*` dependencies (`effect` is the only peer), so any package in the kit — this one included — can devDepend on it for tests without creating a cycle.
