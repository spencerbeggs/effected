// `PosixPath` against `node:path/posix` as the oracle — the implementation
// both core's `Path.layer` and `PosixPath` are ported from. Every total member
// is checked over one fixture table; `relative` is checked against the oracle
// rooted at several working directories, because its contract is "answer
// exactly when every working directory agrees, throw otherwise".

import { posix } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { PosixPath } from "../src/PosixPath.js";

const PATHS: ReadonlyArray<string> = [
	"",
	".",
	"..",
	"/",
	"//",
	"///",
	"a",
	"a/",
	"a//",
	"/a",
	"/a/",
	"//a",
	"//a/b",
	"a/b/c",
	"a//b///c",
	"./a",
	"../a",
	"../../a/b",
	"a/../b",
	"a/b/../../..",
	"a/b/../../../c",
	"/../a",
	"/a/../..",
	"/a/./b/../c/",
	"a/./b/.",
	".a",
	"a/.b",
	"a/b.",
	"a.b.c",
	"..a",
	"a/..b/c.d",
	"file.ts",
	"/dir/file.test.ts",
	".env",
	"..",
	"a/b/",
	"/a/b//",
	"...",
	"a/.../b",
];

describe("PosixPath total members agree with node:path/posix", () => {
	it("normalize, dirname, basename, extname, isAbsolute over the fixture table", () => {
		let checked = 0;
		for (const path of PATHS) {
			assert.strictEqual(PosixPath.normalize(path), posix.normalize(path), `normalize(${JSON.stringify(path)})`);
			assert.strictEqual(PosixPath.dirname(path), posix.dirname(path), `dirname(${JSON.stringify(path)})`);
			assert.strictEqual(PosixPath.basename(path), posix.basename(path), `basename(${JSON.stringify(path)})`);
			assert.strictEqual(PosixPath.extname(path), posix.extname(path), `extname(${JSON.stringify(path)})`);
			assert.strictEqual(PosixPath.isAbsolute(path), posix.isAbsolute(path), `isAbsolute(${JSON.stringify(path)})`);
			checked += 1;
		}
		assert.strictEqual(checked, PATHS.length);
	});

	it("basename with a suffix", () => {
		const cases: ReadonlyArray<readonly [string, string]> = [
			["a/b.ts", ".ts"],
			["a/b.ts", "b.ts"],
			["a/b.ts", "ts"],
			["a/b.ts", ".js"],
			["a/b.ts/", ".ts"],
			[".ts", ".ts"],
			["b.ts", "b.ts"],
			["/a/b", "b"],
			["", "x"],
			["a", ""],
		];
		for (const [path, suffix] of cases) {
			assert.strictEqual(PosixPath.basename(path, suffix), posix.basename(path, suffix), `${path} ${suffix}`);
		}
	});

	it("join over pairs and triples from the table, and the empty join", () => {
		assert.strictEqual(PosixPath.join(), posix.join());
		assert.strictEqual(PosixPath.join("", ""), posix.join("", ""));
		for (const a of PATHS) {
			for (const b of PATHS) {
				assert.strictEqual(PosixPath.join(a, b), posix.join(a, b), `join(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
			}
			assert.strictEqual(PosixPath.join(a, "x", "../y"), posix.join(a, "x", "../y"));
		}
	});

	it("sep is the POSIX separator", () => {
		assert.strictEqual(PosixPath.sep, posix.sep);
	});

	it("the members pass as callbacks unbound", () => {
		const { dirname } = PosixPath;
		assert.deepStrictEqual(["/a/b", "c/d"].map(dirname), ["/a", "c"]);
	});
});

// Working directories for the oracle: every three-level path over names that
// collide with the fixture segments. Three levels outclimb every fixture (the
// deepest climbs two), and the collisions are the point — an answer that
// depends on an ancestor's name disagrees between a working directory whose
// ancestor is named like the fixture's next segment and one whose is not.
const NAMES: ReadonlyArray<string> = ["a", "b", "c", "x", "w"];
const CWDS: ReadonlyArray<string> = NAMES.flatMap((one) =>
	NAMES.flatMap((two) => NAMES.map((three) => `/${one}/${two}/${three}`)),
);

/** The oracle's answer under every working directory, or `undefined` when they disagree. */
const cwdFree = (from: string, to: string): string | undefined => {
	const answers = new Set(CWDS.map((cwd) => posix.relative(posix.join(cwd, from), posix.join(cwd, to))));
	return answers.size === 1 ? [...answers][0] : undefined;
};

describe("PosixPath.relative", () => {
	it("two absolute paths answer exactly as node:path/posix", () => {
		const absolute = PATHS.filter((path) => path.startsWith("/"));
		let checked = 0;
		for (const from of absolute) {
			for (const to of absolute) {
				assert.strictEqual(PosixPath.relative(from, to), posix.relative(from, to), `${from} -> ${to}`);
				checked += 1;
			}
		}
		assert.isAbove(checked, 50);
		assert.strictEqual(PosixPath.relative("/a/b/c", "/a/d"), "../../d");
		assert.strictEqual(PosixPath.relative("/", "/a/b"), "a/b");
		assert.strictEqual(PosixPath.relative("/a/b", "/"), "../..");
		assert.strictEqual(PosixPath.relative("/a/b/", "/a/b"), "");
	});

	it("two relative paths answer exactly when every working directory agrees, and throw otherwise", () => {
		const relative = [...PATHS.filter((path) => !path.startsWith("/")), "a/c", "../b", "../a", "../../b", "b/c"];
		let answered = 0;
		let refused = 0;
		for (const from of relative) {
			for (const to of relative) {
				const expected = cwdFree(from, to);
				const label = `${JSON.stringify(from)} -> ${JSON.stringify(to)}`;
				if (expected === undefined) {
					assert.throws(() => PosixPath.relative(from, to), /PosixPath\.relative/, label);
					refused += 1;
				} else {
					assert.strictEqual(PosixPath.relative(from, to), expected, label);
					answered += 1;
				}
			}
		}
		// Control: both branches are exercised many times over, so neither is vacuous.
		assert.isAbove(answered, 200);
		assert.isAbove(refused, 100);
	});

	it("the documented cases", () => {
		assert.strictEqual(PosixPath.relative("a/b", "a/c"), "../c");
		assert.strictEqual(PosixPath.relative("a/b", ".."), "../../..");
		assert.strictEqual(PosixPath.relative("okf/modules", "okf/decisions/x.md"), "../decisions/x.md");
		assert.strictEqual(PosixPath.relative("../x", "../y/z"), "../y/z");
		assert.throws(() => PosixPath.relative("../a", "b"), /working directory/);
		assert.throws(() => PosixPath.relative("a", "../b"), /working directory/);
	});

	it("one absolute and one relative path throw in either order", () => {
		assert.throws(() => PosixPath.relative("/a", "b"), /one absolute and one relative/);
		assert.throws(() => PosixPath.relative("b", "/a"), /one absolute and one relative/);
	});
});
