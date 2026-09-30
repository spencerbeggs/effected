# @effected/memfs

In-memory implementation of core Effect's `FileSystem` service: the `MemoryFileSystem` module, providing an isolated virtual POSIX volume behind the standard `FileSystem.FileSystem` key, plus the `@effected/memfs/node-sync` subpath (`NodeSyncFileSystem`, a read-only synchronous `FileSystem` over `node:fs`). The engine (`src/internal/volume.ts`) is a vendored port with attribution of Effect-TS/effect PR #6573 (pinned `c0528bd5`), the conformance suite of PR #6555 (pinned `2492ba9d`).

**Design doc:** `@./okf/modules/memfs.md` — load when changing the engine, the seeding API, the adaptation ledger, or re-vendoring against a newer upstream head.

## Tier: pure — and the zero-edges law

`effect` is the only peer; zero runtime dependencies; the layer's `R` is `never` (the package *provides* `FileSystem`, requiring nothing). **The main entry imports nothing from `node:*`** — only `src/NodeSyncFileSystem.ts` (the `./node-sync` subpath) may, and nothing reachable from `src/index.ts` imports it. Check with an import-specifier grep or a graph walk from `index.ts`, never a bare `node:` grep (it matches prose and the substring in `Inode:`).

**No `@effected/*` edge, ever — runtime, peer, or dev.** Every kit package (including `glob`) may devDepend on this one for tests; any edge back into the kit is a cycle. Consequence: the engine keeps its embedded mini-glob for `fs.glob` — do **not** "deduplicate" it by importing `@effected/glob`.

`@effect/platform-node` is a devDependency confined to the differential-oracle integration test.

## The contracts that must not drift

