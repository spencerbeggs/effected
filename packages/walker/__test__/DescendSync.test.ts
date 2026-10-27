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

const handle = MemoryFileSystem.makeSync(TREE, {
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
 * memfs's own sync fault machinery. The port has no `realPath`, so that member
 * bridges the handle's `FileSystem` (and mirrors its two realPath faults as the
 * errno a node `realpathSync` would throw).
 */
const faulted = handle.withFaults({
	sync: {
		readDirectory: (path: string) => {
			if (path === UNREADABLE) throw MemoryFileSystem.errno("EACCES", "scandir", path);
			if (path === VANISH) throw MemoryFileSystem.errno("ENOENT", "scandir", path);
			return undefined;
		},
	},
}).sync;
const syncFs: WalkerSyncFileSystem = {
	readDirectory: (path) => faulted.readDirectory(path),
	stat: faulted.stat,
	lstat: faulted.lstat,
	realPath: (path) => {
		const exit = Effect.runSyncExit(handle.fileSystem.realPath(path));
		if (Exit.isSuccess(exit)) return exit.value;
		const reason = exit.cause.reasons.find((r) => r._tag === "Fail");
		const tag = reason?._tag === "Fail" ? (reason.error as PlatformError.PlatformError).reason._tag : "Unknown";
		throw MemoryFileSystem.errno(tag === "NotFound" ? "ENOENT" : "EACCES", "realpath", path);
	},
};
const ops = { fileSystem: syncFs, path: posix };

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
			sync.map((entry) => [entry.path, entry.stat.isFile(), entry.stat.size]),
			effect.map((entry) => [entry.path, entry.info.type === "File", Number(entry.info.size)]),
		);
		const mtimes = effect.map((entry) => Option.getOrThrow(entry.info.mtime).getTime());
		assert.deepStrictEqual(
			sync.map((entry) => Math.trunc(entry.stat.mtimeMs)),
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
