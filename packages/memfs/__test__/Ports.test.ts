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
		assert.strictEqual(e.message, "EACCES: permission denied, open '/secret.ts'");
	});

	it("an unmapped code keeps node's format with the description 'error'", () => {
		const e = MemoryFileSystem.errno("EXDEV", "rename", "/a");
		assert.strictEqual(e.message, "EXDEV: error, rename '/a'");
		assert.strictEqual(e.code, "EXDEV");
	});

	it("a descriptor-based syscall carries no path, like node's read EISDIR", () => {
		const e = MemoryFileSystem.errno("EISDIR", "read");
		assert.strictEqual(e.message, "EISDIR: illegal operation on a directory, read");
		assert.isFalse("path" in e);
	});
});

const tree = MemoryFileSystem.makeInspectableWith({
	"/r/file.txt": MemoryFileSystem.file("hello", { mtime: 5_000 }),
	"/r/dir/inner.txt": "x",
	"/r/to-dir": MemoryFileSystem.symlink("/r/dir"),
	"/r/dangling": MemoryFileSystem.symlink("/r/missing"),
	"/r/loop-a": MemoryFileSystem.symlink("/r/loop-b"),
	"/r/loop-b": MemoryFileSystem.symlink("/r/loop-a"),
});

const thrown = (f: () => unknown): { code?: string; syscall?: string; path?: string } => {
	try {
		f();
	} catch (e) {
		return e as { code?: string; syscall?: string; path?: string };
	}
	throw new Error("expected a throw");
};

describe("sync port stat/lstat", () => {
	it.effect("stat follows links; lstat does not", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const sync = MemoryFileSystem.syncFileSystem(volume);
			assert.isTrue(sync.stat("/r/to-dir").isDirectory());
			assert.isFalse(sync.stat("/r/to-dir").isSymbolicLink());
			assert.isTrue(sync.lstat("/r/to-dir").isSymbolicLink());
			assert.isFalse(sync.lstat("/r/to-dir").isDirectory());
			assert.strictEqual(sync.stat("/r/file.txt").mtimeMs, 5_000);
			assert.strictEqual(sync.stat("/r/file.txt").size, 5);
		}),
	);

	it.effect("absence throws ENOENT with code/syscall/path", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const sync = MemoryFileSystem.syncFileSystem(volume);
			assert.deepInclude(
				thrown(() => sync.stat("/r/nope")),
				{ code: "ENOENT", syscall: "stat", path: "/r/nope" },
			);
			assert.deepInclude(
				thrown(() => sync.stat("/r/dangling")),
				{ code: "ENOENT", syscall: "stat" },
			);
			assert.strictEqual(sync.lstat("/r/dangling").isSymbolicLink(), true);
		}),
	);

	it.effect("a path through a file is ENOTDIR; a cycle is ELOOP; exists stays false for both", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const sync = MemoryFileSystem.syncFileSystem(volume);
			assert.strictEqual(thrown(() => sync.stat("/r/file.txt/child")).code, "ENOTDIR");
			assert.strictEqual(thrown(() => sync.stat("/r/loop-a")).code, "ELOOP");
			assert.isFalse(sync.exists("/r/file.txt/child"));
			assert.isFalse(sync.exists("/r/loop-a"));
		}),
	);

	it.effect("a cycle spread across nested link targets still terminates as ELOOP", () =>
		Effect.gen(function* () {
			const { volume } = yield* MemoryFileSystem.makeInspectableWith({
				"/c/a": MemoryFileSystem.symlink("/c/b/x"),
				"/c/b": MemoryFileSystem.symlink("/c/a"),
			});
			const sync = MemoryFileSystem.syncFileSystem(volume);
			assert.strictEqual(thrown(() => sync.stat("/c/a")).code, "ELOOP");
		}),
	);

	it.effect("readFile and readDirectory throw node's syscalls (open, read, scandir)", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const sync = MemoryFileSystem.syncFileSystem(volume);
			assert.deepInclude(
				thrown(() => sync.readFile("/r/nope")),
				{ code: "ENOENT", syscall: "open" },
			);
			assert.deepInclude(
				thrown(() => sync.readFile("/r/dir")),
				{ code: "EISDIR", syscall: "read" },
			);
			assert.deepInclude(
				thrown(() => sync.readDirectory("/r/nope")),
				{ code: "ENOENT", syscall: "scandir" },
			);
			assert.deepInclude(
				thrown(() => sync.readDirectory("/r/file.txt")),
				{ code: "ENOTDIR", syscall: "scandir" },
			);
		}),
	);
});

