// The sync walk against the Effect walk, over ONE memfs volume: the Effect side
// reads it through `handle.fileSystem`, the sync side through the handle's
// node-shaped sync port. Both drive the same traversal machine, and this suite
// is what proves that claim — a parity matrix over trees, patterns and every
// option, plus the boundary and stat-carrying behaviour pinned directly.

import { posix } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Exit, Option, PlatformError, Result } from "effect";
import type { DescendOptions } from "../src/Descend.js";
import { DescendError, descend, descendEntries } from "../src/Descend.js";
import type { WalkerSyncFileSystem } from "../src/DescendSync.js";
import { descendEntriesSync, descendSync } from "../src/DescendSync.js";

const TREE: Readonly<Record<string, MemoryFileSystemSeedEntry>> = {
	"/repo/package.json": "{}",
	"/repo/readme.md": "",
	"/repo/.env.ts": "",
	"/repo/src/index.ts": "",
	"/repo/src/lib/util.ts": "",
	"/repo/src/lib/deep/core.test.ts": "",
	"/repo/packages/a/package.json": "{}",
	"/repo/packages/a/src/x.ts": "",
	"/repo/packages/a/src/x.test.ts": "",
	"/repo/packages/b/src/y.ts": "",
	"/repo/packages/b/package.json/not-a-marker.ts": "",
	"/repo/node_modules/dep/index.ts": "",
	"/repo/.git/config.ts": "",
	"/repo/locked/secret.ts": "",
	// A link back to an ancestor (a cycle), two sibling links to one target, and a dangling link.
	"/repo/src/loop": MemoryFileSystem.symlink("/repo/src"),
	"/repo/links/one": MemoryFileSystem.symlink("/repo/packages/b"),
	"/repo/links/two": MemoryFileSystem.symlink("/repo/packages/b"),
	"/repo/links/gone": MemoryFileSystem.symlink("/repo/nowhere"),
	"/repo/links/file.ts": MemoryFileSystem.symlink("/repo/readme.md"),
	// Lists and stats as a directory, then vanishes before its own read: the benign NotFound race.
	"/repo/vanish": MemoryFileSystem.directory(),
	// A link whose target resolves for stat but whose realPath reports NotFound (vanished mid-walk).
	"/repo/links/flaky": MemoryFileSystem.symlink("/repo/packages/b"),
	// A link whose realPath is denied: unreadable under followSymlinks.
	"/repo/links/denied": MemoryFileSystem.symlink("/repo/packages/b"),
};
const VANISH = "/repo/vanish";
const FLAKY = "/repo/links/flaky";
const DENIED = "/repo/links/denied";

const UNREADABLE = "/repo/locked";

const fault = (method: "readDirectory" | "realPath", reason: "PermissionDenied" | "NotFound", path: string) =>
	Effect.fail(PlatformError.systemError({ _tag: reason, module: "FileSystem", method, pathOrDescriptor: path }));

/** Every directory the Effect walk read, in order — reset before each assertion. */
const effectReads: Array<string> = [];

const handle = MemoryFileSystem.makeSync(TREE, {
	spies: { readDirectory: (path: string) => void effectReads.push(path) },
	faults: {
		readDirectory: (path: string) =>
			path === UNREADABLE
				? fault("readDirectory", "PermissionDenied", path)
				: path === VANISH
					? fault("readDirectory", "NotFound", path)
					: undefined,
		realPath: (path: string) =>
			path === FLAKY
				? fault("realPath", "NotFound", path)
				: path === DENIED
					? fault("realPath", "PermissionDenied", path)
					: undefined,
	},
});

/**
 * The node-shaped sync port over the SAME volume, faulted the same way through
 * memfs's own sync fault machinery — the unreadable and vanished directories
 * and the two `realPath` faults, as the errno a node call would throw.
 */
const syncFs: WalkerSyncFileSystem = handle.withFaults({
	sync: {
		readDirectory: (path: string) => {
			if (path === UNREADABLE) throw MemoryFileSystem.errno("EACCES", "scandir", path);
			if (path === VANISH) throw MemoryFileSystem.errno("ENOENT", "scandir", path);
			return undefined;
		},
		realPath: (path: string) => {
			if (path === FLAKY) throw MemoryFileSystem.errno("ENOENT", "realpath", path);
			if (path === DENIED) throw MemoryFileSystem.errno("EACCES", "realpath", path);
			return undefined;
		},
	},
}).sync;
/** Every directory the sync walk read, in order — reset before each assertion. */
const syncReads: Array<string> = [];
const ops = {
	fileSystem: {
		...syncFs,
		readDirectory: (path: string) => {
			syncReads.push(path);
			return syncFs.readDirectory(path);
		},
	} satisfies WalkerSyncFileSystem,
	path: posix,
};

