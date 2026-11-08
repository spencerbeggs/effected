// `descend` reads only the directories a match can lie in: never deeper than a
// pattern without a globstar can reach, and never into a hidden directory a
// `dot: false` pattern cannot match inside. Both bounds come from the compiled
// pattern; neither changes what matches. Every case is checked through BOTH
// drivers over one memfs volume, counting the directories each one reads.

import { posix } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import type { MemoryFileSystemSeedEntry } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Result } from "effect";
import type { DescendOptions } from "../src/Descend.js";
import { descend } from "../src/Descend.js";
import { descendSync } from "../src/DescendSync.js";
import { segmentBound, skipsHiddenDirectories } from "../src/internal/patternBounds.js";

// The issue's tree: `packages/{a/deep/deeper,a/node_modules/x,.hidden}`.
const TREE: Readonly<Record<string, MemoryFileSystemSeedEntry>> = {
	"/repo/packages/a/README.md": "",
	"/repo/packages/a/deep/deeper/README.md": "",
	"/repo/packages/a/node_modules/x/README.md": "",
	"/repo/packages/.hidden/README.md": "",
};

/** A volume whose reads both drivers count, so a walk's reads can be compared across them. */
const volume = (tree: Readonly<Record<string, MemoryFileSystemSeedEntry>>) => {
	const effectReads: Array<string> = [];
	const handle = MemoryFileSystem.makeSync(tree, {
		spies: { readDirectory: (path: string) => void effectReads.push(path) },
	});
	const syncReads: Array<string> = [];
	const ops = {
		fileSystem: {
			...handle.sync,
			readDirectory: (path: string) => {
				syncReads.push(path);
				return handle.sync.readDirectory(path);
			},
		},
		path: posix,
	};
	return { effectReads, handle, syncReads, ops };
};

const repo = volume(TREE);

const compile = (source: string, dot = false, options: Omit<GlobPatternOptions, "dot"> = {}): GlobPattern =>
	Result.getOrThrow(GlobPattern.compileResult(source, GlobPatternOptions.make({ ...options, dot })));

/** Both drivers' matches and reads; the two must agree before either is returned. */
const walk = (pattern: GlobPattern, options: Omit<DescendOptions, "cwd"> = {}, on = repo) => {
	const { effectReads, handle, syncReads, ops } = on;
	effectReads.length = 0;
	syncReads.length = 0;
	const viaEffect = Effect.runSync(
		Effect.result(descend(pattern, { cwd: "/repo", ...options })).pipe(Effect.provide(handle.layer)),
	);
	const viaSync = descendSync(pattern, { cwd: "/repo", ...options, ...ops });
	const outcome = (result: typeof viaSync | typeof viaEffect) =>
		Result.isSuccess(result) ? { matches: result.success } : { reason: result.failure.reason };
	assert.deepStrictEqual(outcome(viaSync), outcome(viaEffect), `${pattern.source}: drivers disagree on the answer`);
	assert.deepStrictEqual([...syncReads], [...effectReads], `${pattern.source}: drivers disagree on the reads`);
	return { ...outcome(viaEffect), reads: [...effectReads].sort() };
};

