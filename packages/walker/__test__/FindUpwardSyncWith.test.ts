// `Walker.findUpwardSyncWith` — the validating upward search — and the sync
// port's `readFile`, over one memfs volume read through the handle's
// node-shaped sync port. The accept function reads through the same port the
// walk's chain came from, which is the point of `readFile` on it.

import { posix } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Option } from "effect";
import type { WalkerSyncFileSystem, WalkerSyncOps } from "../src/DescendSync.js";
import { Walker } from "../src/Walker.js";

const TREE: Readonly<Record<string, MemoryFileSystemSeedEntry>> = {
	"/repo/package.json": JSON.stringify({ name: "root" }),
	"/repo/.git/HEAD": "ref",
	// A malformed manifest between the start and the valid one: it must be climbed past.
	"/repo/packages/app/package.json": "{ not json",
	"/repo/packages/app/src/index.ts": "",
	"/repo/packages/app/src/deep/x.ts": "",
	"/repo/packages/lib/package.json": JSON.stringify({ name: "lib" }),
	"/repo/packages/lib/src/y.ts": "",
	// A directory named like the manifest: readFile fails, and that too is "not valid".
	"/repo/packages/odd/package.json/keep": "",
	"/repo/packages/odd/src/z.ts": "",
	"/elsewhere/package.json": JSON.stringify({ name: "elsewhere" }),
	"/elsewhere/inner/w.ts": "",
};

const handle = MemoryFileSystem.makeSync(TREE);
// Compile-time pin: a memfs handle's sync port satisfies the walker port, readFile included.
const fileSystem: WalkerSyncFileSystem = handle.sync;
const ops: WalkerSyncOps = { fileSystem, path: posix };

/** An accept that reads and parses the candidate manifest, counting every directory it is asked about. */
const counting = () => {
	const asked: Array<string> = [];
	const accept = (dir: string): Option.Option<string> => {
		asked.push(dir);
		try {
			const manifest: unknown = JSON.parse(ops.fileSystem.readFile(ops.path.join(dir, "package.json")));
			const name = typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, "name") : undefined;
			return typeof name === "string" ? Option.some(name) : Option.none();
		} catch {
			return Option.none();
		}
	};
	return { asked, accept };
};

const chain = (start: string, stopAt?: string) =>
	Walker.ascendSync(start, { path: ops.path, ...(stopAt === undefined ? {} : { stopAt }) });

/** The `code` of the error `run` throws; a run that does not throw fails the test. */
const codeOf = (run: () => unknown): unknown => {
	try {
		run();
	} catch (error) {
		return Reflect.get(Object(error), "code");
	}
	return assert.fail("expected a throw");
};

describe("WalkerSyncFileSystem.readFile", () => {
	it("reads UTF-8 text through links, and throws node-shaped errors", () => {
		const linked = MemoryFileSystem.makeSync({
			"/a/real.txt": "héllo",
			"/a/link.txt": MemoryFileSystem.symlink("/a/real.txt"),
		});
		const port: WalkerSyncFileSystem = linked.sync;
		assert.strictEqual(port.readFile("/a/real.txt"), "héllo");
		assert.strictEqual(port.readFile("/a/link.txt"), "héllo");
		assert.strictEqual(
			codeOf(() => port.readFile("/a/missing.txt")),
			"ENOENT",
		);
		assert.strictEqual(
			codeOf(() => port.readFile("/a")),
			"EISDIR",
		);
	});
});