const platform = handle.layer;

const compile = (source: string, dot = false): GlobPattern =>
	Result.getOrThrow(GlobPattern.compileResult(source, GlobPatternOptions.make({ dot })));

type Normal = { readonly ok: unknown } | { readonly error: { reason: string; path: string; limit?: number } };

const normalError = (error: DescendError) => ({
	reason: error.reason,
	path: error.path,
	...(error.limit === undefined ? {} : { limit: error.limit }),
});

/** A record-mode result with each cause reduced to its presence, so the two cause types compare. */
const normalOk = (value: unknown): unknown =>
	typeof value === "object" && value !== null && "unreadable" in value
		? {
				matches: (value as unknown as { matches: unknown }).matches,
				unreadable: (value as unknown as { unreadable: ReadonlyArray<{ path: string }> }).unreadable.map((u) => u.path),
			}
		: value;

const viaEffect = (pattern: GlobPattern, options: Record<string, unknown>): Normal => {
	const exit = Effect.runSyncExit(
		descend(pattern, { cwd: "/repo", ...options } as unknown as DescendOptions).pipe(Effect.provide(platform)),
	);
	if (Exit.isSuccess(exit)) return { ok: normalOk(exit.value) };
	const error = exit.cause.reasons.find((reason) => reason._tag === "Fail");
	if (error?._tag === "Fail" && error.error instanceof DescendError) return { error: normalError(error.error) };
	throw new Error("unexpected cause");
};

const viaSync = (pattern: GlobPattern, options: Record<string, unknown>): Normal => {
	const result = descendSync(pattern, { cwd: "/repo", ...options, ...ops } as unknown as Parameters<
		typeof descendSync
	>[1]);
	return Result.isSuccess(result) ? { ok: normalOk(result.success) } : { error: normalError(result.failure) };
};

const PATTERNS: ReadonlyArray<readonly [string, boolean]> = [
	["**", false],
	["**", true],
	["**/*.ts", false],
	["src/**", false],
	["!**/*.md", false],
	["packages/a/src/**", false],
	["packages/a/src/x.ts", false],
	["packages/b/package.json/not-a-marker.ts", false],
	["readme.md", false],
	["*.md", false],
	["src/*", false],
	["links/**", false],
	["../escape/**", false],
	["packages/a/src/{x,x.test}.ts", false],
	["{packages/a/src/x,packages/b/src/y}.ts", false],
	["packages/{a,b}/src/*.ts", false],
	["links/one/**", false],
	["links/one/src/y.ts", false],
	["links/file.ts", false],
	["links/one/src/*.ts", false],
];

const OPTIONS: ReadonlyArray<Record<string, unknown>> = [
	{},
	{ onUnreadable: "skip" },
	{ onUnreadable: "record" },
	{ followSymlinks: true, onUnreadable: "skip" },
	{ followSymlinks: true },
	{ followSymlinks: true, onUnreadable: "record" },
	{ boundaries: ["package.json"], onUnreadable: "skip" },
	{ boundaries: ["package.json"], followSymlinks: true, onUnreadable: "record" },
	{ prune: [], onUnreadable: "skip" },
	{ maxDepth: 1, onUnreadable: "skip" },
];

describe("descendSync parity with descend", () => {
	it("answers identically for every pattern × option combination", () => {
		let compared = 0;
		let distinct = 0;
		const seen = new Set<string>();
		for (const [source, dot] of PATTERNS) {
			for (const options of OPTIONS) {
				const pattern = compile(source, dot);
				const label = `${source} dot=${dot} ${JSON.stringify(options)}`;
				const effect = viaEffect(pattern, options);
				assert.deepStrictEqual(viaSync(pattern, options), effect, label);
				compared++;
				const key = JSON.stringify(effect);
				if (!seen.has(key)) distinct++;
				seen.add(key);
			}
		}
		assert.strictEqual(compared, PATTERNS.length * OPTIONS.length);
		// Control: the matrix is not comparing a sea of identical empty answers.
		assert.isAbove(distinct, 25);
	});

	it("descendEntriesSync carries the same entries as descendEntries", () => {
		const pattern = compile("**/*.ts");
		const options = { cwd: "/repo", onUnreadable: "skip" } as const;
		const effect = Effect.runSync(descendEntries(pattern, options).pipe(Effect.provide(platform)));
		const sync = Result.getOrThrow(descendEntriesSync(pattern, { ...options, ...ops }));
		assert.deepStrictEqual(
			sync.map((entry) => [entry.path, entry.info.isFile(), entry.info.size]),
			effect.map((entry) => [entry.path, entry.info.type === "File", Number(entry.info.size)]),
		);
		const mtimes = effect.map((entry) => Option.getOrThrow(entry.info.mtime).getTime());
		assert.deepStrictEqual(
			sync.map((entry) => Math.trunc(entry.info.mtimeMs)),
			mtimes,
		);
	});

	it("an invalid maxDepth is a defect in both forms", () => {
		const pattern = compile("**");
		assert.throws(() => descendSync(pattern, { cwd: "/repo", maxDepth: 0, ...ops }), /maxDepth/);
		const exit = Effect.runSyncExit(descend(pattern, { cwd: "/repo", maxDepth: 0 }).pipe(Effect.provide(platform)));
		assert.isTrue(Exit.isFailure(exit) && exit.cause.reasons.some((reason) => reason._tag === "Die"));
	});
});

