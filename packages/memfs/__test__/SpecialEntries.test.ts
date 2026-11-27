// Special entries — character devices, block devices, FIFOs and sockets seeded
// with `MemoryFileSystem.special`. Stat-only: they have a type and metadata but
// no content, so every content operation fails typed ENXIO (honest absence:
// nothing is read from or written to them, nothing is fabricated), while the
// namespace operations treat them like any non-directory.

import { assert, describe, it } from "@effect/vitest";
import type { PlatformError } from "effect";
import { Effect, Option } from "effect";
import type { MemoryFileSystemSeed } from "../src/index.js";
import { MemoryFileSystem } from "../src/index.js";
import { thrown } from "./helpers.js";

const SEED: MemoryFileSystemSeed = {
	"/dev/null": MemoryFileSystem.special("CharacterDevice", { mode: 0o666 }),
	"/dev/disk0": MemoryFileSystem.special("BlockDevice"),
	"/run/pipe": MemoryFileSystem.special("FIFO", { mtime: 1_700_000_000_000 }),
	"/proj/sock": MemoryFileSystem.special("Socket"),
	"/proj/notes.md": MemoryFileSystem.symlink("/dev/null"),
	"/proj/file.txt": "hello",
};

/** The errno a typed failure carries on `cause.code`, with its tag and method. */
const errnoOf = (error: PlatformError.PlatformError) => ({
	tag: error.reason._tag,
	method: error.reason.method,
	code: (error.reason.cause as { readonly code?: string } | undefined)?.code,
});

