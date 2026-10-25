// The `layerWithPath` companions: `FileSystem` and `Path` are almost always
// consumed together, so each filesystem layer has a twin that merges core's
// `Path.layer` in rather than leaving every call site to spell the merge.

import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";
import { MemoryFileSystem } from "../src/index.js";
import { NodeSyncFileSystem } from "../src/NodeSyncFileSystem.js";

const Seeded = MemoryFileSystem.layerWithPath({ "/repo/a.txt": "a" });

describe("MemoryFileSystem.layerWithPath", () => {
	it.effect("provides FileSystem, Path and Volume over one seeded volume", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const volume = yield* MemoryFileSystem.Volume;
			const file = path.join("/repo", "a.txt");
			assert.strictEqual(yield* fs.readFileString(file), "a");
			yield* fs.writeFileString(path.join("/repo", "b.txt"), "b");
			assert.strictEqual(volume.text("/repo/b.txt"), "b");
		}).pipe(Effect.provide(Seeded)),
	);

	it.effect("takes the same options as layerWith (root, faults)", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			assert.strictEqual(yield* fs.readFileString(path.join("/ws", "x.txt")), "x");
			assert.isTrue(yield* fs.exists("/ws"));
		}).pipe(Effect.provide(MemoryFileSystem.layerWithPath({ "x.txt": "x" }, { root: "/ws" }))),
	);

	it.effect("with no arguments is the empty volume", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const error = yield* Effect.flip(fs.readFileString("/anything"));
			assert.strictEqual(error.reason._tag, "NotFound");
			assert.strictEqual((yield* Path.Path).sep, "/");
		}).pipe(Effect.provide(MemoryFileSystem.layerWithPath())),
	);
});

describe("NodeSyncFileSystem.layerWithPath", () => {
	it("provides the read-only node filesystem and Path, under Effect.runSync", () => {
		const text = Effect.runSync(
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				return yield* fs.readFileString(path.join(import.meta.dirname, "..", "package.json"));
			}).pipe(Effect.provide(NodeSyncFileSystem.layerWithPath)),
		);
		assert.strictEqual(JSON.parse(text).name, "@effected/memfs");
	});
});