describe("brace-only patterns are not literal paths", () => {
	const both = (source: string, options: Record<string, unknown> = {}) => {
		const pattern = compile(source);
		const effect = viaEffect(pattern, options);
		assert.deepStrictEqual(viaSync(pattern, options), effect, source);
		return effect;
	};

	it("a brace group in the last segment expands", () => {
		assert.deepStrictEqual(both("packages/a/src/{x,x.test}.ts"), {
			ok: ["packages/a/src/x.test.ts", "packages/a/src/x.ts"],
		});
	});

	it("a brace group before a trailing magic segment expands", () => {
		assert.deepStrictEqual(both("packages/{a,b}/src/*.ts"), {
			ok: ["packages/a/src/x.test.ts", "packages/a/src/x.ts", "packages/b/src/y.ts"],
		});
	});

	it("a brace group spanning segments expands", () => {
		assert.deepStrictEqual(both("{packages/a/src/x,packages/b/src/y}.ts"), {
			ok: ["packages/a/src/x.ts", "packages/b/src/y.ts"],
		});
	});
});

describe("directories read for a braced pattern", () => {
	const readsOf = (source: string) => {
		effectReads.length = 0;
		syncReads.length = 0;
		const pattern = compile(source);
		const effect = viaEffect(pattern, {});
		const sync = viaSync(pattern, {});
		assert.deepStrictEqual(sync, effect, source);
		assert.deepStrictEqual(
			[...syncReads].sort(),
			[...effectReads].sort(),
			`${source}: both forms read the same directories`,
		);
		return [...effectReads].sort();
	};

	it("src/{index,lib/util}.ts reads one level of src and of src/lib, nothing deeper", () => {
		assert.deepStrictEqual(readsOf("src/{index,lib/util}.ts"), ["/repo/src", "/repo/src/lib"]);
	});

	it("packages/{a,b}/src/*.ts reads only packages/a/src and packages/b/src", () => {
		assert.deepStrictEqual(readsOf("packages/{a,b}/src/*.ts"), ["/repo/packages/a/src", "/repo/packages/b/src"]);
	});

	it("{packages/a/src/x,packages/b/src/y}.ts reads each alternative's directory only", () => {
		assert.deepStrictEqual(readsOf("{packages/a/src/x,packages/b/src/y}.ts"), [
			"/repo/packages/a/src",
			"/repo/packages/b/src",
		]);
	});

	it("an alternative inside a deep one is read once, not twice", () => {
		const reads = readsOf("{packages/a/**,packages/a/src/*.ts}");
		assert.strictEqual(reads.filter((path) => path === "/repo/packages/a/src").length, 1);
	});
});