describe("descend reads only what the pattern can reach", () => {
	it("packages/*/README.md reads packages and packages/a, and nothing else (the issue's case)", () => {
		const { matches, reads } = walk(compile("packages/*/README.md"), { match: "any", onUnreadable: "skip" });
		assert.deepStrictEqual(matches, ["packages/a/README.md"]);
		assert.deepStrictEqual(reads, ["/repo/packages", "/repo/packages/a"]);
	});

	it("a globstar still descends to every depth, but not into a hidden directory under dot: false", () => {
		const { matches, reads } = walk(compile("packages/**/README.md"));
		assert.deepStrictEqual(matches, ["packages/a/README.md", "packages/a/deep/deeper/README.md"]);
		assert.deepStrictEqual(reads, [
			"/repo/packages",
			"/repo/packages/a",
			"/repo/packages/a/deep",
			"/repo/packages/a/deep/deeper",
		]);
	});

	it("dot: true enters the hidden directory, and matches inside it", () => {
		const { matches, reads } = walk(compile("packages/*/README.md", true));
		assert.deepStrictEqual(matches, ["packages/.hidden/README.md", "packages/a/README.md"]);
		assert.deepStrictEqual(reads, ["/repo/packages", "/repo/packages/.hidden", "/repo/packages/a"]);
		const deep = walk(compile("packages/**/README.md", true));
		assert.include(deep.reads, "/repo/packages/.hidden");
		assert.include(deep.matches ?? [], "packages/.hidden/README.md");
	});

	it("a pattern that names a hidden directory enters it under dot: false", () => {
		const { matches, reads } = walk(compile("packages/.hidden/*.md"));
		assert.deepStrictEqual(matches, ["packages/.hidden/README.md"]);
		assert.deepStrictEqual(reads, ["/repo/packages/.hidden"]);
		const named = walk(compile("packages/{.hidden,a}/README.md"));
		assert.deepStrictEqual(named.matches, ["packages/.hidden/README.md", "packages/a/README.md"]);
	});

	it("matchBase: a slash-less ** matches by basename, so the walk still reads hidden directories", () => {
		// `**` under `matchBase` matches `.a/f.js` by its basename, though `dot` is off: the probe cannot see
		// `matchBase`, so a slash-less pattern is never pruned.
		const based = volume({ "/repo/.a/f.js": "", "/repo/b/f.js": "" });
		const { matches, reads } = walk(compile("**", false, { matchBase: true }), {}, based);
		assert.deepStrictEqual(matches, [".a/f.js", "b/f.js"]);
		assert.include(reads, "/repo/.a");
		// Control: `matchBase` changes only slash-less patterns, so one with a slash still skips the hidden directory.
		const nested = volume({ "/repo/src/.a/f.js": "", "/repo/src/b/f.js": "" });
		const control = walk(compile("src/**", false, { matchBase: true }), {}, nested);
		assert.deepStrictEqual(control.matches, ["src/b/f.js"]);
		assert.notInclude(control.reads, "/repo/src/.a");
		assert.include(control.reads, "/repo/src/b");
	});

	it("matchBase: a .. segment collapses x/../** to one segment, so the walk still reads hidden directories", () => {
		// glob pops `<p>/..` at the default optimization level, leaving the one-segment row `**`, which `matchBase`
		// matches by basename: `x/../**` matches `.a/f.js` and `x/.h/g.js` though the source has a slash.
		const tree = { "/repo/.a/f.js": "", "/repo/b/f.js": "", "/repo/x/keep.txt": "", "/repo/x/.h/g.js": "" };
		for (const source of ["x/../**", "a/b/../../**", "*/../**"]) {
			const { matches, reads } = walk(compile(source, false, { matchBase: true }), {}, volume(tree));
			assert.deepStrictEqual(matches, [".a/f.js", "b/f.js", "x/.h/g.js", "x/keep.txt"], source);
			assert.include(reads, "/repo/.a", source);
			assert.include(reads, "/repo/x/.h", source);
		}
		// Control: the same tree under `x/**` keeps its slash and its two segments, so `.h` is still skipped.
		const control = walk(compile("x/**", false, { matchBase: true }), {}, volume(tree));
		assert.deepStrictEqual(control.matches, ["x/keep.txt"]);
		assert.notInclude(control.reads, "/repo/x/.h");
	});

	it("matchBase: adjacent globstars merge **/** to one segment, so the walk still reads hidden directories", () => {
		// glob merges a run of adjacent globstars at every optimization level, leaving the one-segment row `**`, which
		// `matchBase` matches by basename: `**/**` matches `.a/f.js` and `x/.h/g.js` though the source has a slash.
		const tree = { "/repo/.a/f.js": "", "/repo/b/f.js": "", "/repo/x/keep.txt": "", "/repo/x/.h/g.js": "" };
		const cases: ReadonlyArray<readonly [string, Omit<GlobPatternOptions, "dot">]> = [
			["**/**", { matchBase: true }],
			["**/**/**", { matchBase: true }],
			["**/./**", { matchBase: true, optimizationLevel: 2 }],
		];
		for (const [source, options] of cases) {
			const { matches, reads } = walk(compile(source, false, options), {}, volume(tree));
			assert.deepStrictEqual(matches, [".a/f.js", "b/f.js", "x/.h/g.js", "x/keep.txt"], source);
			assert.include(reads, "/repo/.a", source);
			assert.include(reads, "/repo/x/.h", source);
		}
		// Control: a globstar run under a literal keeps two segments, so the hidden directory is still skipped.
		const control = walk(compile("x/**/**", false, { matchBase: true }), {}, volume(tree));
		assert.deepStrictEqual(control.matches, ["x/keep.txt"]);
		assert.notInclude(control.reads, "/repo/x/.h");
	});

	it("the depth bound is per pattern: one segment deeper reads one level deeper, and no further", () => {
		const three = walk(compile("packages/*/*/README.md"));
		assert.deepStrictEqual(three.matches, []);
		assert.deepStrictEqual(three.reads, ["/repo/packages", "/repo/packages/a", "/repo/packages/a/deep"]);
		const four = walk(compile("packages/*/*/*/README.md"));
		assert.deepStrictEqual(four.matches, ["packages/a/deep/deeper/README.md"]);
		assert.deepStrictEqual(four.reads, [
			"/repo/packages",
			"/repo/packages/a",
			"/repo/packages/a/deep",
			"/repo/packages/a/deep/deeper",
		]);
	});

	it("maxDepth governs only the directories the walk reads", () => {
		// The bounded pattern never needs a directory past depth 1, so a cap of 1 does not trip.
		assert.deepStrictEqual(walk(compile("packages/*/README.md"), { maxDepth: 1 }).matches, ["packages/a/README.md"]);
		// A globstar does read that deep, so the same cap still fails typed, never truncating.
		assert.strictEqual(walk(compile("packages/**/README.md"), { maxDepth: 1 }).reason, "depthExceeded");
	});

	it("an unreadable directory the pattern cannot reach is never read, so it cannot fail the walk", () => {
		const locked = MemoryFileSystem.makeSync(TREE).withFaults({
			sync: {
				readDirectory: (path: string) => {
					if (path === "/repo/packages/a/deep" || path === "/repo/packages/.hidden") {
						throw MemoryFileSystem.errno("EACCES", "scandir", path);
					}
					return undefined;
				},
			},
		});
		const lockedOps = { fileSystem: locked.sync, path: posix };
		assert.deepStrictEqual(
			Result.getOrThrow(descendSync(compile("packages/*/README.md"), { cwd: "/repo", ...lockedOps })),
			["packages/a/README.md"],
		);
		// Control: a pattern that does reach it fails on it.
		const reaching = descendSync(compile("packages/**/README.md"), { cwd: "/repo", ...lockedOps });
		assert.isTrue(Result.isFailure(reaching) && reaching.failure.reason === "unreadableDirectory");
	});
});