describe("MemoryFileSystem.special", () => {
	it("builds a tagged seed entry, options only when given", () => {
		assert.deepStrictEqual(MemoryFileSystem.special("FIFO"), { _tag: "MemoryFileSystemSeedSpecial", type: "FIFO" });
		assert.deepStrictEqual(MemoryFileSystem.special("Socket", { mode: 0o600, mtime: 5 }), {
			_tag: "MemoryFileSystemSeedSpecial",
			type: "Socket",
			mode: 0o600,
			mtime: 5,
		});
	});

	it.effect("stat and lstat report each kind with size 0, its type bits and mode", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith(SEED);
			const expected = [
				["/dev/null", "CharacterDevice", 0o020666],
				["/dev/disk0", "BlockDevice", 0o060644],
				["/run/pipe", "FIFO", 0o010644],
				["/proj/sock", "Socket", 0o140644],
			] as const;
			for (const [path, type, mode] of expected) {
				for (const info of [yield* fs.stat(path), yield* fs.lstat(path)]) {
					assert.strictEqual(info.type, type, path);
					assert.strictEqual(Number(info.size), 0, path);
					assert.strictEqual(info.mode, mode, path);
				}
			}
			const pipe = yield* fs.stat("/run/pipe");
			assert.strictEqual(pipe.mtime._tag === "Some" ? pipe.mtime.value.getTime() : undefined, 1_700_000_000_000);
		}),
	);

	it.effect("a link resolves to it through stat and realPath; lstat reports the link", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith(SEED);
			assert.strictEqual((yield* fs.stat("/proj/notes.md")).type, "CharacterDevice");
			assert.strictEqual((yield* fs.lstat("/proj/notes.md")).type, "SymbolicLink");
			assert.strictEqual(yield* fs.realPath("/proj/notes.md"), "/dev/null");
			assert.isTrue(yield* fs.exists("/proj/notes.md"));
		}),
	);

	it.effect("readDirectory and readDirectoryEntries list it with its kind", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith(SEED);
			assert.deepStrictEqual([...(yield* fs.readDirectory("/dev"))].sort(), ["disk0", "null"]);
			assert.deepStrictEqual(yield* fs.readDirectoryEntries("/proj"), [
				{ name: "file.txt", type: "File" },
				{ name: "notes.md", type: "SymbolicLink" },
				{ name: "sock", type: "Socket" },
			]);
			assert.deepStrictEqual(yield* fs.readDirectoryEntries("/run"), [{ name: "pipe", type: "FIFO" }]);
		}),
	);

	it.effect("every content operation fails typed ENXIO, directly and through a link", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith(SEED);
			for (const path of ["/dev/null", "/proj/notes.md", "/run/pipe", "/proj/sock", "/dev/disk0"]) {
				const failures: ReadonlyArray<readonly [string, Effect.Effect<unknown, PlatformError.PlatformError>]> = [
					["readFile", fs.readFile(path)],
					["readFile", fs.readFileString(path)],
					["open", Effect.scoped(fs.open(path, { flag: "r" }))],
					["open", Effect.scoped(fs.open(path, { flag: "w" }))],
					["open", Effect.scoped(fs.open(path, { flag: "a+" }))],
					["writeFile", fs.writeFileString(path, "x")],
					["writeFile", fs.writeFileString(path, "x", { flag: "a" })],
					["truncate", fs.truncate(path)],
					["copyFile", fs.copyFile(path, "/proj/copy")],
					["copyFile", fs.copyFile("/proj/file.txt", path)],
				];
				for (const [method, effect] of failures) {
					const error = yield* Effect.flip(effect);
					assert.deepStrictEqual(errnoOf(error), { tag: "Unknown", method, code: "ENXIO" }, `${method} ${path}`);
				}
			}
			// `copy` of a special entry, directly or inside a directory, refuses it
			// and commits nothing.
			const copied = yield* Effect.flip(fs.copy("/proj/sock", "/proj/sock-copy"));
			assert.deepStrictEqual(errnoOf(copied), { tag: "Unknown", method: "copy", code: "ENXIO" });
			const tree = yield* Effect.flip(fs.copy("/dev", "/dev-copy"));
			assert.deepStrictEqual(errnoOf(tree), { tag: "Unknown", method: "copy", code: "ENXIO" });
			assert.isFalse(yield* fs.exists("/proj/sock-copy"));
			assert.isFalse(yield* fs.exists("/dev-copy"));
			// Nothing was written anywhere: the file and the copy target are as seeded.
			assert.strictEqual(yield* fs.readFileString("/proj/file.txt"), "hello");
			assert.isFalse(yield* fs.exists("/proj/copy"));
			assert.strictEqual((yield* fs.stat("/dev/null")).type, "CharacterDevice");
		}),
	);

	it.effect("it can be renamed, hard-linked, chmod'ed and removed like a file", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith(SEED);
			yield* fs.rename("/run/pipe", "/run/renamed");
			assert.strictEqual((yield* fs.stat("/run/renamed")).type, "FIFO");
			assert.isFalse(yield* fs.exists("/run/pipe"));
			yield* fs.link("/run/renamed", "/run/hard");
			assert.deepStrictEqual((yield* fs.stat("/run/hard")).nlink, Option.some(2n));
			yield* fs.chmod("/run/hard", 0o600);
			assert.strictEqual((yield* fs.stat("/run/renamed")).mode, 0o010600);
			yield* fs.remove("/run/hard");
			yield* fs.remove("/run/renamed");
			assert.isFalse(yield* fs.exists("/run/renamed"));
			// Removing the device leaves the link dangling, not pointing at content.
			yield* fs.remove("/dev/null");
			const error = yield* Effect.flip(fs.stat("/proj/notes.md"));
			assert.strictEqual(error.reason._tag, "NotFound");
		}),
	);

	it.effect("a seed entry onto an existing path, or under a file, fails typed", () =>
		Effect.gen(function* () {
			const taken = yield* Effect.flip(MemoryFileSystem.makeWith({ "/tmp": MemoryFileSystem.special("Socket") }));
			assert.deepStrictEqual(errnoOf(taken), { tag: "AlreadyExists", method: "makeSpecial", code: "EEXIST" });
			const underFile = yield* Effect.flip(
				MemoryFileSystem.makeWith({ "/a": "x", "/a/b": MemoryFileSystem.special("FIFO") }),
			);
			// The seed's `mkdir -p` of the parent fails first, as it does for a plain file there.
			const plain = yield* Effect.flip(MemoryFileSystem.makeWith({ "/a": "x", "/a/b": "y" }));
			assert.deepStrictEqual(errnoOf(underFile), errnoOf(plain));
		}),
	);
});

