# `@effected/memfs` — picking the form, seeding, faults and traps

Loaded from `effect-v4-testing`. The case: a test needs a filesystem. The
house rule is `@effected/memfs`, never `FileSystem.layerNoop` or a hand-rolled
port stub — the volume implements the whole service and answers an unseeded
path with a typed `NotFound`, where a stub answering `""` ships a silent false
green. This file is about using it well: which constructor, where the
assertion runs, how to fault it, and the traps that make a memfs test lie.

## Pick the form by where you assert

| Situation | Form |
| --- | --- |
| Assert inside the Effect under test | `MemoryFileSystem.layerWith(seed, options)` + `yield* MemoryFileSystem.Volume` |
| Assert after the run, or across several programs | `MemoryFileSystem.makeHandle(seed, options)` (in `Effect`) or `MemoryFileSystem.makeSync(seed, options)` (at describe scope), provide `handle.layer`, assert on `handle.volume` |
| Code takes an injected sync `node:fs` port | `handle.sync` (or `MemoryFileSystem.syncFileSystem(volume)`) |
| Code takes an injected async `fs/promises` walker | `handle.promises` (or `MemoryFileSystem.promisesFileSystem(volume)`) |
| A failure mid-run | `options.faults` on any seeded constructor; `handle.withFaults` for the ports |
| Code must read the REAL disk under `Effect.runSync` | `NodeSyncFileSystem.layer` from `@effected/memfs/node-sync` — production code, not a double |

Every memory layer (`layer`, `layerWith`, `handle.layer`) publishes
`MemoryFileSystem.Volume` beside `FileSystem`, so there is no separate
"inspectable" constructor to remember. The extra service is harmless where only
`FileSystem` is needed: a layer providing more is still assignable to
`Layer.Layer<FileSystem.FileSystem>`.

Assert inside the program — resolve `Volume` under the SAME provide the code
runs under:

```ts
import { MemoryFileSystem } from "@effected/memfs";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

const Volume = MemoryFileSystem.layerWith({ "/a.txt": "a" });

it.effect("writes b next to a", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString("/b.txt", "b");
    const volume = yield* MemoryFileSystem.Volume;
    assert.deepStrictEqual(volume.paths(), ["/a.txt", "/b.txt"]);
  }).pipe(Effect.provide(Volume)),
);
```

Assert after the run — the handle pins ONE volume, and `handle.layer` is
stable across provides:

```ts
import { MemoryFileSystem } from "@effected/memfs";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";

it.effect("two programs, one volume", () =>
  Effect.gen(function* () {
    const handle = yield* MemoryFileSystem.makeHandle();
    yield* Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString("/w.txt", "w");
    }).pipe(Effect.provide(handle.layer));
    assert.strictEqual(handle.volume.text("/w.txt"), "w"); // the SAME volume the program wrote to
  }),
);
```

`makeSync` is the same handle built synchronously — the form for a Promise-style
suite that builds its fixture at `describe` scope and never imports `Effect`
beyond what the code under test needs. It runs on the real clock, so its writes
do not follow `TestClock`.

The ports serve code that takes an injected filesystem instead of requiring
`FileSystem`. An async walker adapter over `handle.promises` is one line per
member (from a real adoption):

```ts
import { MemoryFileSystem } from "@effected/memfs";

const handle = MemoryFileSystem.makeSync({ "src/a.ts": "" }, { root: "/ws/repo" });
const walker = {
  readDirectory: (dir: string) => handle.promises.readdir(dir, { withFileTypes: true }),
  statEntry: (path: string) => handle.promises.stat(path),
};
const entries = await walker.readDirectory("/ws/repo/src"); // hand `walker` to the code under test
```

Port members are standalone functions, not methods: pass `handle.sync.readFile`
as a callback without binding. The promises `readFile` has node's overloads —
bytes without an encoding, a string with `"utf8"` — so pass the encoding when
the code under test expects text.

## Seeds

A seed maps paths to entries: `string`/`Uint8Array` file contents, or the
tagged `MemoryFileSystem.file(content, { mode, mtime })`,
`MemoryFileSystem.directory()` (the only way to express an EMPTY directory)
and `MemoryFileSystem.symlink(target)` (stored verbatim; may dangle). Parents
are created for you.

With `options.root`, keys are relative to it and `""` is the root itself; the
root exists even for an empty seed. The root is a **join base, not a jail**:
keys join it lexically, as `path.posix.join` does, so a sibling of the
workspace stays declarative:

```ts
import { MemoryFileSystem } from "@effected/memfs";

const handle = MemoryFileSystem.makeSync(
  { "package.json": "{}", "../extra-dir/__test__/index.test.ts": "" },
  { root: "/ws/repo" },
);
handle.volume.paths(); // ["/ws/extra-dir/__test__/index.test.ts", "/ws/repo/package.json"]
```