- **Honest absence (the #249 contract)**: any read/stat/open-without-create of an unseeded path fails typed `NotFound`. Nothing may fabricate content — the package exists because a hand stub answering `""` caused a real silent-changeset-drop bug.
- **Typed errors always**: malformed input is `badArgument`/`systemError`, never a defect; the only `Effect.die` sites are inherited internal-invariant violations.
- **Deltas from the pinned upstream live in the design doc's adaptation ledger** (watch honors `recursive`; depth guards at `MAX_NESTING_DEPTH = 256`; seeding API; `access` options documented as ignored). Anything else diverging from `c0528bd5` is drift, not design.
- **Errno fidelity (ledger entry 10)**: every failure the real platform raises is built by `errnoError(method, path, code)` (in `internal/errno.ts`, shared by the engine, the ports and node-sync) from the errno node reports; the `_tag` is derived from the code by the node adapter's own mapping and the code rides on `cause.code`. Never hand-pick a tag at a new site — name the errno, and add the case to `__test__/ErrnoParityContract.ts`, which runs against both implementations.
- **Never edit the attribution/license notice text** in the ported file headers.
- **Ledger entry 9 (0.5.0)**: `VolumeEntrySnapshot` carries `mtime`, and `collectEntrySnapshots` now emits the **root** entry — released 0.4.0 answered `has("/") === false`.

## The public surface

- **Constructors (8).** `make` / `layer` (the upstream mirror; empty volume). `makeWith` / `layerWith(seed?, options?)` with `options = { root?, caseSensitive?, faults? }`. `root` is a JOIN BASE, not a jail (dogfood round 2 reversed the Task 3 jail): a relative key normalizes lexically and may land outside it; only a relative root or an absolute key alongside a root is rejected, naming the value. `makeHandle` (inside `Effect`) and `makeSync` (at describe scope) return a `MemoryFileSystemHandle`: `fileSystem`, `volume`, a `layer` pinned to that one volume (FileSystem + Volume + Path, stable across provides), the `sync` and `promises` ports, `root`, `withFaults({ sync?, promises? })` (faulted ports over the same volume — `options.faults` is FileSystem-scoped and never reaches the handle's ports), and setup mutators that join a relative path to `root` (or `/`; a symlink's target text stays verbatim) UNNORMALIZED — `..` resolves after links are followed, unlike a seed key's lexical join — and report the caller's path in errors. `makeFaulty` / `layerFaulty` decorate ANY `FileSystem`. Removed and never to return: `layerFaultyWith`, `layerInspectable(With)`, `makeInspectable(With)`, `MemoryFileSystemInspectable`.
- **Every memory layer publishes `MemoryFileSystem.Volume`** beside `FileSystem` (a layer providing more is still assignable to `Layer<FileSystem>` — ROut is contravariant). Under `options.faults` the service is faulted while `Volume`, the ports and the handle's mutators see the raw volume; the seed is written beneath the faults.
- **One build path**: `buildHandle` in the facade (engine → seed through the raw fs → view → optional `wrapFaulty`). Internals: `internal/seed.ts`, `view.ts`, `ports.ts`, `faults.ts`, `errno.ts`, and the engine `volume.ts`.

## The sync view and the ports

`MemoryFileSystemVolume` answers `readDirectory`, `isDirectory`, `mtime`, `readLink` and `lstat` besides the content members. They are **literal** — a symlink pointing at a directory is not one, and links are never followed, not even mid-path — and honestly absent: `undefined` for nothing there, because `[]` and `0` are real answers a signature must not conflate with absence. Point queries go through the engine's O(depth) `lookup` (a fenced kit extension); only `snapshot`/`paths` walk the tree.

`syncFileSystem(volume)` (six members: `exists`, `readFile`, `readDirectory`, `isDirectory`, `stat`, `lstat`) and `promisesFileSystem(volume)` (`readdir` with `withFileTypes`, `stat`, `lstat`, `readFile` with node's overloads — bytes without an encoding, a string with one) adapt that view to `node:fs` shapes for code that takes an injected port. The ports **follow symlinks** even though the view under them is literal — their operations are `stat`-defined, and answering literally silently drops symlinked package directories from a workspace enumeration (the regression review caught on #445). Absence **throws** (or rejects) node's exact error — `code`, `syscall`, `path` and message, pinned against real `node:fs` in `integration/ports.int.test.ts`; a `read` EISDIR carries no path, as node's does. They satisfy `@effected/workspaces`' `SyncFileSystem` **structurally, with no import in either direction: the zero-edges law above is intact** — never "finish the wiring" by adding one. Not a general escape hatch either: code calling `node:fs` directly still does not see the volume.

Two mtime traps. `file(content, { mtime })` seeds through a `Date`, because `FileSystem.utimes` reads a bare number as Unix **seconds** while the option is milliseconds. And writes stamp the Effect `Clock`, so under `it.effect` every written entry reads as `0` until `TestClock` advances.

## Case folding (ledger entry 11)

`caseSensitive: false` models a case-insensitive, case-preserving volume. Every rule was **measured on the host first** (`__test__/CaseInsensitiveContract.ts`, run against APFS by `integration/case-insensitive.int.test.ts`, which skips on a case-sensitive host) — never assume one:

- Folding lives in the engine's `lookupEntry` only; every mutation of an existing entry keys on the STORED name.
- `realPath` and watch paths keep the QUERIED spelling (the node adapter wraps the JS `fs.realpath`, which never canonicalizes); only a link's target text supplies its own.
- Rename and `copyFile` onto a folded-equal entry keep the destination's stored spelling; `copy` (async `fs.cp`, unlink-then-create) takes the requested one — re-probe with async `cp`, never `cpSync`, which differs. A case-only rename rekeys the entry with its children; a byte-identical rename is a no-op.
- `glob` folds and returns stored names; watch matching compares folded paths.
- Limits: `toLowerCase` per UTF-16 unit (`İ`, `ß`), no NFC/NFD normalization.

## node-sync

`NodeSyncFileSystem` (`./node-sync`) is read-only and synchronous: its read members agree with `@effect/platform-node`'s `NodeFileSystem` value for value and failure for failure (`integration/node-sync.int.test.ts`), including the adapter's quirks — the JS `realpathSync` (never `.native`), and `readDirectory` reporting argument errors as `Unknown`/`ERR_*` where every other member says `BadArgument`. Do not "fix" either. Every non-read member is a DEFECT (`FileSystem.makeNoop` fails typed instead, so it is not spread). `NodeSyncFileSystem.fileSystem` is a value, not an `Effect`.

## Layer discipline

`layerWith(seed, options)` and `layerFaulty(faults)` are parameterized factories — fresh reference per call: bind to a `const`. **Layer memoization is per-build, not per-value** (downstream item 6, 2026-08-16): every `Effect.provide` of a layer value — even the same bound `const` — builds and re-seeds a fresh volume (and re-arms `failTimes` counters). Sharing one volume across effects requires ONE provide of one composed layer graph, or a handle's pinned `layer`; `Layer.fresh`'s only role is opting a consumer *inside* that graph back out into its own volume. Never describe the old "one layer value = one shared volume" framing — it produced silent false greens downstream.

## Fault injection (kit extension)

`options.faults` on a seeded constructor, or `makeFaulty(base, faults)` / `layerFaulty(faults)` over any `FileSystem`, wrap delegate-by-default: handlers get the real call arguments and return a replacement (an Effect; a Stream/Sink for `stream`/`sink`/`watch`) or `undefined` (delegate); `failTimes(n, err)` is the transient form, confined to the Effect-returning methods at the type level and counted per execution (so `Effect.retry` attempts consume failures). The wrapper rebuilds through `FileSystem.make`, so faults on core methods propagate into derived members (`access` → `exists`, `readFile` → `readFileString`, `writeFile` → `writeFileString`, `open` → `stream`/`sink`) — and every function-valued member, the lazy trio included, is also directly interceptable. `die(defect)` is the defect arm (what `layerNoop` does to its `make*` members; `Effect.catch` cannot absorb it), and every wrapper also accepts a `(base) => faults` factory whose `base` is the unfaulted filesystem, run once per build. **An unknown fault key throws `RangeError` at construction** (checked against the target's own enumerable function members, so a class instance with prototype methods must be wrapped in `FileSystem.make` first); a promises-port handler that throws synchronously rejects. Modes are metadata, never enforced — fault injection is the sanctioned way to simulate permission failures.

## Testing and building

Tests in `__test__/`, `@effect/vitest`, `assert.*` never `expect`. Three layers:

- **Contracts run against both implementations** — each `*Contract.ts` suite runs against memfs AND the real disk (`integration/*.int.test.ts`, the differential oracle): the adapted #6555 `FileSystemContract`, `ErrnoParityContract`, and `CaseInsensitiveContract` (host run skips on a case-sensitive volume). `integration/ports.int.test.ts` and `node-sync.int.test.ts` diff the ports and node-sync against `node:fs` / `NodeFileSystem` directly. If memfs and the host disagree, memfs is wrong.
- **The upstream-ported** `MemoryFileSystem.test.ts` — its body stays upstream's.
- **Kit suites, one per feature**: `Constructors`, `Seeding`, `HonestAbsence`, `Volume`, `Handle`, `Ports`, `FaultInjection`, `WatchRecursive`, `CaseInsensitive`; shared helpers (`thrown`, `denied`, `collectWatch`, `firstEvent`) live in `__test__/helpers.ts`.

A new behaviour starts RED, and its fix is mutation-checked: revert the fix and watch a test fail. A new case-folding rule is proved on the host before memfs implements it.

```bash
pnpm vitest run --project @effected/memfs   # from the repo root
pnpm build --filter @effected/memfs
```

Never run `node savvy.build.ts --target prod` directly. `savvy.build.ts` carries the narrow `_base` suppression — never widen it. `package.json` stays `"private": true`.
