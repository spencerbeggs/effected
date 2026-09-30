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

	it("a contradictory seed throws a node-shaped error synchronously", () => {
		// Seeding "/a/b" needs "/a" as a directory; a recursive mkdir over the
		// file "/a" is EEXIST, as `mkdirSync({ recursive: true })` reports it.
		const e = thrown(() => MemoryFileSystem.makeSync({ "/a": "x", "/a/b": "y" })) as Record<string, unknown>;
		assert.strictEqual(e.code, "EEXIST");
		// node's syscall for the failing seed step, never the Effect method name.
		assert.strictEqual(e.syscall, "mkdir");
		assert.strictEqual(e.path, "/a");
		assert.notStrictEqual(e.name, "FiberFailure");
		assert.isUndefined(e._tag);
	});

	it("each seed step reports node's syscall: an invalid directory mode fails in chmod", () => {
		const e = thrown(() => MemoryFileSystem.makeSync({ "/d": MemoryFileSystem.directory({ mode: -1 }) })) as Record<
			string,
			unknown
		>;
		assert.strictEqual(e.code, "EINVAL");
		assert.strictEqual(e.syscall, "chmod");
	});

	it("a bad root is EINVAL, node-shaped", () => {
		const e = thrown(() => MemoryFileSystem.makeSync({ a: "" }, { root: "ws" })) as Record<string, unknown>;
		assert.strictEqual(e.code, "EINVAL");
		assert.strictEqual(e.syscall, "seed");
		assert.isUndefined(e._tag);
	});

	it("write accepts bytes", () => {
		const vol = MemoryFileSystem.makeSync();
		vol.write("/b/data.bin", new Uint8Array([1, 2, 3]));
		assert.deepStrictEqual([...(vol.volume.bytes("/b/data.bin") ?? [])], [1, 2, 3]);
	});

	it("mkdir over a file and symlink onto an existing path are EEXIST", () => {
		const vol = MemoryFileSystem.makeSync({ "/f": "x" });
		assert.strictEqual(thrown(() => vol.mkdir("/f")).code, "EEXIST");
		assert.strictEqual(thrown(() => vol.symlink("/x", "/f")).code, "EEXIST");
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

	it("a typed failure without an errno cause takes its code from the tag", () => {
		const code = (tag: "NotFound" | "AlreadyExists" | "PermissionDenied" | "Unknown") =>
			thrown(() =>
				runMutation(
					Effect.fail(PlatformError.systemError({ _tag: tag, module: "FileSystem", method: "m" })),
					"mkdir",
					"/x",
				),
			).code;
		assert.strictEqual(code("NotFound"), "ENOENT");
		assert.strictEqual(code("AlreadyExists"), "EEXIST");
		assert.strictEqual(code("PermissionDenied"), "EACCES");
		assert.strictEqual(code("Unknown"), "EIO");
	});

	it("a BadArgument is EINVAL", () => {
		const bad = PlatformError.badArgument({ module: "FileSystem", method: "m", description: "d" });
		assert.strictEqual(thrown(() => runMutation(Effect.fail(bad), "mkdir", "/x")).code, "EINVAL");
	});
});
