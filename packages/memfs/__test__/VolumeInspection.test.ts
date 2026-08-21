// The volume-inspection kit extension (effected#383): an opt-in second service
// publishing a synchronous, read-only view of the SAME volume backing the
// FileSystem, so write-path tests can assert on what a program wrote without
// routing every assertion through an Effect read.

import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, PlatformError } from "effect";
import { TestClock } from "effect/testing";
import { MemoryFileSystem } from "../src/index.js";

const encoder = new TextEncoder();

const denied = (method: string, path: string) =>
	PlatformError.systemError({
		_tag: "PermissionDenied",
		module: "FileSystem",
		method,
		pathOrDescriptor: path,
	});

describe("MemoryFileSystem.layerInspectable", () => {
	it.effect("THE INVARIANT: within one build, Volume inspects the same volume backing FileSystem", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const volume = yield* MemoryFileSystem.Volume;

			// A write through the FileSystem service is immediately visible to
			// the inspection service — one underlying volume, two views.
			yield* fs.makeDirectory("/managed", { recursive: true });
			yield* fs.writeFileString("/managed/output.txt", "written through fs");
			assert.strictEqual(volume.text("/managed/output.txt"), "written through fs");
			assert.isTrue(volume.has("/managed"));

			// And the view is live, not a copy taken at build: a removal shows.
			yield* fs.remove("/managed/output.txt");
			assert.isUndefined(volume.text("/managed/output.txt"));
			assert.isFalse(volume.has("/managed/output.txt"));
		}).pipe(Effect.provide(MemoryFileSystem.layerInspectable)),
	);

	it.effect("per-build semantics hold — two provides are two volumes, each pair internally consistent", () =>
		Effect.gen(function* () {
			const probe = Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const volume = yield* MemoryFileSystem.Volume;
				// The other build's write must not be here (fresh volume)…
				assert.isFalse(volume.has("/scratch.txt"));
				// …and this build's own write must be (consistent pair).
				yield* fs.writeFileString("/scratch.txt", "mine");
				assert.strictEqual(volume.text("/scratch.txt"), "mine");
			});

			yield* probe.pipe(Effect.provide(MemoryFileSystem.layerInspectable));
			yield* probe.pipe(Effect.provide(MemoryFileSystem.layerInspectable));
		}),
	);

	it.effect("existing constructors are untouched — layerWith provides FileSystem only", () =>
		Effect.gen(function* () {
			// Type-level guard: the un-inspectable layers still annotate exactly
			// as before. Widening any of them would break consumer annotations.
			const plain: Layer.Layer<FileSystem.FileSystem> = MemoryFileSystem.layerWith({ "/seed.txt": "s" });
			const empty: Layer.Layer<FileSystem.FileSystem> = MemoryFileSystem.layer;
			assert.isDefined(plain);
			assert.isDefined(empty);
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString("/seed.txt"), "s");
		}).pipe(Effect.provide(MemoryFileSystem.layerWith({ "/seed.txt": "s" }))),
	);
});

