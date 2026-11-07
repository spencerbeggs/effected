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

const effectReads: Array<string> = [];
const handle = MemoryFileSystem.makeSync(TREE, {
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

const compile = (source: string, dot = false): GlobPattern =>
	Result.getOrThrow(GlobPattern.compileResult(source, GlobPatternOptions.make({ dot })));

/** Both drivers' matches and reads; the two must agree before either is returned. */
const walk = (pattern: GlobPattern, options: Omit<DescendOptions, "cwd"> = {}) => {
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
});
