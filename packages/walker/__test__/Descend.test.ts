import { assert, layer } from "@effect/vitest";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import { Effect } from "effect";
import { descend } from "../src/Descend.js";
import { platform } from "./fixtures.js";

// The main tree: nesting, a dotfile, both default-pruned directories, and a
// second top-level directory so sorted output diverges from walk order.
const mainTree = {
	"/proj/readme.md": "",
	"/proj/dist/out.ts": "",
	"/proj/src/index.ts": "",
	"/proj/src/.hidden.ts": "",
	"/proj/src/lib/util.ts": "",
	"/proj/src/lib/deep/core.ts": "",
	"/proj/node_modules/dep/index.ts": "",
	"/proj/.git/hooks/config.ts": "",
};

layer(platform(mainTree))("descend, literal fast-path", (it) => {
	it.effect("returns the source when it resolves to a file", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("readme.md");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), ["readme.md"]);
		}),
	);

	it.effect("returns empty when the literal resolves to a directory", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), []);
		}),
	);

	it.effect("returns empty when the literal is missing — zero matches, not an error", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("no-such-file.md");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), []);
		}),
	);
});

layer(platform(mainTree))("descend, magic patterns", (it) => {
	it.effect("descends a globstar pattern through every level, sorted by relative path", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src/**/*.ts");
			// Walk order is breadth-first (lib/util.ts before lib/deep/core.ts);
			// sorted output pins deep/core.ts BEFORE util.ts.
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), [
				"src/index.ts",
				"src/lib/deep/core.ts",
				"src/lib/util.ts",
			]);
		}),
	);

	it.effect("matches a single-level * pattern one level only", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src/*.ts");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), ["src/index.ts"]);
		}),
	);

	it.effect("never descends the default prune list (node_modules, .git)", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("**/*.ts");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), [
				"dist/out.ts",
				"src/index.ts",
				"src/lib/deep/core.ts",
				"src/lib/util.ts",
			]);
		}),
	);

	it.effect("a custom prune list replaces the default entirely", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("**/*.ts");
			const found = yield* descend(pattern, { cwd: "/proj", prune: ["src", "dist", ".git"] });
			assert.deepStrictEqual(found, ["node_modules/dep/index.ts"]);
		}),
	);

	it.effect("skips dotfiles under default options and matches them when the pattern carries dot", () =>
		Effect.gen(function* () {
			// Dotfile semantics live in the COMPILED pattern, never in the walker.
			const plain = yield* GlobPattern.compile("src/*.ts");
			const dotted = yield* GlobPattern.compile("src/*.ts", GlobPatternOptions.make({ dot: true }));
			assert.deepStrictEqual(yield* descend(plain, { cwd: "/proj" }), ["src/index.ts"]);
			assert.deepStrictEqual(yield* descend(dotted, { cwd: "/proj" }), ["src/.hidden.ts", "src/index.ts"]);
		}),
	);

	it.effect("returns empty when the pattern's base directory is missing", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("missing/**/*.ts");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), []);
		}),
	);

	// `descend`'s defect posture is `ascend`'s: a bad bound is a programmer
	// error, never a silently-empty result. The error channel carries only
	// DescendError, so a Failure exit here can only be a defect.
	it.effect("dies when maxDepth is 0", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src/**/*.ts");
			const exit = yield* Effect.exit(descend(pattern, { cwd: "/proj", maxDepth: 0 }));
			assert.strictEqual(exit._tag, "Failure");
		}),
	);

	it.effect("dies when maxDepth is NaN", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src/**/*.ts");
			const exit = yield* Effect.exit(descend(pattern, { cwd: "/proj", maxDepth: Number.NaN }));
			assert.strictEqual(exit._tag, "Failure");
		}),
	);

	it.effect("dies when maxDepth is not an integer", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src/**/*.ts");
			const exit = yield* Effect.exit(descend(pattern, { cwd: "/proj", maxDepth: 2.5 }));
			assert.strictEqual(exit._tag, "Failure");
		}),
	);
});

