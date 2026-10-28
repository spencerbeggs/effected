// NodeDirectorySeed.read against real fixture trees under os.tmpdir(): what is
// copied (bytes exactly, empty directories, in-fixture links as links), and
// what is refused (links leaving the fixture, oversized files, other types).

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, assert, beforeAll, describe, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import { MemoryFileSystem } from "../../src/index.js";
import { NodeDirectorySeed } from "../../src/NodeSyncFileSystem.js";

let base: string;
const fresh = (name: string): string => {
	const dir = join(base, name);
	mkdirSync(dir, { recursive: true });
	return dir;
};

const thrownBy = (f: () => unknown): Error & { code?: string; path?: string } => {
	try {
		f();
	} catch (error) {
		return error as Error & { code?: string; path?: string };
	}
	throw new Error("expected a throw");
};

const ALL_BYTES = Uint8Array.from({ length: 256 }, (_, index) => index);

let tree: string;
beforeAll(() => {
	base = mkdtempSync(join(tmpdir(), "memfs-directory-seed-"));
	tree = fresh("tree");
	writeFileSync(join(tree, "all-bytes.bin"), ALL_BYTES);
	writeFileSync(join(tree, "crlf.txt"), "a\r\nb\r\n");
	mkdirSync(join(tree, "nested", "deeper"), { recursive: true });
	writeFileSync(join(tree, "nested", "deeper", "leaf.json"), `{ "ok": true }\n`);
	mkdirSync(join(tree, "empty"));
	symlinkSync("nested/deeper/leaf.json", join(tree, "link-to-leaf"));
	symlinkSync("nested", join(tree, "link-to-dir"));
	symlinkSync("not-there", join(tree, "dangling"));
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

describe("NodeDirectorySeed.read — what is copied", () => {
	it.effect("keeps every byte exactly, and keeps empty directories", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith(NodeDirectorySeed.read(tree, { mountAt: "/repo" }));
			assert.deepStrictEqual(yield* fs.readFile("/repo/all-bytes.bin"), ALL_BYTES);
			assert.strictEqual(yield* fs.readFileString("/repo/crlf.txt"), "a\r\nb\r\n");
			assert.strictEqual(yield* fs.readFileString("/repo/nested/deeper/leaf.json"), `{ "ok": true }\n`);
			assert.strictEqual((yield* fs.stat("/repo/empty")).type, "Directory");
			assert.deepStrictEqual(yield* fs.readDirectory("/repo/empty"), []);
		}),
	);

	it.effect("copies in-fixture links as links, target text verbatim, and they resolve in the volume", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith(NodeDirectorySeed.read(tree, { mountAt: "/repo" }));
			assert.strictEqual(yield* fs.readLink("/repo/link-to-leaf"), "nested/deeper/leaf.json");
			assert.strictEqual(yield* fs.readFileString("/repo/link-to-leaf"), `{ "ok": true }\n`);
			assert.strictEqual(yield* fs.readFileString("/repo/link-to-dir/deeper/leaf.json"), `{ "ok": true }\n`);
			assert.strictEqual((yield* fs.lstat("/repo/link-to-dir")).type, "SymbolicLink");
			assert.strictEqual(yield* fs.readLink("/repo/dangling"), "not-there");
		}),
	);

	it('mountAt keys absolutely; omitting it keys relative to the directory, with "" for the directory', () => {
		const absolute = NodeDirectorySeed.read(tree, { mountAt: "/repo/" });
		assert.isTrue(Object.hasOwn(absolute, "/repo"));
		assert.isTrue(Object.hasOwn(absolute, "/repo/nested/deeper/leaf.json"));
		const atRoot = NodeDirectorySeed.read(tree, { mountAt: "/" });
		assert.isTrue(Object.hasOwn(atRoot, "/"));
		assert.isTrue(Object.hasOwn(atRoot, "/crlf.txt"));
		const relative = NodeDirectorySeed.read(tree);
		assert.isTrue(Object.hasOwn(relative, ""));
		assert.isTrue(Object.hasOwn(relative, "nested/deeper/leaf.json"));
		assert.isFalse(Object.keys(relative).some((key) => key.startsWith("/")));
	});

	it.effect("relative keys seed under layerWith's root", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString("/ws/repo/crlf.txt"), "a\r\nb\r\n");
		}).pipe(Effect.provide(MemoryFileSystem.layerWith(NodeDirectorySeed.read(tree), { root: "/ws/repo" }))),
	);

	it("lists parents before children, in name order, identically on every read", () => {
		const keys = Object.keys(NodeDirectorySeed.read(tree, { mountAt: "/r" }));
		assert.deepStrictEqual(keys, Object.keys(NodeDirectorySeed.read(tree, { mountAt: "/r" })));
		assert.isBelow(keys.indexOf("/r/nested"), keys.indexOf("/r/nested/deeper"));
		assert.isBelow(keys.indexOf("/r/nested/deeper"), keys.indexOf("/r/nested/deeper/leaf.json"));
		assert.strictEqual(keys[0], "/r");
	});

	it.effect("leaves the volume's modes by default, and copies the fixture's with modes: true", () =>
		Effect.gen(function* () {
			const dir = fresh("modes");
			writeFileSync(join(dir, "run.sh"), "#!/bin/sh\n");
			chmodSync(join(dir, "run.sh"), 0o750);
			mkdirSync(join(dir, "private"));
			chmodSync(join(dir, "private"), 0o700);

			const plain = yield* MemoryFileSystem.makeWith(NodeDirectorySeed.read(dir, { mountAt: "/m" }));
			assert.strictEqual((yield* plain.stat("/m/run.sh")).mode & 0o7777, 0o644);
			assert.strictEqual((yield* plain.stat("/m/private")).mode & 0o7777, 0o755);

			const copied = yield* MemoryFileSystem.makeWith(NodeDirectorySeed.read(dir, { mountAt: "/m", modes: true }));
			assert.strictEqual((yield* copied.stat("/m/run.sh")).mode & 0o7777, 0o750);
			assert.strictEqual((yield* copied.stat("/m/private")).mode & 0o7777, 0o700);
		}),
	);

	it("walks a deep tree without recursion", () => {
		const dir = fresh("deep");
		const segments = Array.from({ length: 200 }, () => "d");
		mkdirSync(join(dir, ...segments), { recursive: true });
		writeFileSync(join(dir, ...segments, "bottom.txt"), "x");
		const seed = NodeDirectorySeed.read(dir, { mountAt: "/deep" });
		assert.isTrue(Object.hasOwn(seed, `/deep/${segments.join("/")}/bottom.txt`));
	});
});

