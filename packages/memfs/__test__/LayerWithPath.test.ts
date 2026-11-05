// The `layerWithPath` companions: `FileSystem` and `Path` are almost always
// consumed together, so each filesystem layer has a twin that merges core's
// `Path.layer` in rather than leaving every call site to spell the merge.

import * as NodePathModule from "node:path";
import { NodePath } from "@effect/platform-node";
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

describe("NodeSyncFileSystem.layerWithPath's Path is the host's", () => {
	const hostPath = Effect.gen(function* () {
		return yield* Path.Path;
	}).pipe(Effect.provide(NodeSyncFileSystem.layerWithPath));
	const corePath = Effect.gen(function* () {
		return yield* Path.Path;
	}).pipe(Effect.provide(Path.layer));

	it.effect("is not core's POSIX implementation", () =>
		Effect.gen(function* () {
			const host = yield* hostPath;
			const core = yield* corePath;
			assert.notStrictEqual(host.join, core.join);
			assert.notStrictEqual(host.resolve, core.resolve);
		}),
	);

	it.effect("sep, join and resolve equal node:path's", () =>
		Effect.gen(function* () {
			const host = yield* hostPath;
			assert.strictEqual(host.sep, NodePathModule.sep);
			assert.strictEqual(host.join("a", "..", "b", "c.txt"), NodePathModule.join("a", "..", "b", "c.txt"));
			assert.strictEqual(host.resolve("x", "y"), NodePathModule.resolve("x", "y"));
			assert.strictEqual(host.resolve("/a", "../b"), NodePathModule.resolve("/a", "../b"));
		}),
	);

	it.effect("toFileUrl and fromFileUrl round-trip", () =>
		Effect.gen(function* () {
			const host = yield* hostPath;
			const abs = NodePathModule.resolve("some dir", "a b.txt");
			const url = yield* host.toFileUrl(abs);
			assert.strictEqual(url.protocol, "file:");
			assert.strictEqual(yield* host.fromFileUrl(url), abs);
		}),
	);

	it.effect("a non-file URL fails fromFileUrl as BadArgument", () =>
		Effect.gen(function* () {
			const host = yield* hostPath;
			const error = yield* Effect.flip(host.fromFileUrl(new URL("https://example.com/a")));
			assert.strictEqual(error._tag, "BadArgument");
			assert.strictEqual(error.module, "Path");
			assert.strictEqual(error.method, "fromFileUrl");
		}),
	);

	it.effect("a relative path resolves against the cwd, as the platform's Path does", () =>
		Effect.gen(function* () {
			const host = yield* hostPath;
			const url = yield* host.toFileUrl("relative/path");
			assert.strictEqual(yield* host.fromFileUrl(url), NodePathModule.resolve("relative/path"));
		}),
	);

	it.effect("agrees with NodePath.layer on every member for the same inputs", () =>
		Effect.gen(function* () {
			const host = yield* hostPath;
			const oracle = yield* Effect.gen(function* () {
				return yield* Path.Path;
			}).pipe(Effect.provide(NodePath.layer));
			const abs = NodePathModule.resolve("/tmp", "q.txt");
			assert.strictEqual(host.sep, oracle.sep);
			assert.strictEqual(host.basename("/a/b.txt", ".txt"), oracle.basename("/a/b.txt", ".txt"));
			assert.strictEqual(host.dirname("/a/b.txt"), oracle.dirname("/a/b.txt"));
			assert.strictEqual(host.extname("b.tar.gz"), oracle.extname("b.tar.gz"));
			assert.strictEqual(host.isAbsolute("/a"), oracle.isAbsolute("/a"));
			assert.strictEqual(host.normalize("/a/./b/../c"), oracle.normalize("/a/./b/../c"));
			assert.deepStrictEqual(host.parse("/a/b.txt"), oracle.parse("/a/b.txt"));
			assert.strictEqual(host.relative("/a/b", "/a/c/d"), oracle.relative("/a/b", "/a/c/d"));
			assert.strictEqual(host.resolve("r", "s"), oracle.resolve("r", "s"));
			assert.strictEqual(host.toNamespacedPath("/a"), oracle.toNamespacedPath("/a"));
			assert.strictEqual((yield* host.toFileUrl(abs)).href, (yield* oracle.toFileUrl(abs)).href);
			assert.deepStrictEqual(host.resolveWithin("/root", "a/b"), oracle.resolveWithin("/root", "a/b"));
		}),
	);
});