A relative root, or an absolute key alongside a root, is a typed `BadArgument`
naming the value (`makeSync` throws `EINVAL` with it in the path slot). A
contradictory seed dies inside `layerWith` — a wiring bug — while `makeWith`
and `makeHandle` keep it typed. When code under test caches by root path, give
each test its own root (`/ws-1/repo`, `/ws-2/repo`): two tests seeding the same
tree at the same path produce identical signatures.

## Mutating between calls

The handle's `write`, `mkdir`, `remove` and `symlink` are synchronous setup
mutators. A relative path joins `handle.root` (or `/` without one); for
`symlink` only the link's own path joins — the target text is stored verbatim.
They throw node's error (`code`, `syscall`, and the path you passed), never a
`FiberFailure`:

```ts
import { MemoryFileSystem } from "@effected/memfs";

const handle = MemoryFileSystem.makeSync({ "a.ts": "x" }, { root: "/r" });
handle.write("rel.ts", "y"); // lands at /r/rel.ts
handle.mkdir("sub/deep");
handle.symlink("../target/text", "sub/link"); // link at /r/sub/link, target verbatim
handle.remove("rel.ts");
```

A missing parent is created; a parent that is a file makes `write` fail
`ENOTDIR` (as `writeFileSync` does), while `mkdir` over a file fails `EEXIST`.
A parent that is a dangling link fails `ENOENT`, a looping one `ELOOP` — never
a directory made over the link.

## Faults

Inject misbehaviour as a fault on the real volume, never as a stub body.
`options.faults` wraps the built `FileSystem` delegate-by-default: a handler
gets the real arguments, returns a replacement `Effect`, or returns
`undefined` to let the call through. The seed lands beneath the faults and
`Volume` inspects the raw volume, so a test can inject a failure and still
assert on what landed:

```ts
import { MemoryFileSystem } from "@effected/memfs";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, PlatformError } from "effect";

const denied = (path: string) =>
  PlatformError.systemError({ _tag: "PermissionDenied", module: "FileSystem", method: "writeFile", pathOrDescriptor: path });

const Locked = MemoryFileSystem.layerWith(
  { "/locked-seed.txt": "seeded" },
  { faults: { writeFile: (path) => (path.startsWith("/locked") ? Effect.fail(denied(path)) : undefined) } },
);

it.effect("a denied write never lands", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const error = yield* Effect.flip(fs.writeFileString("/locked.txt", "x"));
    assert.strictEqual(error.reason._tag, "PermissionDenied");
    const volume = yield* MemoryFileSystem.Volume;
    assert.isUndefined(volume.text("/locked.txt"));
    assert.strictEqual(volume.text("/locked-seed.txt"), "seeded");
  }).pipe(Effect.provide(Locked)),
);
```

`MemoryFileSystem.failTimes(n, error)` fails `n` executions then delegates (so
`Effect.retry` outlasts it). `MemoryFileSystem.die(defect)` fails a member as a
**defect**, which a caller's `Effect.catch` cannot absorb — the shape
`FileSystem.layerNoop` gives its `make*` members; inject a typed
`Effect.fail(...)` when the code is supposed to recover, `die` when it must
not. A factory `(base) => faults` receives the unfaulted filesystem, so a
handler can rewrite arguments and delegate without re-entering its own fault.
`MemoryFileSystem.layerFaulty(faults)` / `makeFaulty(base, faults)` apply the
same injection to ANY `FileSystem` (the node adapter, a hand-built double).

**A fault key that names no member throws `RangeError` at construction** (a
layer build dies), naming the key — so a typo like `readFileSting` fails the
test instead of leaving the fault silently unarmed.

`options.faults` never reaches the handle's ports. Fault a port with
`handle.withFaults({ sync, promises })`, which returns faulted ports over the
same volume; throw an errno built with `MemoryFileSystem.errno` — a handler
that throws on the promises port REJECTS, as `fs/promises` does:

```ts
import { MemoryFileSystem } from "@effected/memfs";

const handle = MemoryFileSystem.makeSync({ "/r/file.txt": "hello", "/r/dir/inner.txt": "x" });
const { sync } = handle.withFaults({
  sync: {
    readFile: (path) => {
      if (path.endsWith("file.txt")) throw MemoryFileSystem.errno("EACCES", "open", path);
      return undefined; // every other path delegates
    },
  },
});
sync.readFile("/r/dir/inner.txt"); // "x"
```

Never hand-throw `Object.assign(new Error(...), { code })` from a port stub:
`MemoryFileSystem.errno` builds node's exact error, message and all.

## Case-insensitive volumes

