// AtomicDirectory.write over a real in-memory volume, with faults injected on
// the steps a crash can interrupt.

import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemFaults } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Deferred, Effect, Fiber, Layer, Path, PlatformError } from "effect";
import { AtomicDirectory } from "../src/AtomicDirectory.js";

const ROOT = "/cache/pkg";
const STAGING = "/cache/.pkg.staging";
const OLD = "/cache/.pkg.old";

const volume = (
	seed: Record<string, string | ReturnType<typeof MemoryFileSystem.directory>>,
	faults?: MemoryFileSystemFaults,
) => Layer.merge(MemoryFileSystem.layerWith(seed, faults === undefined ? {} : { faults }), Path.layer);

const failure = (method: string, path: string) =>
	PlatformError.systemError({ _tag: "Unknown", module: "FileSystem", method, pathOrDescriptor: path });

describe("AtomicDirectory.write", () => {
	it.effect("replaces the live tree with exactly the new file set, creating parents", () =>
		Effect.gen(function* () {
			yield* AtomicDirectory.write(
				ROOT,
				new Map<string, string | Uint8Array>([
					["package.json", "{}"],
					["lib/deep/index.d.ts", "export {};"],
					["bin", new Uint8Array([0, 1, 2])],
				]),
			);
			const fs = yield* MemoryFileSystem.Volume;
			assert.deepStrictEqual(fs.paths(), [
				"/cache/pkg/bin",
				"/cache/pkg/lib/deep/index.d.ts",
				"/cache/pkg/package.json",
			]);
			assert.strictEqual(fs.text("/cache/pkg/package.json"), "{}");
			assert.deepStrictEqual(fs.bytes("/cache/pkg/bin"), new Uint8Array([0, 1, 2]));
			assert.isFalse(fs.has(STAGING));
		}).pipe(Effect.provide(volume({ "/cache/pkg/stale.txt": "old", "/cache/pkg/package.json": "old" }))),
	);

	it.effect("an empty file set yields an empty live directory", () =>
		Effect.gen(function* () {
			yield* AtomicDirectory.write(ROOT, []);
			const fs = yield* MemoryFileSystem.Volume;
			assert.deepStrictEqual(fs.readDirectory(ROOT), []);
			assert.isFalse(fs.has(STAGING));
		}).pipe(Effect.provide(volume({ "/cache/pkg/stale.txt": "old" }))),
	);

	it.effect("an empty file set works when the live directory never existed", () =>
		Effect.gen(function* () {
			yield* AtomicDirectory.write(ROOT, []);
			const fs = yield* MemoryFileSystem.Volume;
			assert.deepStrictEqual(fs.readDirectory(ROOT), []);
		}).pipe(Effect.provide(volume({ "/cache": MemoryFileSystem.directory() }))),
	);

	it.effect("clears leftover staging from a prior crash before staging", () =>
		Effect.gen(function* () {
			yield* AtomicDirectory.write(ROOT, [["a.txt", "new"]]);
			const fs = yield* MemoryFileSystem.Volume;
			assert.deepStrictEqual(fs.paths(), ["/cache/pkg/a.txt"]);
			assert.isFalse(fs.has(STAGING));
		}).pipe(Effect.provide(volume({ "/cache/.pkg.staging/leftover.txt": "junk", "/cache/pkg/a.txt": "old" }))),
	);

	it.effect("a failed first rename leaves the live tree untouched", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				AtomicDirectory.write(ROOT, [
					["a.txt", "new"],
					["b/c.txt", "new"],
				]),
			);
			assert.strictEqual(error._tag, "AtomicDirectoryError");
			assert.strictEqual(error.operation, "promote");
			const fs = yield* MemoryFileSystem.Volume;
			assert.deepStrictEqual(fs.paths(), [
				"/cache/.pkg.staging/a.txt",
				"/cache/.pkg.staging/b/c.txt",
				"/cache/pkg/a.txt",
				"/cache/pkg/old.txt",
			]);
			assert.strictEqual(fs.text("/cache/pkg/a.txt"), "old");
		}).pipe(
			Effect.provide(
				volume(
					{ "/cache/pkg/a.txt": "old", "/cache/pkg/old.txt": "old" },
					{ rename: (from) => Effect.fail(failure("rename", from)) },
				),
			),
		),
	);

	it.effect("a crash on the second rename leaves live absent and both trees complete, never partial", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ "/cache/pkg/a.txt": "old", "/cache/pkg/old.txt": "old" });
			const crashing = Layer.merge(
				MemoryFileSystem.layerFaulty({
					rename: (from) => (from === STAGING ? Effect.fail(failure("rename", from)) : undefined),
				}).pipe(Layer.provide(handle.layer)),
				Path.layer,
			);
			const error = yield* Effect.flip(
				AtomicDirectory.write(ROOT, [
					["a.txt", "first"],
					["b/c.txt", "first"],
				]).pipe(Effect.provide(crashing)),
			);
			assert.strictEqual(error.operation, "promote");
			assert.strictEqual(error.path, ROOT);
			assert.isFalse(handle.volume.has(ROOT));
			assert.deepStrictEqual(handle.volume.paths(), [
				"/cache/.pkg.old/a.txt",
				"/cache/.pkg.old/old.txt",
				"/cache/.pkg.staging/a.txt",
				"/cache/.pkg.staging/b/c.txt",
			]);
			assert.strictEqual(handle.volume.text("/cache/.pkg.old/a.txt"), "old");

			yield* AtomicDirectory.write(ROOT, [["a.txt", "second"]]).pipe(
				Effect.provide(Layer.merge(handle.layer, Path.layer)),
			);
			assert.deepStrictEqual(handle.volume.paths(), ["/cache/pkg/a.txt"]);
			assert.strictEqual(handle.volume.text("/cache/pkg/a.txt"), "second");
		}),
	);

	it.effect("the call after a crash between the renames restores the old tree under root before it stages", () =>
		Effect.gen(function* () {
			// A prior run crashed after the first rename: root absent, the old tree whole in .old.
			const handle = yield* MemoryFileSystem.makeHandle({ "/cache/.pkg.old/a.txt": "old" });
			// Fault the staging makeDirectory so this call stops right after its clear step.
			const stalled = Layer.merge(
				MemoryFileSystem.layerFaulty({
					makeDirectory: (dir) => (dir === STAGING ? Effect.fail(failure("makeDirectory", dir)) : undefined),
				}).pipe(Layer.provide(handle.layer)),
				Path.layer,
			);
			const error = yield* Effect.flip(AtomicDirectory.write(ROOT, [["a.txt", "new"]]).pipe(Effect.provide(stalled)));
			assert.strictEqual(error.operation, "stage");
			assert.deepStrictEqual(handle.volume.paths(), ["/cache/pkg/a.txt"], "the old tree is back under root");
			assert.strictEqual(handle.volume.text("/cache/pkg/a.txt"), "old");
		}),
	);

	it.effect("an interrupt cannot land between the two renames", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ "/cache/pkg/a.txt": "old" });
			const gate = yield* Deferred.make<void>();
			const entered = yield* Deferred.make<void>();
			// The second rename waits on a gate the test opens only after interrupting the writer.
			const gated = Layer.merge(
				MemoryFileSystem.layerFaulty((base) => ({
					rename: (from, to) =>
						from === STAGING
							? Effect.andThen(
									Deferred.succeed(entered, undefined),
									Effect.andThen(Deferred.await(gate), base.rename(from, to)),
								)
							: undefined,
				})).pipe(Layer.provide(handle.layer)),
				Path.layer,
			);
			const fiber = yield* Effect.forkChild(
				AtomicDirectory.write(ROOT, [["a.txt", "new"]]).pipe(Effect.provide(gated)),
			);
			yield* Deferred.await(entered);
			const interrupting = yield* Effect.forkChild(Fiber.interrupt(fiber));
			yield* Deferred.succeed(gate, undefined);
			yield* Fiber.join(interrupting);
			assert.strictEqual(handle.volume.text("/cache/pkg/a.txt"), "new", "the promote completed as one unit");
			assert.isFalse(handle.volume.has(STAGING));
		}),
	);

	it.effect("a failed removal of the old tree leaves the new tree live and complete, and the next call clears it", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ "/cache/pkg/a.txt": "old" });
			const crashing = Layer.merge(
				MemoryFileSystem.layerFaulty({
					remove: (path) => (path === OLD && handle.volume.has(OLD) ? Effect.fail(failure("remove", path)) : undefined),
				}).pipe(Layer.provide(handle.layer)),
				Path.layer,
			);
			const error = yield* Effect.flip(
				AtomicDirectory.write(ROOT, [
					["a.txt", "first"],
					["b/c.txt", "first"],
				]).pipe(Effect.provide(crashing)),
			);
			assert.strictEqual(error.operation, "cleanup");
			assert.strictEqual(error.path, OLD);
			assert.deepStrictEqual(handle.volume.paths(), [
				"/cache/.pkg.old/a.txt",
				"/cache/pkg/a.txt",
				"/cache/pkg/b/c.txt",
			]);
			assert.strictEqual(handle.volume.text("/cache/pkg/a.txt"), "first");

			yield* AtomicDirectory.write(ROOT, [["a.txt", "second"]]).pipe(
				Effect.provide(Layer.merge(handle.layer, Path.layer)),
			);
			assert.deepStrictEqual(handle.volume.paths(), ["/cache/pkg/a.txt"]);
			assert.strictEqual(handle.volume.text("/cache/pkg/a.txt"), "second");
		}),
	);

	it.effect("clears a leftover old tree from a prior crash before staging", () =>
		Effect.gen(function* () {
			yield* AtomicDirectory.write(ROOT, [["a.txt", "new"]]);
			const fs = yield* MemoryFileSystem.Volume;
			assert.deepStrictEqual(fs.paths(), ["/cache/pkg/a.txt"]);
		}).pipe(Effect.provide(volume({ "/cache/.pkg.old/leftover.txt": "junk", "/cache/pkg/a.txt": "old" }))),
	);

	it.effect("the old tree leaves the live path whole before it is removed", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ "/cache/pkg/a.txt": "old", "/cache/pkg/b.txt": "old" });
			const removed: Array<string> = [];
			const watching = Layer.merge(
				MemoryFileSystem.layerFaulty({
					remove: (path) => {
						if (handle.volume.has(path)) removed.push(path);
						return undefined;
					},
				}).pipe(Layer.provide(handle.layer)),
				Path.layer,
			);
			yield* AtomicDirectory.write(ROOT, [["a.txt", "new"]]).pipe(Effect.provide(watching));
			assert.deepStrictEqual(removed, [OLD]);
		}),
	);

	it.effect("the next call after a failed first rename recovers", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ "/cache/pkg/a.txt": "old" });
			const crashing = Layer.merge(
				MemoryFileSystem.layerFaulty({ rename: (from) => Effect.fail(failure("rename", from)) }).pipe(
					Layer.provide(handle.layer),
				),
				Path.layer,
			);
			yield* Effect.flip(AtomicDirectory.write(ROOT, [["a.txt", "first"]]).pipe(Effect.provide(crashing)));
			assert.strictEqual(handle.volume.text("/cache/pkg/a.txt"), "old");
			yield* AtomicDirectory.write(ROOT, [["a.txt", "second"]]).pipe(
				Effect.provide(Layer.merge(handle.layer, Path.layer)),
			);
			assert.deepStrictEqual(handle.volume.paths(), ["/cache/pkg/a.txt"]);
			assert.strictEqual(handle.volume.text("/cache/pkg/a.txt"), "second");
		}),
	);

	it.effect("a failed write into staging leaves the live tree untouched", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				AtomicDirectory.write(ROOT, [
					["a.txt", "new"],
					["b.txt", "new"],
				]),
			);
			assert.strictEqual(error.operation, "write");
			assert.strictEqual(error.path, "/cache/.pkg.staging/b.txt");
			const fs = yield* MemoryFileSystem.Volume;
			assert.strictEqual(fs.text("/cache/pkg/a.txt"), "old");
		}).pipe(
			Effect.provide(
				volume(
					{ "/cache/pkg/a.txt": "old" },
					{ writeFile: (path) => (path.endsWith("b.txt") ? Effect.fail(failure("writeFile", path)) : undefined) },
				),
			),
		),
	);

	it.effect("a failure clearing leftover staging is typed as clear", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(AtomicDirectory.write(ROOT, [["a.txt", "new"]]));
			assert.strictEqual(error.operation, "clear");
			assert.strictEqual(error.path, STAGING);
			assert.match(error.message, /^atomic directory clear failed for "\/cache\/\.pkg\.staging"/);
		}).pipe(
			Effect.provide(
				volume(
					{ "/cache/pkg/a.txt": "old" },
					{ remove: (path) => (path === STAGING ? Effect.fail(failure("remove", path)) : undefined) },
				),
			),
		),
	);

	it.effect("a failure creating staging is typed as stage", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(AtomicDirectory.write(ROOT, []));
			assert.strictEqual(error.operation, "stage");
		}).pipe(
			Effect.provide(
				volume(
					{ "/cache/pkg/a.txt": "old" },
					{ makeDirectory: (path) => (path === STAGING ? Effect.fail(failure("makeDirectory", path)) : undefined) },
				),
			),
		),
	);

	for (const bad of ["", "/etc/passwd", "../escape.txt", "a/../../escape.txt", ".", "a/.."]) {
		it.effect(`refuses ${JSON.stringify(bad)} before touching the disk`, () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(
					AtomicDirectory.write(ROOT, [
						["ok.txt", "x"],
						[bad, "x"],
					]),
				);
				assert.strictEqual(error.operation, "validate");
				assert.strictEqual(error.path, bad);
				const fs = yield* MemoryFileSystem.Volume;
				assert.deepStrictEqual(fs.paths(), ["/cache/.pkg.staging/leftover.txt", "/cache/pkg/a.txt"]);
			}).pipe(Effect.provide(volume({ "/cache/pkg/a.txt": "old", "/cache/.pkg.staging/leftover.txt": "junk" }))),
		);
	}

	it.effect("a root ending in . or .. is normalised before its siblings are derived", () =>
		Effect.gen(function* () {
			yield* AtomicDirectory.write("/cache/pkg/sub/..", [["a.txt", "new"]]);
			const fs = yield* MemoryFileSystem.Volume;
			assert.deepStrictEqual(fs.paths(), ["/cache/keep.txt", "/cache/pkg/a.txt"]);
			yield* AtomicDirectory.write("/cache/pkg/./", [["b.txt", "new"]]);
			assert.deepStrictEqual(fs.paths(), ["/cache/keep.txt", "/cache/pkg/b.txt"]);
		}).pipe(Effect.provide(volume({ "/cache/pkg/sub/x.txt": "old", "/cache/keep.txt": "keep" }))),
	);

	for (const bad of [".", "..", "../..", "./"]) {
		it.effect(`refuses the root ${JSON.stringify(bad)} before touching the disk`, () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(AtomicDirectory.write(bad, [["a.txt", "x"]]));
				assert.strictEqual(error.operation, "validate");
				assert.strictEqual(error.path, bad);
				const fs = yield* MemoryFileSystem.Volume;
				assert.deepStrictEqual(fs.paths(), ["/cache/pkg/a.txt"]);
			}).pipe(Effect.provide(volume({ "/cache/pkg/a.txt": "old" }))),
		);
	}

	it.effect("a root with no name of its own is a defect", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(AtomicDirectory.write("/", []));
			assert.isTrue(exit._tag === "Failure");
			if (exit._tag === "Failure") assert.isTrue(exit.cause.reasons.some((reason) => reason._tag === "Die"));
		}).pipe(Effect.provide(volume({}))),
	);
});