describe("MemoryFileSystem.layerInspectableWith", () => {
	const Seeded = MemoryFileSystem.layerInspectableWith({
		"/repo/package.json": `{ "name": "fixture" }`,
		"/repo/bin/run.sh": MemoryFileSystem.file("#!/bin/sh\n", { mode: 0o755 }),
		"/repo/empty": MemoryFileSystem.directory(),
		"/repo/latest": MemoryFileSystem.symlink("/repo/package.json"),
		"/repo/dangling": MemoryFileSystem.symlink("/repo/absent"),
	});

	it.effect("seed parity with layerWith — every entry kind lands, inspectable and readable", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const volume = yield* MemoryFileSystem.Volume;

			// Seeded files answer through both views.
			assert.strictEqual(volume.text("/repo/package.json"), `{ "name": "fixture" }`);
			assert.strictEqual(yield* fs.readFileString("/repo/package.json"), `{ "name": "fixture" }`);
			assert.strictEqual((yield* fs.stat("/repo/bin/run.sh")).mode & 0o777, 0o755);

			// has(): files, directories and symlinks all count as present —
			// the symlink itself, its target never consulted.
			assert.isTrue(volume.has("/repo/package.json"));
			assert.isTrue(volume.has("/repo/empty"));
			assert.isTrue(volume.has("/repo/latest"));
			assert.isTrue(volume.has("/repo/dangling"));
			assert.isFalse(volume.has("/repo/absent"));

			// The literal view: a symlink has no content of its own (reading
			// THROUGH it is the FileSystem API's job), a directory neither.
			assert.isUndefined(volume.text("/repo/latest"));
			assert.isUndefined(volume.bytes("/repo/empty"));
			assert.strictEqual(yield* fs.readFileString("/repo/latest"), `{ "name": "fixture" }`);
		}).pipe(Effect.provide(Seeded)),
	);

	it.effect("snapshot and paths list regular files only — seeded AND written, sorted, no dirs or symlinks", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const volume = yield* MemoryFileSystem.Volume;

			yield* fs.writeFileString("/repo/written.txt", "later");

			const snapshot = volume.snapshot();
			assert.deepStrictEqual(Object.keys(snapshot).sort(), [
				"/repo/bin/run.sh",
				"/repo/package.json",
				"/repo/written.txt",
			]);
			assert.deepStrictEqual(snapshot["/repo/written.txt"], encoder.encode("later"));

			// paths() is exactly snapshot's key set, sorted lexicographically.
			assert.deepStrictEqual(volume.paths(), ["/repo/bin/run.sh", "/repo/package.json", "/repo/written.txt"]);
		}).pipe(Effect.provide(Seeded)),
	);

	it.effect("honest absence — undefined for absent paths, '' only for a genuinely empty file", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const volume = yield* MemoryFileSystem.Volume;

			// THE #249 CONTRACT, carried to the sync view: absence is undefined,
			// never a fabricated "".
			assert.isUndefined(volume.text("/absent/changesets/config.json"));
			assert.isUndefined(volume.bytes("/absent.bin"));

			// "" round-trips for a real empty file — distinguishable from absent.
			yield* fs.writeFileString("/empty.txt", "");
			assert.strictEqual(volume.text("/empty.txt"), "");
			assert.deepStrictEqual(volume.bytes("/empty.txt"), new Uint8Array());
		}).pipe(Effect.provide(MemoryFileSystem.layerInspectable)),
	);

	it.effect("queries normalize lexically — '//', '.', '..' and relative paths resolve, symlinks stay literal", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const volume = yield* MemoryFileSystem.Volume;
			yield* fs.makeDirectory("/a/b", { recursive: true });
			yield* fs.writeFileString("/a/b/c.txt", "found");

			assert.strictEqual(volume.text("/a//b/./c.txt"), "found");
			assert.strictEqual(volume.text("/a/x/../b/c.txt"), "found");
			// Relative paths resolve from the virtual root, matching the engine.
			assert.strictEqual(volume.text("a/b/c.txt"), "found");
		}).pipe(Effect.provide(MemoryFileSystem.layerInspectable)),
	);

	it.effect("returned byte arrays are defensive copies — mutating them cannot corrupt the volume", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const volume = yield* MemoryFileSystem.Volume;
			yield* fs.writeFileString("/data.bin", "abc");

			const stolen = volume.bytes("/data.bin");
			assert.isDefined(stolen);
			stolen?.fill(0);
			assert.strictEqual(volume.text("/data.bin"), "abc");
			assert.strictEqual(yield* fs.readFileString("/data.bin"), "abc");
		}).pipe(Effect.provide(MemoryFileSystem.layerInspectable)),
	);

	it.effect("a contradictory seed dies — a wiring bug, mirroring layerWith", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.gen(function* () {
					const volume = yield* MemoryFileSystem.Volume;
					return volume.paths();
				}).pipe(Effect.provide(MemoryFileSystem.layerInspectableWith({ "/a": "file", "/a/b": "child" }))),
			);
			assert.isTrue(exit._tag === "Failure");
		}),
	);
});

describe("MemoryFileSystem.makeInspectable", () => {
	it.effect("the value-level pair shares one volume, seeded or bare", () =>
		Effect.gen(function* () {
			const bare = yield* MemoryFileSystem.makeInspectable;
			yield* bare.fileSystem.writeFileString("/direct.txt", "by value");
			assert.strictEqual(bare.volume.text("/direct.txt"), "by value");

			const seeded = yield* MemoryFileSystem.makeInspectableWith({ "/seed.txt": "seeded" });
			assert.strictEqual(seeded.volume.text("/seed.txt"), "seeded");
			// The two pairs are independent volumes.
			assert.isFalse(seeded.volume.has("/direct.txt"));
			assert.isFalse(bare.volume.has("/seed.txt"));
		}),
	);

	it.effect("makeInspectableWith fails typed on a contradictory seed", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MemoryFileSystem.makeInspectableWith({ "/a": "file", "/a/b": "child" }));
			assert.strictEqual(error._tag, "PlatformError");
			assert.strictEqual(error.reason._tag, "AlreadyExists");
		}),
	);
});

