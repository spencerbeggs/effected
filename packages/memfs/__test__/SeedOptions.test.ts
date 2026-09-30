import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, FileSystem } from "effect";
import { MemoryFileSystem } from "../src/index.js";

describe("seed options: root", () => {
	it.effect("re-keys relative seed keys under root", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(
				{ "package.json": "{}", "src/a.test.ts": "" },
				{ root: "/ws-1/repo" },
			);
			assert.deepStrictEqual(volume.paths(), ["/ws-1/repo/package.json", "/ws-1/repo/src/a.test.ts"]);
		}),
	);

	it.effect("creates the root even when the seed is empty", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({}, { root: "/pkg" });
			assert.isTrue(volume.isDirectory("/pkg"));
			assert.deepStrictEqual(volume.readDirectory("/pkg"), []);
		}),
	);

	it.effect("the empty key addresses the root itself", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith(
				{ "": MemoryFileSystem.directory({ mode: 0o700 }) },
				{ root: "/pkg" },
			);
			assert.isTrue(volume.isDirectory("/pkg"));
		}),
	);

	it.effect("normalizes a root with a trailing slash or dot-dot", () =>
		Effect.gen(function* () {
			const a = yield* MemoryFileSystem.makeInspectableWith({ "x.txt": "1" }, { root: "/ws/" });
			const b = yield* MemoryFileSystem.makeInspectableWith({ "x.txt": "1" }, { root: "/ws/../ws" });
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
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({ "/a/b.txt": "x" });
			assert.deepStrictEqual(volume.paths(), ["/a/b.txt"]);
		}),
	);
});