describe("sync port faults", () => {
	it.effect("a handler throwing errno replaces one path; others delegate", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const sync = MemoryFileSystem.syncFileSystem(volume, {
				faults: {
					readFile: (path) => {
						if (path.endsWith("file.txt")) throw MemoryFileSystem.errno("EACCES", "open", path);
						return undefined;
					},
				},
			});
			assert.deepInclude(
				thrown(() => sync.readFile("/r/file.txt")),
				{ code: "EACCES", syscall: "open" },
			);
			assert.strictEqual(sync.readFile("/r/dir/inner.txt"), "x");
			assert.isTrue(sync.exists("/r/file.txt"));
		}),
	);

	it.effect("a handler may return a replacement value", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const sync = MemoryFileSystem.syncFileSystem(volume, { faults: { exists: () => false } });
			assert.isFalse(sync.exists("/r/file.txt"));
		}),
	);
});

describe("sync port members are unbound-safe", () => {
	it.effect("every member works when detached from the port object", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const { exists, readFile, readDirectory, isDirectory, stat, lstat } = MemoryFileSystem.syncFileSystem(volume);
			assert.isTrue(exists("/r/file.txt"));
			assert.strictEqual(readFile("/r/file.txt"), "hello");
			assert.deepStrictEqual(readDirectory("/r/dir"), ["inner.txt"]);
			assert.isTrue(isDirectory("/r/dir"));
			assert.isTrue(stat("/r/file.txt").isFile());
			assert.isTrue(lstat("/r/to-dir").isSymbolicLink());
		}),
	);
});

describe("promises port", () => {
	it.effect("readdir withFileTypes gives literal dirents", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const fsp = MemoryFileSystem.promisesFileSystem(volume);
			const dirents = yield* Effect.promise(() => fsp.readdir("/r", { withFileTypes: true }));
			const link = dirents.find((d) => d.name === "to-dir");
			assert.isDefined(link);
			assert.isTrue(link?.isSymbolicLink());
			assert.isFalse(link?.isDirectory());
			assert.isFalse(link?.isFile());
			assert.isTrue(dirents.find((d) => d.name === "file.txt")?.isFile());
			assert.deepStrictEqual(yield* Effect.promise(() => fsp.readdir("/r/dir")), ["inner.txt"]);
		}),
	);

	it.effect("rejects with node-shaped errors", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const fsp = MemoryFileSystem.promisesFileSystem(volume);
			const error = yield* Effect.flip(
				Effect.tryPromise({ try: () => fsp.stat("/r/nope"), catch: (e) => e as { code: string; syscall: string } }),
			);
			assert.strictEqual(error.code, "ENOENT");
			assert.strictEqual(error.syscall, "stat");
			const notDir = yield* Effect.flip(
				Effect.tryPromise({ try: () => fsp.readdir("/r/file.txt"), catch: (e) => e as { code: string } }),
			);
			assert.strictEqual(notDir.code, "ENOTDIR");
		}),
	);

	it.effect("stat follows, lstat does not, readFile reads through links", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const fsp = MemoryFileSystem.promisesFileSystem(volume);
			assert.isTrue((yield* Effect.promise(() => fsp.stat("/r/to-dir"))).isDirectory());
			assert.isTrue((yield* Effect.promise(() => fsp.lstat("/r/to-dir"))).isSymbolicLink());
			assert.strictEqual(yield* Effect.promise(() => fsp.readFile("/r/to-dir/inner.txt", "utf8")), "x");
		}),
	);

	it.effect("faults reject through the promise, other paths delegate", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const fsp = MemoryFileSystem.promisesFileSystem(volume, {
				faults: {
					stat: (path) =>
						path === "/r/dir" ? Promise.reject(MemoryFileSystem.errno("EACCES", "stat", path)) : undefined,
				},
			});
			const error = yield* Effect.flip(
				Effect.tryPromise({ try: () => fsp.stat("/r/dir"), catch: (e) => e as { code: string } }),
			);
			assert.strictEqual(error.code, "EACCES");
			assert.isTrue((yield* Effect.promise(() => fsp.stat("/r/file.txt"))).isFile());
		}),
	);

	it.effect("members are unbound-safe", () =>
		Effect.gen(function* () {
			const { volume } = yield* tree;
			const { readdir, stat, lstat, readFile } = MemoryFileSystem.promisesFileSystem(volume);
			assert.deepStrictEqual(yield* Effect.promise(() => readdir("/r/dir")), ["inner.txt"]);
			assert.isTrue((yield* Effect.promise(() => stat("/r/file.txt"))).isFile());
			assert.isTrue((yield* Effect.promise(() => lstat("/r/to-dir"))).isSymbolicLink());
			assert.strictEqual(yield* Effect.promise(() => readFile("/r/file.txt")), "hello");
		}),
	);
});