describe("Walker.findUpwardSyncWith", () => {
	it("answers the nearest VALID manifest, climbing past a malformed one", () => {
		const { asked, accept } = counting();
		const found = Walker.findUpwardSyncWith(chain("/repo/packages/app/src/deep"), accept);
		assert.deepStrictEqual(found, Option.some({ dir: "/repo", value: "root" }));
		// The malformed manifest was read and rejected; nothing above the hit was asked.
		assert.deepStrictEqual(asked, [
			"/repo/packages/app/src/deep",
			"/repo/packages/app/src",
			"/repo/packages/app",
			"/repo/packages",
			"/repo",
		]);
	});

	it("an unreadable candidate (a directory named like the file) is rejected, not fatal", () => {
		const { accept } = counting();
		assert.deepStrictEqual(
			Walker.findUpwardSyncWith(chain("/repo/packages/odd/src"), accept),
			Option.some({ dir: "/repo", value: "root" }),
		);
	});

	it("stops at the first acceptance: the nearer valid manifest wins", () => {
		const { asked, accept } = counting();
		assert.deepStrictEqual(
			Walker.findUpwardSyncWith(chain("/repo/packages/lib/src"), accept),
			Option.some({ dir: "/repo/packages/lib", value: "lib" }),
		);
		assert.deepStrictEqual(asked, ["/repo/packages/lib/src", "/repo/packages/lib"]);
	});

	it("respects a ceiling: nothing above the chain is asked, and a hit above it is not found", () => {
		const { asked, accept } = counting();
		const found = Walker.findUpwardSyncWith(chain("/repo/packages/app/src", "/repo/packages"), accept);
		assert.isTrue(Option.isNone(found));
		assert.deepStrictEqual(asked, ["/repo/packages/app/src", "/repo/packages/app", "/repo/packages"]);
	});

	it("respects a marker stop from ascendToMarkerSync", () => {
		const { asked, accept } = counting();
		// The nearest `package.json` ENTRY is the directory under `odd`: the chain stops there, so the
		// valid root manifest above it is never reached.
		const dirs = Walker.ascendToMarkerSync("/repo/packages/odd/src", ["package.json"], ops);
		assert.isTrue(Option.isNone(Walker.findUpwardSyncWith(dirs, accept)));
		assert.deepStrictEqual(asked, ["/repo/packages/odd/src", "/repo/packages/odd"]);
		// Control: without the marker stop the same search does find the root manifest.
		assert.isTrue(Option.isSome(Walker.findUpwardSyncWith(chain("/repo/packages/odd/src"), accept)));
	});

	it("an empty chain is none, and accept is never called", () => {
		const { asked, accept } = counting();
		assert.isTrue(Option.isNone(Walker.findUpwardSyncWith([], accept)));
		assert.deepStrictEqual(asked, []);
	});

	it("a cache memoizes every directory's answer, rejections included", () => {
		const { asked, accept } = counting();
		const cache = new Map<string, Option.Option<string>>();
		const first = Walker.findUpwardSyncWith(chain("/repo/packages/app/src/deep"), accept, { cache });
		assert.strictEqual(asked.length, 5);
		assert.strictEqual(cache.size, 5);
		assert.isTrue(Option.isNone(cache.get("/repo/packages/app") ?? Option.some("missing")));

		// The same search again asks nothing.
		const second = Walker.findUpwardSyncWith(chain("/repo/packages/app/src/deep"), accept, { cache });
		assert.deepStrictEqual(second, first);
		assert.strictEqual(asked.length, 5);

		// A sibling start shares every ancestor above it: only its own directory is new.
		const sibling = Walker.findUpwardSyncWith(chain("/repo/packages/app/src"), accept, { cache });
		assert.deepStrictEqual(sibling, Option.some({ dir: "/repo", value: "root" }));
		assert.strictEqual(asked.length, 5);
		Walker.findUpwardSyncWith(chain("/repo/packages/odd/src"), accept, { cache });
		assert.deepStrictEqual(asked.slice(5), ["/repo/packages/odd/src", "/repo/packages/odd"]);
	});

	it("without a cache every search asks again", () => {
		const { asked, accept } = counting();
		Walker.findUpwardSyncWith(chain("/repo/packages/lib/src"), accept);
		Walker.findUpwardSyncWith(chain("/repo/packages/lib/src"), accept);
		assert.strictEqual(asked.length, 4);
	});

	it("a cached answer stands until the caller invalidates it", () => {
		const { accept } = counting();
		const cache = new Map<string, Option.Option<string>>([["/repo/packages/lib", Option.some("stale")]]);
		assert.deepStrictEqual(
			Walker.findUpwardSyncWith(chain("/repo/packages/lib"), accept, { cache }),
			Option.some({ dir: "/repo/packages/lib", value: "stale" }),
		);
		cache.delete("/repo/packages/lib");
		assert.deepStrictEqual(
			Walker.findUpwardSyncWith(chain("/repo/packages/lib"), accept, { cache }),
			Option.some({ dir: "/repo/packages/lib", value: "lib" }),
		);
	});

	it("a throwing accept propagates, and nothing is cached for that directory", () => {
		const cache = new Map<string, Option.Option<string>>();
		const boom = (dir: string): Option.Option<string> => {
			if (dir === "/repo/packages") throw new Error("accept bug");
			return Option.none();
		};
		assert.throws(() => Walker.findUpwardSyncWith(chain("/repo/packages/app"), boom, { cache }), /accept bug/);
		assert.deepStrictEqual([...cache.keys()], ["/repo/packages/app"]);
	});
});
