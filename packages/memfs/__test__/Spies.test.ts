// The `spies` option: void-returning observers that always delegate. A spy
// sees every call as it executes and can never replace one — the intent the
// declining-fault spelling (`return undefined`) only implied.

import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, FileSystem, Layer } from "effect";
import { MemoryFileSystem } from "../src/index.js";
import { denied } from "./helpers.js";

describe("options.spies", () => {
	it.effect("records the real arguments and still performs the call", () => {
		const reads: Array<string> = [];
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString("/a.txt"), "a");
			assert.deepStrictEqual(reads, ["/a.txt"]);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWith({ "/a.txt": "a" }, { spies: { readFile: (path) => void reads.push(path) } }),
			),
		);
	});

	it.effect("a spy's return value is ignored: it can never replace the call", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			// The cast models a handler migrated from a fault map, still returning a replacement.
			assert.strictEqual(yield* fs.readFileString("/a.txt"), "a");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWith(
					{ "/a.txt": "a" },
					{
						spies: {
							readFile: (() => Effect.fail(denied("readFile", "/a.txt"))) as unknown as (path: string) => void,
						},
					},
				),
			),
		),
	);

	it.effect("records at execution time, never when the effect is built", () => {
		const writes: Array<string> = [];
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const write = fs.writeFile("/w.txt", new Uint8Array([1]));
			assert.deepStrictEqual(writes, [], "building the effect records nothing");
			yield* write;
			yield* write;
			assert.deepStrictEqual(writes, ["/w.txt", "/w.txt"], "each execution records once");
		}).pipe(Effect.provide(MemoryFileSystem.layerWith({}, { spies: { writeFile: (path) => void writes.push(path) } })));
	});

	it.effect("propagates into derived members: a writeFile spy also sees writeFileString", () => {
		const writes: Array<string> = [];
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.writeFileString("/s.txt", "s");
			assert.deepStrictEqual(writes, ["/s.txt"]);
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text("/s.txt"), "s");
		}).pipe(Effect.provide(MemoryFileSystem.layerWith({}, { spies: { writeFile: (path) => void writes.push(path) } })));
	});

	it.effect("composes with faults: the spy observes the call, the fault still decides it", () => {
		const seen: Array<string> = [];
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const error = yield* Effect.flip(fs.readFileString("/locked.txt"));
			assert.strictEqual(error.reason._tag, "PermissionDenied");
			assert.strictEqual(yield* fs.readFileString("/open.txt"), "o");
			assert.deepStrictEqual(seen, ["/locked.txt", "/open.txt"]);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWith(
					{ "/locked.txt": "l", "/open.txt": "o" },
					{
						faults: {
							readFile: (path) => (path === "/locked.txt" ? Effect.fail(denied("readFile", path)) : undefined),
						},
						spies: { readFile: (path) => void seen.push(path) },
					},
				),
			),
		);
	});

	it.effect("composes with a transient fault: every attempt is observed", () => {
		let attempts = 0;
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString("/a.txt").pipe(Effect.retry({ times: 3 })), "a");
			assert.strictEqual(attempts, 3);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWith(
					{ "/a.txt": "a" },
					{
						faults: { readFile: MemoryFileSystem.failTimes(2, denied("readFile", "/a.txt")) },
						spies: {
							readFile: () => {
								attempts++;
							},
						},
					},
				),
			),
		);
	});

	it.effect("spies the lazy members when they are called", () => {
		const watched: Array<string> = [];
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			fs.watch("/d");
			assert.deepStrictEqual(watched, ["/d"]);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWith(
					{ "/d": MemoryFileSystem.directory() },
					{ spies: { watch: (path) => void watched.push(path) } },
				),
			),
		);
	});

	it.effect("the seed is written beneath the spies: seeding records nothing", () => {
		const writes: Array<string> = [];
		return Effect.gen(function* () {
			yield* MemoryFileSystem.makeWith(
				{ "/seeded.txt": "x" },
				{ spies: { writeFile: (path) => void writes.push(path) } },
			);
			assert.deepStrictEqual(writes, []);
		});
	});

	it("an unknown spy key is a wiring bug: RangeError at construction", () => {
		assert.throws(
			() =>
				Effect.runSync(
					MemoryFileSystem.makeWith(
						{},
						{ spies: { readFileSting: () => undefined } as unknown as { readFile: () => void } },
					),
				),
			/readFileSting/,
		);
	});

	it.effect("reaches a handle's fileSystem and layer, not its ports or mutators", () => {
		const reads: Array<string> = [];
		return Effect.gen(function* () {
			const handle = yield* MemoryFileSystem.makeHandle(
				{ "/a.txt": "a" },
				{ spies: { readFile: (path) => void reads.push(path) } },
			);
			handle.sync.readFile("/a.txt");
			handle.write("/b.txt", "b");
			assert.deepStrictEqual(reads, []);
			yield* handle.fileSystem.readFile("/a.txt");
			yield* Effect.provide(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					yield* fs.readFile("/b.txt");
				}),
				handle.layer,
			);
			assert.deepStrictEqual(reads, ["/a.txt", "/b.txt"]);
		});
	});

	it.effect("composes with layerFaulty over the spied volume", () => {
		const reads: Array<string> = [];
		const Spied = MemoryFileSystem.layerWith(
			{ "/a.txt": "a" },
			{ spies: { readFile: (path) => void reads.push(path) } },
		);
		return Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* Effect.flip(fs.readFile("/a.txt"));
			assert.deepStrictEqual(reads, [], "the outer fault answered before reaching the spied volume");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerFaulty({ readFile: (path) => Effect.fail(denied("readFile", path)) }).pipe(
					Layer.provide(Spied),
				),
			),
		);
	});
});

describe("a throwing spy is a defect, never a swallowed observation", () => {
	it.effect("on an Effect-returning member the throw becomes a defect and the real call never runs", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const exit = yield* Effect.exit(fs.writeFileString("/w.txt", "w"));
			assert.isTrue(Exit.isFailure(exit));
			assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause), "the spy's throw is a defect");
			assert.isFalse(yield* fs.exists("/w.txt"), "the real call never ran");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWith(
					{},
					{
						spies: {
							writeFile: () => {
								throw new Error("spy exploded");
							},
						},
					},
				),
			),
		),
	);

	it.effect("on stream it propagates synchronously out of the method call", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			assert.throws(() => fs.stream("/a.txt"), /spy exploded/);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWith(
					{ "/a.txt": "a" },
					{
						spies: {
							stream: () => {
								throw new Error("spy exploded");
							},
						},
					},
				),
			),
		),
	);
});