// Symlinks: a link to a file, a link to a directory, and a dangling link, all
// inside the walked subtree.
const symlinkTree = {
	"/proj/real/file.ts": "",
	"/proj/real/dir/inner.ts": "",
	"/proj/src/a.ts": "",
};
const symlinkOptions = {
	symlinks: {
		"/proj/src/link.ts": "/proj/real/file.ts",
		"/proj/src/linkdir": "/proj/real/dir",
		"/proj/src/ghost.ts": "/proj/real/gone.ts",
	},
};

layer(platform(symlinkTree, symlinkOptions))("descend, symlinks", (it) => {
	it.effect("matches a symlink that resolves to a file and skips a dangling one", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src/*.ts");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), ["src/a.ts", "src/link.ts"]);
		}),
	);

	it.effect("never descends into a symlinked directory", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src/**/*.ts");
			// linkdir/inner.ts must NOT appear; the same file is reachable (and
			// matched) only through its real path.
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), ["src/a.ts", "src/link.ts"]);
		}),
	);

	it.effect("still matches the symlinked directory's files through their real path", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("**/*.ts");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), [
				"real/dir/inner.ts",
				"real/file.ts",
				"src/a.ts",
				"src/link.ts",
			]);
		}),
	);
});

// An unreadable directory inside the walked subtree.
const unreadableTree = {
	"/proj/src/a.ts": "",
	"/proj/src/locked/b.ts": "",
};
const unreadableOptions = { unreadable: new Set(["/proj/src/locked"]) };

layer(platform(unreadableTree, unreadableOptions))("descend, unreadable directory", (it) => {
	it.effect("fails typed by default, carrying the pattern and the offending relative directory", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src/**/*.ts");
			const error = yield* Effect.flip(descend(pattern, { cwd: "/proj" }));
			assert.strictEqual(error._tag, "DescendError");
			assert.strictEqual(error.reason, "unreadableDirectory");
			assert.strictEqual(error.pattern, "src/**/*.ts");
			assert.strictEqual(error.path, "src/locked");
		}),
	);

	it.effect("absorbs the subtree and continues under onUnreadable: skip", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src/**/*.ts");
			const found = yield* descend(pattern, { cwd: "/proj", onUnreadable: "skip" });
			assert.deepStrictEqual(found, ["src/a.ts"]);
		}),
	);

	it.effect("a single-level pattern never reads the unreadable subdirectory at all", () =>
		Effect.gen(function* () {
			// src/*.ts cannot match below one level, so descend never descends —
			// and the unreadable directory cannot fail a walk that never reads it.
			const pattern = yield* GlobPattern.compile("src/*.ts");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), ["src/a.ts"]);
		}),
	);
});

// A directory that vanishes between its parent's listing and its own read.
const vanishedTree = { "/proj/src/a.ts": "" };
const vanishedOptions = { vanished: new Set(["/proj/src/gone"]) };

layer(platform(vanishedTree, vanishedOptions))("descend, vanished directory", (it) => {
	it.effect("treats a NotFound mid-walk as a benign race, even under onUnreadable: fail", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("src/**/*.ts");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj" }), ["src/a.ts"]);
		}),
	);
});

// A tree deep enough to trip a small maxDepth.
const deepTree = { "/proj/a/b/c/d.ts": "" };

layer(platform(deepTree))("descend, depth cap", (it) => {
	it.effect("fails typed when the walk would descend past maxDepth — never truncates", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("**/*.ts");
			const error = yield* Effect.flip(descend(pattern, { cwd: "/proj", maxDepth: 1 }));
			assert.strictEqual(error._tag, "DescendError");
			assert.strictEqual(error.reason, "depthExceeded");
			assert.strictEqual(error.pattern, "**/*.ts");
			assert.strictEqual(error.path, "a");
			assert.strictEqual(error.limit, 1);
		}),
	);

	it.effect("succeeds when maxDepth admits the whole tree", () =>
		Effect.gen(function* () {
			const pattern = yield* GlobPattern.compile("**/*.ts");
			assert.deepStrictEqual(yield* descend(pattern, { cwd: "/proj", maxDepth: 3 }), ["a/b/c/d.ts"]);
		}),
	);
});
