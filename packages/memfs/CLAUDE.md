# @effected/memfs

In-memory implementation of core Effect's `FileSystem` service: one module, `MemoryFileSystem`, providing an isolated virtual POSIX volume behind the standard `FileSystem.FileSystem` key. The engine (`src/internal/volume.ts`) is a vendored port with attribution of Effect-TS/effect PR #6573 (pinned `c0528bd5`), the conformance suite of PR #6555 (pinned `2492ba9d`).

**Design doc:** `@../../.claude/design/effected/packages/memfs.md` — load when changing the engine, the seeding API, the adaptation ledger, or re-vendoring against a newer upstream head.

## Tier: pure — and the zero-edges law

`effect` is the only peer; zero runtime dependencies; the layer's `R` is `never` (the package *provides* `FileSystem`, requiring nothing).

**No `@effected/*` edge, ever — runtime, peer, or dev.** Every kit package (including `glob`) may devDepend on this one for tests; any edge back into the kit is a cycle. Consequence: the engine keeps its embedded mini-glob for `fs.glob` — do **not** "deduplicate" it by importing `@effected/glob`.

`@effect/platform-node` is a devDependency confined to the differential-oracle integration test.

## The contracts that must not drift

- **Honest absence (the #249 contract)**: any read/stat/open-without-create of an unseeded path fails typed `NotFound`. Nothing may fabricate content — the package exists because a hand stub answering `""` caused a real silent-changeset-drop bug.
- **Typed errors always**: malformed input is `badArgument`/`systemError`, never a defect; the only `Effect.die` sites are inherited internal-invariant violations.
- **Deltas from the pinned upstream live in the design doc's adaptation ledger** (watch honors `recursive`; depth guards at `MAX_NESTING_DEPTH = 256`; seeding API; `access` options documented as ignored). Anything else diverging from `c0528bd5` is drift, not design.
- **Never edit the attribution/license notice text** in the ported file headers.
- **Ledger entry 10 (0.5.0)**: `VolumeEntrySnapshot` carries `mtime`, and `collectEntrySnapshots` now emits the **root** entry — released 0.4.0 answered `has("/") === false`.

## The sync view and `syncFileSystem`

`MemoryFileSystemVolume` also answers `readDirectory`, `isDirectory` and `mtime` (epoch ms). They are **literal** — a symlink pointing at a directory is not one, and links are never followed — and honestly absent: `undefined` for nothing there, because `[]` and `0` are real answers a signature must not conflate with absence.

`MemoryFileSystem.syncFileSystem(volume)` adapts that view to the `node:fs` sync subset (`exists`, `readFile`, `readDirectory`, `isDirectory`) for code that takes an injected sync port instead of requiring `FileSystem`. The port **follows symlinks** even though the view under it is literal — its operations are `stat`-defined, and answering literally silently drops symlinked package directories from a workspace enumeration (the regression review caught on #445). Absence **throws**, carrying `code`/`syscall`/`path` — the only failure channel a sync signature has; it never fabricates `""` or `[]`, and a directory read as a file is `EISDIR`. It satisfies `@effected/workspaces`' `SyncFileSystem` **structurally, with no import in either direction: the zero-edges law above is intact** — never "finish the wiring" by adding one. Not a general escape hatch either: code calling `node:fs` directly still does not see the volume.

Two mtime traps. `file(content, { mtime })` seeds through a `Date`, because `FileSystem.utimes` reads a bare number as Unix **seconds** while the option is milliseconds. And writes stamp the Effect `Clock`, so under `it.effect` every written entry reads as `0` until `TestClock` advances.

## Layer discipline

`layerWith(seed)`, `layerFaulty(faults)` and `layerFaultyWith(seed, faults)` are parameterized factories — fresh reference per call: bind to a `const`. **Layer memoization is per-build, not per-value** (downstream item 6, 2026-08-16): every `Effect.provide` of a layer value — even the same bound `const` — builds and re-seeds a fresh volume (and re-arms `failTimes` counters). Sharing one volume across effects requires ONE provide of one composed layer graph; `Layer.fresh`'s only role is opting a consumer *inside* that graph back out into its own volume. Never describe the old "one layer value = one shared volume" framing — it produced silent false greens downstream.

## Fault injection (kit extension)

`makeFaulty(base, faults)` / `layerFaulty(faults)` / `layerFaultyWith(seed, faults)` wrap ANY `FileSystem` delegate-by-default: handlers get the real call arguments and return a replacement (an Effect; a Stream/Sink for `stream`/`sink`/`watch`) or `undefined` (delegate); `failTimes(n, err)` is the transient form, confined to the Effect-returning methods at the type level and counted per execution (so `Effect.retry` attempts consume failures). The wrapper rebuilds through `FileSystem.make`, so faults on core methods propagate into derived members (`access` → `exists`, `readFile` → `readFileString`, `writeFile` → `writeFileString`, `open` → `stream`/`sink`) — and every function-valued member, the lazy trio included, is also directly interceptable. Modes are metadata, never enforced — fault injection is the sanctioned way to simulate permission failures.

## Testing and building

Tests in `__test__/`, `@effect/vitest`, `assert.*` never `expect`. Three layers: the adapted #6555 contract suite against `MemoryFileSystem.layer`; the same suite against `@effect/platform-node`'s real filesystem (the differential oracle, `self.int.test.ts` pattern); memory-specific + kit tests (seeding, honest-NotFound, isolation, watch-recursive).

```bash
pnpm vitest run --project @effected/memfs
pnpm build --filter @effected/memfs
```

Never run `node savvy.build.ts --target prod` directly. `savvy.build.ts` carries the narrow `_base` suppression — never widen it. `package.json` stays `"private": true`.
