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

## Layer discipline

`layerWith(seed)` is a parameterized factory — fresh reference per call, and layers memoize by reference: bind to a `const`. Reusing one layer value shares one volume (documented); per-test isolation is `Layer.fresh`.

## Testing and building

Tests in `__test__/`, `@effect/vitest`, `assert.*` never `expect`. Three layers: the adapted #6555 contract suite against `MemoryFileSystem.layer`; the same suite against `@effect/platform-node`'s real filesystem (the differential oracle, `self.int.test.ts` pattern); memory-specific + kit tests (seeding, honest-NotFound, isolation, watch-recursive).

```bash
pnpm vitest run --project @effected/memfs
pnpm build --filter @effected/memfs
```

Never run `node savvy.build.ts --target prod` directly. `savvy.build.ts` carries the narrow `_base` suppression — never widen it. `package.json` stays `"private": true`.
