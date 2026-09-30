import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, PlatformError } from "effect";
import { MemoryFileSystem } from "../src/index.js";
import { runMutation } from "../src/internal/ports.js";

const thrown = (f: () => unknown) => {
	try {
		f();
	} catch (e) {
		return e as { code?: string; syscall?: string; path?: string; name?: string };
	}
	throw new Error("expected a throw");
};

describe("MemoryFileSystem.makeSync", () => {
	it("builds synchronously at describe scope with root", () => {
		const vol = MemoryFileSystem.makeSync({ "package.json": "{}" }, { root: "/ws-1/repo" });
		assert.strictEqual(vol.volume.text("/ws-1/repo/package.json"), "{}");
		assert.isTrue(vol.sync.exists("/ws-1/repo/package.json"));
	});

	it("mutators write through to the same volume the ports read", () => {
		const vol = MemoryFileSystem.makeSync();
		vol.write("/r/pkg/package.json", '{"name":"a"}');
		assert.strictEqual(vol.sync.readFile("/r/pkg/package.json"), '{"name":"a"}');
		vol.write("/r/pkg/package.json", '{"name":"b"}');
		assert.strictEqual(vol.volume.text("/r/pkg/package.json"), '{"name":"b"}');
		vol.mkdir("/r/pkg/__test__");
		assert.isTrue(vol.volume.isDirectory("/r/pkg/__test__"));
		vol.symlink("/r/pkg", "/r/link");
		assert.isTrue(vol.sync.isDirectory("/r/link"));
		vol.remove("/r/pkg");
		assert.isFalse(vol.sync.exists("/r/pkg/package.json"));
	});

	it("mutator failures throw node-shaped errors, not FiberFailure", () => {
		const vol = MemoryFileSystem.makeSync({ "/f": "x" });
		const missing = thrown(() => vol.remove("/nope"));
		assert.strictEqual(missing.code, "ENOENT");
		assert.strictEqual(missing.path, "/nope");
		assert.strictEqual(missing.syscall, "rm");
		assert.notStrictEqual(missing.name, "FiberFailure");
		const underFile = thrown(() => vol.write("/f/child.txt", ""));
		assert.strictEqual(underFile.code, "ENOTDIR");
		assert.strictEqual(underFile.path, "/f/child.txt");
		assert.strictEqual(underFile.syscall, "open");
		assert.strictEqual(thrown(() => vol.write("/f/a/b.txt", "")).code, "ENOTDIR");
		assert.strictEqual(thrown(() => vol.symlink("/x", "/f/l")).code, "ENOTDIR");
	});

	it("a contradictory seed throws synchronously", () => {
		const e = thrown(() => MemoryFileSystem.makeSync({ "/a": "x", "/a/b": "y" }));
		assert.isDefined(e);
	});

	it.effect("layer is stable across provides: two programs, one volume", () =>
		Effect.gen(function* () {
			const vol = MemoryFileSystem.makeSync();
			const write = Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				yield* fs.makeDirectory(path.join("/data", "repo"), { recursive: true });
			});
			const read = Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				return yield* fs.exists("/data/repo");
			});
			yield* write.pipe(Effect.provide(vol.layer));
			assert.isTrue(yield* read.pipe(Effect.provide(vol.layer)));
			assert.isTrue(vol.volume.isDirectory("/data/repo"));
		}),
	);

	it("a Promise-style suite needs no Effect import to mutate and read", async () => {
		const vol = MemoryFileSystem.makeSync({ "src/a.ts": "" }, { root: "/p" });
		const before = await vol.promises.readdir("/p/src");
		vol.write("/p/src/b.ts", "");
		const after = await vol.promises.readdir("/p/src");
		assert.deepStrictEqual([before, after], [["a.ts"], ["a.ts", "b.ts"]]);
	});
});

describe("runMutation", () => {
	it("rethrows a defect unchanged rather than converting it to an errno", () => {
		const defect = new Error("boom");
		const e = thrown(() => runMutation(Effect.die(defect) as never, "write", "/x"));
		assert.strictEqual(e, defect);
	});

	it("a typed failure without an errno cause becomes EIO, and a BadArgument EINVAL", () => {
		const io = PlatformError.systemError({ _tag: "Unknown", module: "FileSystem", method: "m" });
		assert.strictEqual(thrown(() => runMutation(Effect.fail(io), "mkdir", "/x")).code, "EIO");
		const bad = PlatformError.badArgument({ module: "FileSystem", method: "m", description: "d" });
		assert.strictEqual(thrown(() => runMutation(Effect.fail(bad), "mkdir", "/x")).code, "EINVAL");
	});
});
