import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { MemoryFileSystem } from "../src/index.js";

const seeded = MemoryFileSystem.makeInspectableWith({
	"/d/f.txt": MemoryFileSystem.file("abc", { mtime: 1_000 }),
	"/d/link": MemoryFileSystem.symlink("/d/f.txt"),
	"/d/wide": MemoryFileSystem.symlink("/d/é.txt"),
	"/d/empty": MemoryFileSystem.directory(),
});

describe("volume.lstat", () => {
	it.effect("is literal: a link reports symlink, never its target", () =>
		Effect.gen(function* () {
			const { volume } = yield* seeded;
			assert.deepStrictEqual(volume.lstat("/d/f.txt"), { kind: "file", mtimeMs: 1_000, size: 3 });
			assert.strictEqual(volume.lstat("/d/link")?.kind, "symlink");
			assert.strictEqual(volume.lstat("/d/link")?.size, "/d/f.txt".length);
			assert.strictEqual(volume.lstat("/d/empty")?.kind, "directory");
		}),
	);

	it.effect("a symlink's size is its target's UTF-8 byte length, not its character count", () =>
		Effect.gen(function* () {
			const { volume } = yield* seeded;
			assert.strictEqual("/d/é.txt".length, 8);
			assert.strictEqual(volume.lstat("/d/wide")?.size, 9);
		}),
	);

	it.effect("the root is a directory of size 0", () =>
		Effect.gen(function* () {
			const { volume } = yield* seeded;
			const root = volume.lstat("/");
			assert.strictEqual(root?.kind, "directory");
			assert.strictEqual(root?.size, 0);
		}),
	);

	it.effect("absence is undefined", () =>
		Effect.gen(function* () {
			const { volume } = yield* seeded;
			assert.isUndefined(volume.lstat("/nope"));
		}),
	);
});

describe("MemoryFileSystem.errno", () => {
	it("builds a node-shaped error", () => {
		const e = MemoryFileSystem.errno("EACCES", "open", "/secret.ts");
		assert.instanceOf(e, Error);
		assert.strictEqual(e.code, "EACCES");
		assert.strictEqual(e.syscall, "open");
		assert.strictEqual(e.path, "/secret.ts");
		assert.match(e.message, /EACCES/);
	});
});
