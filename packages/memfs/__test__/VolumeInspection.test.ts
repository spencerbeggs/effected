// The volume-inspection kit extension (effected#383): an opt-in second service
// publishing a synchronous, read-only view of the SAME volume backing the
// FileSystem, so write-path tests can assert on what a program wrote without
// routing every assertion through an Effect read.

import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, PlatformError } from "effect";
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