describe("NodeDirectorySeed.read — what is refused", () => {
	it("an absolute symlink target", () => {
		const dir = fresh("absolute-link");
		symlinkSync(join(tree, "crlf.txt"), join(dir, "abs"));
		const error = thrownBy(() => NodeDirectorySeed.read(dir));
		assert.strictEqual(error.code, "ERR_SEED_SYMLINK_ESCAPE");
		assert.strictEqual(error.path, join(dir, "abs"));
	});

	it("a relative target that leaves the fixture, so the file outside is never read", () => {
		const outside = fresh("outside");
		writeFileSync(join(outside, "secret.txt"), "do not copy");
		const dir = fresh("escaping-link");
		symlinkSync("../outside/secret.txt", join(dir, "escape"));
		const error = thrownBy(() => NodeDirectorySeed.read(dir));
		assert.strictEqual(error.code, "ERR_SEED_SYMLINK_ESCAPE");
		assert.include(error.message, "../outside/secret.txt");
	});

	it("a link chain that only escapes once the host resolves it", () => {
		// `sub/up -> ..` is the fixture root; `sub/out -> up/..` reads as `sub`
		// lexically but resolves ABOVE the root on the host.
		const dir = fresh("chain/fixture");
		mkdirSync(join(dir, "sub"));
		symlinkSync("..", join(dir, "sub", "up"));
		symlinkSync("up/..", join(dir, "sub", "out"));
		const error = thrownBy(() => NodeDirectorySeed.read(dir));
		assert.strictEqual(error.code, "ERR_SEED_SYMLINK_ESCAPE");
		assert.strictEqual(error.path, join(dir, "sub", "out"));
	});

	it("a dangling target that escapes lexically", () => {
		const dir = fresh("dangling-escape");
		symlinkSync("../nowhere/at-all", join(dir, "gone"));
		assert.strictEqual(thrownBy(() => NodeDirectorySeed.read(dir)).code, "ERR_SEED_SYMLINK_ESCAPE");
	});

	it("a file over maxFileBytes, while a file of exactly that size is read", () => {
		const dir = fresh("large");
		writeFileSync(join(dir, "big.bin"), new Uint8Array(1025));
		const error = thrownBy(() => NodeDirectorySeed.read(dir, { maxFileBytes: 1024 }));
		assert.strictEqual(error.code, "EFBIG");
		assert.strictEqual(error.path, join(dir, "big.bin"));
		assert.isTrue(Object.hasOwn(NodeDirectorySeed.read(dir, { maxFileBytes: 1025 }), "big.bin"));
	});

	it.skipIf(process.platform === "win32")("a FIFO", () => {
		const dir = fresh("fifo");
		execFileSync("mkfifo", [join(dir, "pipe")]);
		assert.strictEqual(thrownBy(() => NodeDirectorySeed.read(dir)).code, "ERR_SEED_UNSUPPORTED_TYPE");
	});

	it("a missing directory, a file, and bad options", () => {
		assert.strictEqual(thrownBy(() => NodeDirectorySeed.read(join(base, "missing"))).code, "ENOENT");
		assert.strictEqual(thrownBy(() => NodeDirectorySeed.read(join(tree, "crlf.txt"))).code, "ENOTDIR");
		assert.instanceOf(
			thrownBy(() => NodeDirectorySeed.read(tree, { mountAt: "repo" })),
			RangeError,
		);
		assert.instanceOf(
			thrownBy(() => NodeDirectorySeed.read(tree, { maxFileBytes: Number.NaN })),
			RangeError,
		);
	});
});