describe("the pattern bounds", () => {
	it("segmentBound counts segments, sheds a leading ./ and a trailing /, and has none for ** or negation", () => {
		const cases: ReadonlyArray<readonly [string, number | undefined]> = [
			["packages/*/README.md", 3],
			["./packages/*/README.md", 3],
			["packages/*/", 2],
			["*", 1],
			["{a,b/c}/*.ts", 3],
			["a/{b,c/d}/*", 4],
			["packages/**/README.md", undefined],
			["a/**", undefined],
			["!packages/*/x", undefined],
		];
		for (const [source, bound] of cases) assert.strictEqual(segmentBound(compile(source)), bound, source);
	});

	it("skipsHiddenDirectories proves dot: false by probing, and refuses what it cannot model", () => {
		const cases: ReadonlyArray<readonly [string, boolean, boolean]> = [
			["packages/*/README.md", false, true],
			["packages/*/README.md", true, false],
			["**/*.ts", false, true],
			["**/*.ts", true, false],
			["src/a*/x", false, true],
			["src/a*/x", true, true],
			["packages/.hidden/*", false, false],
			["./src/*/x", false, true],
			["{a,.b}/*", false, false],
			["[.]x/*", false, false],
			["?x/*", false, false],
			["!**/*.md", false, false],
		];
		for (const [source, dot, expected] of cases) {
			assert.strictEqual(skipsHiddenDirectories(compile(source, dot)), expected, `${source} dot=${dot}`);
		}
	});

	it("skipsHiddenDirectories never prunes a pattern matchBase can match by basename: slash-less, or collapsed to one segment", () => {
		const cases: ReadonlyArray<readonly [string, boolean]> = [
			["**", false],
			["*.js", false],
			["*/", false],
			["x/../**", false],
			["a/b/../../**", false],
			["*/../**", false],
			["**/**", false],
			["**/**/**", false],
			["**/.", false],
			["src/**", true],
			["src/**/**", true],
			["**/*.js", true],
			["**/**/*.js", true],
			["./**", true],
			["./**/**", true],
		];
		for (const [source, expected] of cases) {
			assert.strictEqual(skipsHiddenDirectories(compile(source, false, { matchBase: true })), expected, source);
		}
		// At optimization level 2 glob also drops a middle `.`, so `**/./**` merges to `**` too.
		assert.isFalse(skipsHiddenDirectories(compile("**/./**", false, { matchBase: true, optimizationLevel: 2 })));
	});
});