describe("inspection composed under fault injection", () => {
	it.effect("delegated writes land in the volume; a faulted write does not", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const volume = yield* MemoryFileSystem.Volume;

			// The delegating branch really writes — the spy pattern's guarantee.
			yield* fs.writeFileString("/allowed.txt", "landed");
			assert.strictEqual(volume.text("/allowed.txt"), "landed");

			// The faulted branch fails typed AND leaves no trace in the volume.
			const error = yield* Effect.flip(fs.writeFileString("/blocked.txt", "never"));
			assert.strictEqual(error.reason._tag, "PermissionDenied");
			assert.isFalse(volume.has("/blocked.txt"));
			assert.deepStrictEqual(volume.paths(), ["/allowed.txt", "/seed.txt"]);
		}).pipe(
			// provideMerge: the decorated FileSystem wins the key; Volume survives.
			Effect.provide(
				MemoryFileSystem.layerFaulty({
					writeFileString: (path) =>
						path === "/blocked.txt" ? Effect.fail(denied("writeFileString", path)) : undefined,
				}).pipe(Layer.provideMerge(MemoryFileSystem.layerInspectableWith({ "/seed.txt": "seeded" }))),
			),
		),
	);
});

describe("the templates-fixture acceptance sketch", () => {
	it.effect("write-then-read-back assertions become vol.text(path)", () =>
		Effect.gen(function* () {
			// The downstream shape: code under test writes a managed file; the
			// test asserts on final content synchronously — previously
			// `fs.files.get(p)` on a hand-rolled Map double.
			const fs = yield* FileSystem.FileSystem;
			const vol = yield* MemoryFileSystem.Volume;

			const path = "/repo/.github/workflows/release.yml";
			yield* fs.makeDirectory("/repo/.github/workflows", { recursive: true });
			yield* fs.writeFileString(path, "# BEGIN managed\njobs: {}\n# END managed\n");

			assert.strictEqual(vol.text(path), "# BEGIN managed\njobs: {}\n# END managed\n");
			assert.isTrue(vol.has("/repo/.github"));
			assert.deepStrictEqual(vol.paths(), [path]);
		}).pipe(Effect.provide(MemoryFileSystem.layerInspectable)),
	);
});