describe("prefixes spelled with ./ or a second alternative", () => {
	/** One pattern through both forms, which must agree on the answer and on the directories read. */
	const walk = (source: string, options: Record<string, unknown> = {}, dot = false) => {
		effectReads.length = 0;
		syncReads.length = 0;
		const pattern = compile(source, dot);
		const effect = viaEffect(pattern, options);
		assert.deepStrictEqual(viaSync(pattern, options), effect, source);
		assert.deepStrictEqual([...syncReads].sort(), [...effectReads].sort(), `${source}: both forms read alike`);
		return { result: effect, reads: [...effectReads].sort() };
	};

	const okOf = (result: unknown): ReadonlyArray<string> => (result as { ok: ReadonlyArray<string> }).ok;

	it("./ names cwd itself, which is never a boundary: ./*.ts and ./**/*.ts still match under boundaries", () => {
		const options = { boundaries: ["package.json"], onUnreadable: "skip" };
		assert.deepStrictEqual(walk("./*.ts", options, true).result, { ok: ["./.env.ts"] });
		const deep = okOf(walk("./**/*.ts", options).result);
		assert.deepStrictEqual(
			deep,
			okOf(walk("**/*.ts", options).result).map((path) => `./${path}`),
		);
		assert.include(deep, "./src/index.ts");
	});

	it("answers in the pattern's own spelling: ./src/*.ts, src/./lib/*.ts and the literal ./readme.md keep it", () => {
		assert.deepStrictEqual(walk("./src/*.ts").result, { ok: ["./src/index.ts"] });
		assert.deepStrictEqual(walk("src/./lib/*.ts").result, { ok: ["src/./lib/util.ts"] });
		assert.deepStrictEqual(walk("./readme.md").result, { ok: ["./readme.md"] });
	});

	it("reports a directory in the root's spelling: ./** records ./locked", () => {
		const { result } = walk("./**/*.ts", { onUnreadable: "record" });
		assert.deepStrictEqual((result as { ok: { unreadable: ReadonlyArray<string> } }).ok.unreadable, ["./locked"]);
	});

	it("{src,./src}/*.ts finds each file once, in the earliest alternative's spelling, and reads src once", () => {
		const { result, reads } = walk("{src,./src}/*.ts");
		assert.deepStrictEqual(result, { ok: ["src/index.ts"] });
		assert.deepStrictEqual(reads, ["/repo/src"]);
		assert.deepStrictEqual(walk("{./src,src}/*.ts").result, { ok: ["./src/index.ts"] });
	});

	it("{.,src}/** reads every directory once, src included, and answers ** in the ./ spelling", () => {
		const { result, reads } = walk("{.,src}/**", { onUnreadable: "skip" });
		assert.deepStrictEqual(
			okOf(result),
			okOf(walk("**", { onUnreadable: "skip" }).result).map((path) => `./${path}`),
		);
		assert.strictEqual(new Set(reads).size, reads.length, `no directory read twice: ${reads.join(", ")}`);
		assert.include(reads, "/repo/src");
		// Reversed, the src alternative comes first: src's files answer in its spelling, the rest in ./'s.
		const reversed = okOf(walk("{src,.}/**", { onUnreadable: "skip" }).result);
		assert.include(reversed, "src/index.ts");
		assert.notInclude(reversed, "./src/index.ts");
		assert.include(reversed, "./readme.md");
	});

	it("an alternative absorbed into a deep root keeps its own spelling: {./**/*.md,src/*.ts}", () => {
		const { result, reads } = walk("{./**/*.md,src/*.ts}", { onUnreadable: "skip" });
		assert.deepStrictEqual(result, { ok: ["./readme.md", "src/index.ts"] });
		assert.strictEqual(reads.filter((path) => path === "/repo/src").length, 1);
	});

	it("an alternative climbing above cwd contributes nothing beside a deep one, in either order", () => {
		// Each climbing alternative alone is zero matches; beside `**` it must not re-spell cwd's own files.
		assert.deepStrictEqual(walk("../x/*.md").result, { ok: [] });
		const ts = okOf(walk("**/*.ts", { onUnreadable: "skip" }).result);
		assert.deepStrictEqual(walk("{**/*.ts,../x/*.md}", { onUnreadable: "skip" }).result, { ok: ts });
		assert.deepStrictEqual(walk("{../x/*.md,**/*.md}", { onUnreadable: "skip" }).result, { ok: ["readme.md"] });
		assert.deepStrictEqual(walk("{**/*.md,src/../../x/*.md}", { onUnreadable: "skip" }).result, {
			ok: ["readme.md"],
		});
	});

	it("one prefix reached shallow and deep keeps the deep matches, whichever alternative comes first", () => {
		const deep = { ok: ["src/index.ts", "src/lib/deep/core.test.ts", "src/lib/util.ts"] };
		assert.deepStrictEqual(walk("{src/**/*.ts,src/*.ts}").result, deep);
		assert.deepStrictEqual(walk("{src/*.ts,src/**/*.ts}").result, deep);
	});
});

describe("a literal pattern through a symlinked directory", () => {
	it("is refused without followSymlinks and answered under it, in either form", () => {
		const pattern = compile("links/one/src/y.ts");
		assert.deepStrictEqual(viaEffect(pattern, {}), { ok: [] });
		assert.deepStrictEqual(viaSync(pattern, {}), { ok: [] });
		const followed = { ok: ["links/one/src/y.ts"] };
		assert.deepStrictEqual(viaEffect(pattern, { followSymlinks: true }), followed);
		assert.deepStrictEqual(viaSync(pattern, { followSymlinks: true }), followed);
	});

	it("a symlink that is the FILE still matches by default", () => {
		const pattern = compile("links/file.ts");
		assert.deepStrictEqual(viaEffect(pattern, {}), { ok: ["links/file.ts"] });
		assert.deepStrictEqual(viaSync(pattern, {}), { ok: ["links/file.ts"] });
	});
});