The default is case-sensitive, so a test for code that must survive default
APFS or NTFS passes on memfs while the real bug ships. When the code under test
probes, lists or compares paths that a user could spell differently, build the
volume with `caseSensitive: false`:

```ts
import { MemoryFileSystem } from "@effected/memfs";
import { assert, it } from "@effect/vitest";
import { Effect } from "effect";

it.effect("any spelling finds the stored entry", () =>
  Effect.gen(function* () {
    const { volume } = yield* MemoryFileSystem.makeHandle({ "/Repo/Docs.json": "{}" }, { caseSensitive: false });
    assert.strictEqual(volume.text("/repo/docs.JSON"), "{}");
    assert.deepStrictEqual(volume.readDirectory("/repo"), ["Docs.json"]); // stored spelling
  }),
);
```

The semantics were measured on a real APFS volume. The two that surprise:
`realPath` keeps the **queried** spelling (only a link's target text supplies
its own), exactly as the node adapter's `realPath` does — never assert that it
canonicalizes; and rename/`copyFile` onto a differently-cased entry keep the
stored spelling while `copy` takes the requested one. Folding is `toLowerCase`
per UTF-16 unit with no Unicode normalization.

## Traps

- **Every provide re-seeds.** `Effect.provide(program, Volume)` then
  `Effect.provide(MemoryFileSystem.Volume, Volume)` inspects a FRESH volume
  holding only the seed, so "nothing was written" passes vacuously. Assert
  inside the one provide, or use a handle and its pinned `layer`.
- **The view is literal; the ports follow links.** `volume.isDirectory` on a
  link to a directory is `false`, and `volume.has("/link/child")` is `false`
  even when the target holds `child` — the view never follows a link, not even
  mid-path. `handle.sync.isDirectory` follows it. Assert with the surface the
  code under test uses.
- **Mutator `..` resolves after links; seed keys do not.** A seed key is data
  and joins lexically. A mutator path is a filesystem call: with `/r/link` →
  `/elsewhere/dir`, `handle.write("link/../x")` lands at `/elsewhere/x`, as the
  host does.
- **mtime units.** `file(content, { mtime })` takes epoch **milliseconds**;
  `FileSystem.utimes` reads a bare number as **seconds** — pass a `Date`. Writes
  stamp the Effect `Clock`, so under `it.effect` a written file reads as `0`
  until `TestClock` advances.
- **`failTimes` under `layer(...)`.** A suite-boundary `layer(...)` builds once,
  so a transient fault declared there is consumed by the first test and every
  later test sees it exhausted. Declare it per test.
- **A faulted path must exist in the seed — when the consumer absorbs the
  failure.** A `PermissionDenied` fault is distinguishable from an unseeded
  path's `NotFound`/`false` only if the code under test surfaces it. Code that
  folds every probe failure into "absent" (a discovery walk, an upward search)
  answers the same with the fault armed or disarmed on an unseeded path, so the
  test cannot tell whether the fault fired. There, seed the denied path as a
  real file so disarming the fault visibly changes the answer. Either way,
  mutation-check by disarming the fault.

## What the volume cannot see

memfs implements Effect's `FileSystem` service and nothing else: no hooks, no
module patching. Code importing `node:fs` directly reads the real disk; a
spawned child process gets the real disk; a native binding (SQLite) never
touches the service; and the platform is the host's — code reading
`process.platform` (such as `@effected/xdg`'s `AppDirs`, through its
`CurrentPlatform` reference) still takes the host's branch unless the test pins
it (`Effect.provideService(CurrentPlatform, "linux")`). Relative paths resolve
from `/`: the volume models no cwd.

**A database layer is the sharpest case.** `@effected/store`'s `Store`/`Cache`
and `@effected/app`'s `AppStore`/`AppCache` open their file through
`node:sqlite`, which writes to the HOST disk whatever `FileSystem` is
provided. Two shapes follow:

- **Unit-testing the glue** (path guards, `location`, `subdir` creation): give
  memfs a `makeDirectory` fault of `MemoryFileSystem.die(...)`, so construction
  stops at `ensure*` before the binding could open a file on the host, and
  assert that the defect is not the one under test. `AppStore.location`
  creates nothing and needs only `AppDirs` and `Path`, so it runs over memfs
  untouched.
- **Testing the database end to end**: run against a temp-directory `HOME`
  (`mkdtemp`) on the real filesystem, drive the XDG variables through
  `ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME, XDG_STATE_HOME, … }))`
  rather than mutating `process.env`, and remove the directory in an
  `Effect.ensuring`. Assert on the file existing at the expected path, not on
  an echoed option.

`@effected/memfs/node-sync` is the one module that touches the real disk: a
read-only synchronous `FileSystem` whose read members agree with
`NodeFileSystem` value for value, and whose every other member is a **defect**,
not a typed failure — a program that tries to write under it has a wiring bug.