// The sync filesystem port (effected#396 item 1b): the volume exposed through
// the four-operation `node:fs` sync subset, for code that takes an injected
// port instead of requiring `FileSystem` from the environment. Structural
// satisfaction only — this package imports nothing from the kit.
describe("MemoryFileSystem.syncFileSystem", () => {
	const seed = {
		"/repo/package.json": `{ "name": "root" }`,
		"/repo/pnpm-workspace.yaml": "packages:\n  - packages/*\n",
		"/repo/packages": MemoryFileSystem.directory(),
		"/repo/latest": MemoryFileSystem.symlink("/repo/package.json"),
	} as const;

	const withSync = <A>(use: (sync: ReturnType<typeof MemoryFileSystem.syncFileSystem>) => A) =>
		Effect.map(MemoryFileSystem.makeInspectableWith(seed), ({ volume }) =>
			use(MemoryFileSystem.syncFileSystem(volume)),
		);

	it.effect("reads files and lists directories by name, sorted", () =>
		Effect.gen(function* () {
			yield* withSync((sync) => {
				assert.strictEqual(sync.readFile("/repo/package.json"), `{ "name": "root" }`);
				assert.deepStrictEqual(sync.readDirectory("/repo"), [
					"latest",
					"package.json",
					"packages",
					"pnpm-workspace.yaml",
				]);
				assert.isTrue(sync.exists("/repo/package.json"));
				assert.isTrue(sync.isDirectory("/repo/packages"));
				assert.isFalse(sync.isDirectory("/repo/package.json"));
			});
		}),
	);

	it.effect("an empty directory lists [] — never confused with an absent one", () =>
		Effect.gen(function* () {
			yield* withSync((sync) => {
				assert.deepStrictEqual(sync.readDirectory("/repo/packages"), []);
				assert.throws(() => sync.readDirectory("/repo/absent"), /ENOENT/);
			});
		}),
	);

	it.effect('HONEST ABSENCE: an unseeded path throws rather than answering ""', () =>
		Effect.gen(function* () {
			yield* withSync((sync) => {
				assert.isFalse(sync.exists("/repo/absent"));
				assert.throws(() => sync.readFile("/repo/absent"), /ENOENT/);
				// Reading a directory as a file is EISDIR in readFileSync — verified
				// against real node:fs — not ENOTDIR, and certainly not "".
				assert.throws(() => sync.readFile("/repo/packages"), /EISDIR/);
			});
		}),
	);

	it.effect("a symbolic link is listed by its own name and reads through to its target", () =>
		Effect.gen(function* () {
			yield* withSync((sync) => {
				assert.isTrue(sync.exists("/repo/latest"));
				// The PORT follows links even though the view under it is literal:
				// this one points at a file, so it is not a directory but IS readable.
				assert.isFalse(sync.isDirectory("/repo/latest"));
				assert.strictEqual(sync.readFile("/repo/latest"), `{ "name": "root" }`);
			});
		}),
	);

	// THE REGRESSION THIS PORT SHIPPED WITH (caught in review of #445): the view
	// underneath is deliberately literal, and answering literally here made a
	// symlinked package directory invisible to any consumer enumerating a
	// workspace — the exact failure a naive dirent fast path causes, reached
	// through the test double instead. Verified against real node:fs, which
	// resolves all four operations through links.
	it.effect("FOLLOWS LINKS like stat: a link to a directory is a directory and lists its target", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/real/pkg/package.json": `{ "name": "@x/a" }`,
				"/links/pkg": MemoryFileSystem.symlink("/real/pkg"),
			});
			const sync = MemoryFileSystem.syncFileSystem(volume);

			assert.isTrue(sync.isDirectory("/links/pkg"), "a link to a directory must read as a directory");
			assert.deepStrictEqual(sync.readDirectory("/links/pkg"), ["package.json"]);
			assert.strictEqual(sync.readFile("/links/pkg/package.json"), `{ "name": "@x/a" }`);

			// The literal view keeps its own contract underneath, unchanged.
			assert.isFalse(volume.isDirectory("/links/pkg"));
			assert.strictEqual(volume.readLink("/links/pkg"), "/real/pkg");
		}),
	);

	it.effect("a dangling link is ABSENT to the port, though the literal view still sees it", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/dangling": MemoryFileSystem.symlink("/nowhere"),
			});
			const sync = MemoryFileSystem.syncFileSystem(volume);

			// existsSync answers false for a dangling link; the port matches it.
			assert.isFalse(sync.exists("/dangling"));
			assert.isFalse(sync.isDirectory("/dangling"));
			assert.throws(() => sync.readFile("/dangling"), /ENOENT/);
			// …while the view, being literal, reports the link itself as present.
			assert.isTrue(volume.has("/dangling"));
		}),
	);

	it.effect("a relative link target resolves against the link's own directory", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/a/b/target.txt": "found",
				"/a/b/rel": MemoryFileSystem.symlink("target.txt"),
			});
			const sync = MemoryFileSystem.syncFileSystem(volume);
			assert.strictEqual(sync.readFile("/a/b/rel"), "found");
		}),
	);

	it.effect("a link cycle resolves to absence rather than spinning", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/loop/a": MemoryFileSystem.symlink("/loop/b"),
				"/loop/b": MemoryFileSystem.symlink("/loop/a"),
			});
			const sync = MemoryFileSystem.syncFileSystem(volume);
			assert.isFalse(sync.exists("/loop/a"));
			assert.throws(() => sync.readFile("/loop/a"), /ENOENT/);
		}),
	);

	it.effect("the virtual root lists its top-level entries", () =>
		Effect.gen(function* () {
			yield* withSync((sync) => {
				// "/" must not build the prefix "//", which would match nothing.
				assert.include(sync.readDirectory("/"), "repo");
				assert.isTrue(sync.isDirectory("/"));
			});
		}),
	);

	it.effect("thrown absence carries the node:fs errno fields a port consumer may inspect", () =>
		Effect.gen(function* () {
			yield* withSync((sync) => {
				try {
					sync.readFile("/repo/absent");
					assert.fail("readFile should have thrown on an unseeded path");
				} catch (error) {
					assert.strictEqual((error as { code?: string }).code, "ENOENT");
					assert.strictEqual((error as { syscall?: string }).syscall, "readFile");
					assert.strictEqual((error as { path?: string }).path, "/repo/absent");
				}
			});
		}),
	);
});

