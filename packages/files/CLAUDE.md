# @effected/files

`AtomicFile.write`: replace one file through a synced temp file and a rename, so a crash leaves the old content or the new content and never a truncated file.

**Design doc:** `@./okf/modules/files.md`, load before changing the choreography or a ruling.

**Tier: boundary.** `FileSystem` and `Path` are in `R`. `effect` is the only peer, there are no dependencies, and there is no `node:` import. `@effected/memfs` is a devDependency for tests. Adopters take this as a regular `workspace:^` dependency.

## Rules that are load-bearing

- **The error channel is plain `PlatformError`.** Never add a tagged error here: every adopter keeps its existing `mapError`, and adopting this must change no public error type.
- **Never create parent directories.** Adopters already do.
- **Never fall back to a non-atomic write.** A read-only directory fails loudly.
- **The temp name never contains the target's basename**, so a 255-byte name cannot overflow. memfs has no name limit, so the test stands in for the host's `ENAMETOOLONG` with an `open` fault.
- **`chmod` after `open` stays**, because `open`'s mode is subject to umask. memfs has no umask, so the test narrows the mode with an `open` fault.
- **The temp cleanup sits outside `Effect.scoped`**, so the file is closed before it is removed.
- **The hop budget is only reachable where `realPath` answers `NotFound` for a long chain.** Real `realPath` usually reports `ELOOP` first, and memfs does at 40 links, so the budget's tests fault `realPath`.

```bash
pnpm vitest run --project @effected/files   # from the repo root
pnpm build --filter @effected/files         # never node savvy.build.ts
```

Tests live in `__test__/`, use `@effect/vitest` with `assert.*` (never `expect`), and take `FileSystem` from `@effected/memfs`, never `layerNoop`. Faults on `writeFile` do not reach this code, which writes through `open`.
