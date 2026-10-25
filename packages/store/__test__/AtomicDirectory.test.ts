// AtomicDirectory.write over a real in-memory volume, with faults injected on
// the steps a crash can interrupt.

import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemFaults } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path, PlatformError } from "effect";
import { AtomicDirectory } from "../src/AtomicDirectory.js";

const ROOT = "/cache/pkg";
const STAGING = "/cache/.pkg.staging";

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

	it.effect("a crash between remove and rename leaves live absent, never half-written", () =>
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
			assert.isFalse(fs.has(ROOT));
			assert.deepStrictEqual(fs.paths(), ["/cache/.pkg.staging/a.txt", "/cache/.pkg.staging/b/c.txt"]);
		}).pipe(
			Effect.provide(
				volume(
					{ "/cache/pkg/a.txt": "old", "/cache/pkg/old.txt": "old" },
					{ rename: (from) => Effect.fail(failure("rename", from)) },
				),
			),
		),
	);

	it.effect("the next call after a crashed promotion recovers", () =>
		Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle({ "/cache/pkg/a.txt": "old" });
			const crashing = Layer.merge(
				MemoryFileSystem.layerFaulty({ rename: (from) => Effect.fail(failure("rename", from)) }).pipe(
					Layer.provide(handle.layer),
				),
				Path.layer,
			);
			yield* Effect.flip(AtomicDirectory.write(ROOT, [["a.txt", "first"]]).pipe(Effect.provide(crashing)));
			assert.isFalse(handle.volume.has(ROOT));
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

	it.effect("a root with no name of its own is a defect", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(AtomicDirectory.write("/", []));
			assert.isTrue(exit._tag === "Failure");
			if (exit._tag === "Failure") assert.isTrue(exit.cause.reasons.some((reason) => reason._tag === "Die"));
		}).pipe(Effect.provide(volume({}))),
	);
});