// Modification time on the inspection view (effected#396 item 6): the piece a
// signature-diff test needs — "this file changed and that one did not" —
// expressible in a seed and readable synchronously.
describe("MemoryFileSystemVolume.mtime", () => {
	it.effect("a seeded mtime is readable, and distinct files keep distinct times", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/pkg/src/old.ts": MemoryFileSystem.file("old", { mtime: 1_000 }),
				"/pkg/src/new.ts": MemoryFileSystem.file("new", { mtime: 9_000 }),
			});
			assert.strictEqual(volume.mtime("/pkg/src/old.ts"), 1_000);
			assert.strictEqual(volume.mtime("/pkg/src/new.ts"), 9_000);
		}),
	);

	it.effect("HONEST ABSENCE: an absent path is undefined, never a 1970 timestamp", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/epoch.txt": MemoryFileSystem.file("at the epoch", { mtime: 0 }),
			});
			// 0 is a REAL modification time. A signature over mtimes must be able to
			// tell it apart from a file that is not there at all — conflating them
			// is the silent-green this contract exists to prevent.
			assert.strictEqual(volume.mtime("/epoch.txt"), 0);
			assert.strictEqual(volume.mtime("/absent.txt"), undefined);
		}),
	);

	it.effect("a write restamps the entry from the Effect Clock — which under test starts at the epoch", () =>
		Effect.gen(function* () {
			const { fileSystem, volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/tracked.txt": MemoryFileSystem.file("before", { mtime: 1_000 }),
			});
			assert.strictEqual(volume.mtime("/tracked.txt"), 1_000);

			// The volume stamps writes from the Effect `Clock`, not `Date.now()`.
			// That is what makes mtime drivable — but it also means the default
			// test clock sits at the EPOCH, so a write reads as 0 and a seeded
			// 1_000 looks like the FUTURE. A signature test that assumes writes
			// move time forward is a false green waiting to happen.
			yield* fileSystem.writeFileString("/tracked.txt", "after");
			assert.strictEqual(volume.mtime("/tracked.txt"), 0);

			// Advance the clock and the next write lands where it was moved to.
			yield* TestClock.adjust("5 seconds");
			yield* fileSystem.writeFileString("/tracked.txt", "later");
			assert.strictEqual(volume.mtime("/tracked.txt"), 5_000);
		}),
	);

	it.effect("utimes through the FileSystem is visible to the view", () =>
		Effect.gen(function* () {
			const { fileSystem, volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/a.txt": "contents",
			});
			// `utimes` reads a NUMBER as Unix seconds, so 5_000 there means
			// 5_000_000 ms — the unit trap the seed option converts away from.
			yield* fileSystem.utimes("/a.txt", 5_000, 5_000);
			assert.strictEqual(volume.mtime("/a.txt"), 5_000_000);
			// A Date is unambiguous and round-trips in milliseconds.
			const stamp = new Date(1_234_567);
			yield* fileSystem.utimes("/a.txt", stamp, stamp);
			assert.strictEqual(volume.mtime("/a.txt"), 1_234_567);
		}),
	);

	it.effect("mtime agrees with what stat reports through the FileSystem", () =>
		Effect.gen(function* () {
			const { fileSystem, volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/a.txt": MemoryFileSystem.file("contents", { mtime: 4_242 }),
			});
			const info = yield* fileSystem.stat("/a.txt");
			// One clock, two views — the sync accessor must not drift from `stat`.
			const fromStat = Option.getOrThrow(info.mtime).getTime();
			assert.strictEqual(volume.mtime("/a.txt"), fromStat);
		}),
	);

	it.effect("directories carry an mtime too", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/dir": MemoryFileSystem.directory(),
			});
			assert.isDefined(volume.mtime("/dir"));
		}),
	);
});