describe("special entries in the inspection view", () => {
	it("the view's lstat says special and names the type; snapshot and paths omit it", () => {
		const { volume } = MemoryFileSystem.makeSync(SEED);
		assert.deepStrictEqual(volume.lstat("/dev/null"), {
			kind: "special",
			special: "CharacterDevice",
			mtimeMs: volume.mtime("/dev/null") ?? -1,
			size: 0,
		});
		assert.strictEqual(volume.lstat("/proj/notes.md")?.kind, "symlink");
		assert.isTrue(volume.has("/proj/sock"));
		assert.isFalse(volume.isDirectory("/proj/sock"));
		assert.isUndefined(volume.text("/proj/sock"));
		assert.isUndefined(volume.bytes("/run/pipe"));
		assert.deepStrictEqual(volume.paths(), ["/proj/file.txt"]);
		assert.deepStrictEqual(Object.keys(volume.snapshot()), ["/proj/file.txt"]);
	});
});

describe("special entries through the ports", () => {
	const handle = MemoryFileSystem.makeSync(SEED);
	const predicates = (s: {
		isFile(): boolean;
		isDirectory(): boolean;
		isSymbolicLink(): boolean;
		isCharacterDevice(): boolean;
		isBlockDevice(): boolean;
		isFIFO(): boolean;
		isSocket(): boolean;
	}) => ({
		file: s.isFile(),
		directory: s.isDirectory(),
		symlink: s.isSymbolicLink(),
		char: s.isCharacterDevice(),
		block: s.isBlockDevice(),
		fifo: s.isFIFO(),
		socket: s.isSocket(),
	});
	const none = { file: false, directory: false, symlink: false, char: false, block: false, fifo: false, socket: false };

	it("stat and lstat answer the type predicates, isFile/isDirectory/isSymbolicLink all false", () => {
		const { sync } = handle;
		assert.deepStrictEqual(predicates(sync.stat("/dev/null")), { ...none, char: true });
		assert.deepStrictEqual(predicates(sync.stat("/dev/disk0")), { ...none, block: true });
		assert.deepStrictEqual(predicates(sync.lstat("/run/pipe")), { ...none, fifo: true });
		assert.deepStrictEqual(predicates(sync.lstat("/proj/sock")), { ...none, socket: true });
		assert.strictEqual(sync.stat("/proj/sock").size, 0);
		// A link to a device: stat follows it, lstat reports the link.
		assert.deepStrictEqual(predicates(sync.stat("/proj/notes.md")), { ...none, char: true });
		assert.deepStrictEqual(predicates(sync.lstat("/proj/notes.md")), { ...none, symlink: true });
		assert.deepStrictEqual(predicates(sync.lstat("/proj/file.txt")), { ...none, file: true });
	});

	it("dirents report the kind literally", () => {
		const entries = handle.sync.readDirectory("/proj", { withFileTypes: true });
		assert.deepStrictEqual(
			entries.map((entry) => [entry.name, predicates(entry)]),
			[
				["file.txt", { ...none, file: true }],
				["notes.md", { ...none, symlink: true }],
				["sock", { ...none, socket: true }],
			],
		);
	});

	it("exists, realPath and isDirectory see it; readFile throws ENXIO from open", () => {
		const { sync } = handle;
		assert.isTrue(sync.exists("/proj/sock"));
		assert.isFalse(sync.isDirectory("/proj/sock"));
		assert.strictEqual(sync.realPath("/proj/notes.md"), "/dev/null");
		for (const path of ["/proj/sock", "/proj/notes.md", "/run/pipe"]) {
			const error = thrown(() => sync.readFile(path));
			assert.deepStrictEqual(
				{ code: error.code, syscall: error.syscall, path: error.path },
				{ code: "ENXIO", syscall: "open", path },
			);
			assert.strictEqual((error as Error).message, `ENXIO: no such device or address, open '${path}'`);
		}
	});

	it.effect("the promises port agrees, rejecting readFile with ENXIO", () =>
		Effect.gen(function* () {
			const { promises } = handle;
			const stats = yield* Effect.promise(() => promises.stat("/proj/notes.md"));
			assert.isTrue(stats.isCharacterDevice());
			const dirents = yield* Effect.promise(() => promises.readdir("/run", { withFileTypes: true }));
			assert.isTrue(dirents[0]?.isFIFO());
			const rejected = yield* Effect.promise(() =>
				promises.readFile("/proj/sock").then(
					() => undefined,
					(e: unknown) => e as { readonly code?: string; readonly syscall?: string },
				),
			);
			assert.strictEqual(rejected?.code, "ENXIO");
			assert.strictEqual(rejected?.syscall, "open");
		}),
	);
});
