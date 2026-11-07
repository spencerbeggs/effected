# @effected/files

Two atomic writes. `AtomicFile.write`: refuse a target the caller may not write, then replace one file through a synced temp file and a rename, so a crash leaves the old content or the new content and never a truncated file. A symlinked target is followed by default or replaced with `{ links: "replace" }`. When following, a link `realPath` cannot follow is the one exception: it is written through directly. `AtomicDirectory.write` replaces a whole directory through a staged sibling and two renames.

**Design doc:** `@./okf/modules/files.md`, load before changing the choreography or a ruling.

**Tier: boundary.** `FileSystem` and `Path` are in `R`. `effect` is the only peer, there are no dependencies, and there is no `node:` import. `@effected/memfs` is a devDependency for tests. Adopters take this as a regular `workspace:^` dependency.

## Rules that are load-bearing

- **`AtomicFile`'s error channel is plain `PlatformError`.** Never add a tagged error to it: every adopter keeps its existing `mapError`, and adopting this must change no public error type.
- **Never create parent directories.** Adopters already do.
- **Never fall back to a non-atomic write.** A read-only directory fails loudly.
- **An existing target is checked with `fs.access(final, { writable: true })` before any temp.** Never check mode bits. memfs's `access` ignores modes, so the test faults `access`.
- **The temp name never contains the target's basename**, so a 255-byte name cannot overflow. memfs has no name limit, so the test stands in for the host's `ENAMETOOLONG` with an `open` fault.
- **`chmod` after `open` stays**, because `open`'s mode is subject to umask. memfs has no umask, so the test narrows the mode with an `open` fault.
- **The temp cleanup sits outside `Effect.scoped`**, so the file is closed before it is removed.
- **The temp's cleanup arms only after our `open` succeeded, in one uninterruptible step.** A failed `wx` open means the name is another writer's, so it must not be removed.
- **A link `realPath` cannot follow is written through with `writeFile`, and the filesystem resolves it.** That covers a dangling link, and a symlink before `..` in the link text under Node, whose `realpath` is lexical on POSIX. It is deliberately not atomic. Never add a lexical resolution, a segment walker or a placeholder file. memfs's `realPath` follows the second shape, so its test faults `realPath` to stand in for Node.
- **There is no hop budget.** A chain too long to follow fails with the filesystem's error.
- **`links: "replace"` reads the target only with `lstat`.** No `realPath`, `stat`, `readLink` or write-through. The mode comes from that `lstat`, and a link contributes no mode and no `access` check, so its destination is never consulted. The temp sits in the target's own directory. The default stays `"follow"`; any other value is a defect.
- **`links` governs the last component only.** Symlinked parents are traversed in both modes; never add a parent walk here (containment is `@effected/walker`'s `confineReal`).

### AtomicDirectory

- **Whole-directory replacement over core `FileSystem` + `Path` in `R`** (normalise root, siblings `.<name>.staging` and `.<name>.old`, clear both leftovers, stage even when empty, write, rename live to `.old`, rename staging to live, remove `.old`). The sibling placement and the two-rename swap are the contract: never remove the live tree in place (a reader would see it half-deleted), and do not move either sibling elsewhere (the renames stop being same-filesystem).
- **The absence window between the two renames cannot be closed portably**, since POSIX has no atomic directory exchange, so it stays documented.
- **Its error is the tagged `AtomicDirectoryError`**, unlike `AtomicFile`'s plain `PlatformError`. `src/internal/causeMessage.ts` is the kit's verbatim copy, per `okf/conventions/error-standards.md`.
- Tests run on `@effected/memfs` with faults on `rename`/`writeFile`/`remove`/`makeDirectory`.

```bash
pnpm vitest run --project @effected/files   # from the repo root
pnpm build --filter @effected/files
```

Tests live in `__test__/`, use `@effect/vitest` with `assert.*` (never `expect`), and take `FileSystem` from `@effected/memfs`, never `layerNoop`. Faults on `writeFile` reach only the write-through path; the atomic path writes through `open`.
