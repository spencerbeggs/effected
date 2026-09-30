import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, FileSystem } from "effect";
import { MemoryFileSystem } from "../src/index.js";

describe("seed options: root", () => {
	it.effect("re-keys relative seed keys under root", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeHandle(
				{ "package.json": "{}", "src/a.test.ts": "" },
				{ root: "/ws-1/repo" },
			);
			assert.deepStrictEqual(volume.paths(), ["/ws-1/repo/package.json", "/ws-1/repo/src/a.test.ts"]);
		}),
	);

	it.effect("creates the root even when the seed is empty", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeHandle({}, { root: "/pkg" });
			assert.isTrue(volume.isDirectory("/pkg"));
			assert.deepStrictEqual(volume.readDirectory("/pkg"), []);
		}),
	);

	it.effect("the empty key addresses the root itself", () =>
		Effect.gen(function* () {
			const { fileSystem, volume } = yield* MemoryFileSystem.makeHandle(
				{ "": MemoryFileSystem.directory({ mode: 0o700 }) },
				{ root: "/pkg" },
			);
			assert.isTrue(volume.isDirectory("/pkg"));
			const info = yield* fileSystem.stat("/pkg");
			assert.strictEqual(info.mode & 0o777, 0o700);
		}),
	);

	it.effect("a relative key escaping the root is a typed BadArgument naming key and root", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MemoryFileSystem.makeWith({ "../etc/x": "" }, { root: "/ws" }));
			assert.strictEqual(error.reason._tag, "BadArgument");
			assert.include(error.reason.message, "../etc/x");
			assert.include(error.reason.message, "/ws");
		}),
	);

	it.effect("a key that dips out and back into the root is allowed", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeHandle({ "../ws/x.txt": "1" }, { root: "/ws" });
			assert.deepStrictEqual(volume.paths(), ["/ws/x.txt"]);
		}),
	);

	it.effect("layerWith forwards options to the Volume", () =>
		Effect.gen(function* () {
			const volume = yield* MemoryFileSystem.Volume;
			assert.deepStrictEqual(volume.paths(), ["/ws/a.txt"]);
		}).pipe(Effect.provide(MemoryFileSystem.layerWith({ "a.txt": "x" }, { root: "/ws" }))),
	);

	it.effect("layerWith forwards options alongside faults", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString("/ws/a.txt"), "x");
		}).pipe(Effect.provide(MemoryFileSystem.layerWith({ "a.txt": "x" }, { root: "/ws", faults: {} }))),
	);

	it.effect("normalizes a root with a trailing slash or dot-dot", () =>
		Effect.gen(function* () {
			const a = yield* MemoryFileSystem.makeHandle({ "x.txt": "1" }, { root: "/ws/" });
			const b = yield* MemoryFileSystem.makeHandle({ "x.txt": "1" }, { root: "/ws/../ws" });
			assert.deepStrictEqual(a.volume.paths(), ["/ws/x.txt"]);
			assert.deepStrictEqual(b.volume.paths(), ["/ws/x.txt"]);
		}),
	);

	it.effect("an absolute key with a root is a typed BadArgument", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MemoryFileSystem.makeWith({ "/abs.txt": "" }, { root: "/ws" }));
			assert.strictEqual(error.reason._tag, "BadArgument");
		}),
	);

	it.effect("a relative root is a typed BadArgument", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(MemoryFileSystem.makeWith({ a: "" }, { root: "ws" }));
			assert.strictEqual(error.reason._tag, "BadArgument");
		}),
	);

	it.effect("layerWith dies on a bad root (wiring-bug posture)", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				Effect.provide(
					Effect.gen(function* () {
						return yield* FileSystem.FileSystem;
					}),
					MemoryFileSystem.layerWith({ "/a": "" }, { root: "/ws" }),
				),
			);
			assert.isTrue(Exit.isFailure(exit) && Cause.hasDies(exit.cause));
		}),
	);

	it.effect("without options, behaviour is unchanged", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeHandle({ "/a/b.txt": "x" });
			assert.deepStrictEqual(volume.paths(), ["/a/b.txt"]);
		}),
	);
});