describe("a symlinked walk base", () => {
	it("is not entered without followSymlinks, in either form", () => {
		for (const options of [{}, { followSymlinks: false }]) {
			const pattern = compile("links/one/src/*.ts");
			assert.deepStrictEqual(viaEffect(pattern, options), { ok: [] });
			assert.deepStrictEqual(viaSync(pattern, options), { ok: [] });
		}
	});

	it("is not entered when the base ITSELF is the link, in either form", () => {
		const pattern = compile("links/one/**/*.ts");
		for (const options of [{}, { followSymlinks: false }]) {
			assert.deepStrictEqual(viaEffect(pattern, options), { ok: [] });
			assert.deepStrictEqual(viaSync(pattern, options), { ok: [] });
		}
		// Control: followed, the same base holds matches.
		const followed = { ok: ["links/one/package.json/not-a-marker.ts", "links/one/src/y.ts"] };
		assert.deepStrictEqual(viaEffect(pattern, { followSymlinks: true }), followed);
		assert.deepStrictEqual(viaSync(pattern, { followSymlinks: true }), followed);
	});

	it("is entered under followSymlinks: true, in either form", () => {
		const pattern = compile("links/one/src/*.ts");
		const expected = { ok: ["links/one/src/y.ts"] };
		assert.deepStrictEqual(viaEffect(pattern, { followSymlinks: true }), expected);
		assert.deepStrictEqual(viaSync(pattern, { followSymlinks: true }), expected);
	});
});

describe("boundaries", () => {
	const run = (source: string, options: Partial<DescendOptions> = {}) =>
		Result.getOrThrow(
			descendSync(compile(source), {
				cwd: "/repo",
				onUnreadable: "skip",
				boundaries: ["package.json"],
				...options,
				...ops,
			}),
		);

	it("a directory below cwd holding a marker file contributes nothing; cwd's own marker does not count", () => {
		const files = run("**/*.ts");
		assert.include(files, "src/index.ts");
		assert.notInclude(files, "packages/a/src/x.ts");
		assert.notInclude(files, "packages/a/src/x.test.ts");
	});

	it("a DIRECTORY named like a marker is not a boundary", () => {
		const files = run("**/*.ts");
		assert.include(files, "packages/b/src/y.ts");
		assert.include(files, "packages/b/package.json/not-a-marker.ts");
	});

	it("a walk that starts below a boundary, and a literal inside one, answer nothing", () => {
		assert.deepStrictEqual(run("packages/a/src/**"), []);
		assert.deepStrictEqual(run("packages/a/src/x.ts"), []);
		// Control: the same patterns without boundaries do match.
		assert.deepStrictEqual(run("packages/a/src/**", { boundaries: [] }), [
			"packages/a/src/x.test.ts",
			"packages/a/src/x.ts",
		]);
		assert.deepStrictEqual(run("packages/a/src/x.ts", { boundaries: [] }), ["packages/a/src/x.ts"]);
	});

	it("is the same in the Effect form", () => {
		const effect = Effect.runSync(
			descend(compile("**/*.ts"), { cwd: "/repo", onUnreadable: "skip", boundaries: ["package.json"] }).pipe(
				Effect.provide(platform),
			),
		);
		assert.deepStrictEqual(effect, run("**/*.ts"));
	});
});

describe("symlinks in the sync form", () => {
	it("never enters a symlinked directory by default; follows links under the cycle guard when asked", () => {
		const plain = Result.getOrThrow(descendSync(compile("**"), { cwd: "/repo", onUnreadable: "skip", ...ops }));
		assert.notInclude(plain, "links/one/src/y.ts");
		assert.notInclude(plain, "src/loop/index.ts");
		// A symlinked FILE still matches.
		assert.include(plain, "links/file.ts");

		const followed = Result.getOrThrow(
			descendSync(compile("**"), { cwd: "/repo", onUnreadable: "skip", followSymlinks: true, ...ops }),
		);
		// Both sibling links enumerate; the loop back to an ancestor terminates.
		assert.include(followed, "links/one/src/y.ts");
		assert.include(followed, "links/two/src/y.ts");
		assert.notInclude(followed, "src/loop/index.ts");
	});
});
