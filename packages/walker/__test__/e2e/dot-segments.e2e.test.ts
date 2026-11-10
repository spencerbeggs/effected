// `.` and `..` in a pattern's literal segments, over a real filesystem (#1290). A kernel resolves them
// physically: `f.js/..` is ENOTDIR, and `link/e/..` reaches through the link it names. A walk joins paths,
// which folds them lexically, so the walk must only ever answer through a spelling a real filesystem
// resolves, and, without `followSymlinks`, only through one that crosses no link.
//
// The oracle is a brute-force filter over the real tree: every entry an `lstat`-classified recursive
// `readdirSync` reaches (links listed, never entered), re-spelled through each leading literal run of the
// pattern, kept when `GlobPattern.matches` accepts the spelling AND that spelling resolves physically
// under `lstatSync`. Both drivers run against it: `descendSync` over real `node:fs`, and the same walk over
// a memfs volume holding the same tree, which answers `.`/`..` after a file as node does (#1284).

import { lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import { MemoryFileSystem } from "@effected/memfs";
import { Result } from "effect";
import type { DescendOptions } from "../../src/Descend.js";

/** A row's walk options: the root is the tree's, supplied per driver. */
type RowOptions = Omit<DescendOptions, "cwd">;

import { descendSync } from "../../src/DescendSync.js";
import { resolveSegments } from "../../src/internal/segments.js";
import { nodeWalkerSyncOps } from "../../src/node-sync.js";

/** The tree, relative to the root: `f.js` is a FILE beside the directories, `link` a link to `real`. */
const FILES = ["a.js", "f.js", "x/b.js", "real/e/c.js", "real/d.js"] as const;
const LINKS = { link: "real" } as const;

const withTree = <A>(f: (root: string) => A): A => {
	const root = mkdtempSync(join(tmpdir(), "walker-dots-"));
	try {
		for (const file of FILES) {
			mkdirSync(join(root, posix.dirname(file)), { recursive: true });
			writeFileSync(join(root, file), "");
		}
		for (const [name, target] of Object.entries(LINKS)) symlinkSync(join(root, target), join(root, name));
		return f(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
};

const memoryOps = () => {
	const seed: Record<string, string | ReturnType<typeof MemoryFileSystem.symlink>> = {};
	for (const file of FILES) seed[`/repo/${file}`] = "";
	for (const [name, target] of Object.entries(LINKS))
		seed[`/repo/${name}`] = MemoryFileSystem.symlink(`/repo/${target}`);
	return { fileSystem: MemoryFileSystem.makeSync(seed).sync, path: posix };
};

/**
 * Whether `spelling` resolves on the real tree the way a stat of it would, with no link crossed unless
 * `follow`. Without `follow`, every directory it passes through is a real directory (`lstat`). With it, a
 * link may be passed through, so a directory need only `stat` as one, except the directory a `..` follows:
 * that one is a real directory (`lstat`) even under `follow`, since the kernel resolves the `..` from a
 * link's target, never lexically. A `.` or empty segment after a link is the link's target itself.
 */
const resolvesPhysically = (root: string, spelling: string, follow: boolean): boolean => {
	const raw = spelling.split("/");
	for (let index = 0; index < raw.length - 1; index++) {
		const before = resolveSegments(raw.slice(0, index + 1));
		if (before === undefined) return false;
		if (before.length === 0) continue;
		const path = join(root, ...before);
		const real = !follow || raw[index + 1] === "..";
		try {
			if (!(real ? lstatSync(path) : statSync(path)).isDirectory()) return false;
		} catch {
			return false;
		}
	}
	return true;
};

/** Every entry under `root`, canonical and relative, with its kind; links listed, entered only when `follow`. */
const enumerate = (root: string, follow: boolean): Array<{ readonly path: string; readonly kind: "file" | "dir" }> => {
	const out: Array<{ readonly path: string; readonly kind: "file" | "dir" }> = [];
	const visit = (relative: string): void => {
		for (const name of readdirSync(join(root, relative))) {
			const path = relative === "" ? name : `${relative}/${name}`;
			const link = lstatSync(join(root, path)).isSymbolicLink();
			const directory = statSync(join(root, path)).isDirectory();
			out.push({ path, kind: directory ? "dir" : "file" });
			if (directory && (!link || follow)) visit(path);
		}
	};
	visit("");
	return out;
};

const bruteForce = (root: string, pattern: GlobPattern, options: RowOptions): Map<string, Set<string>> => {
	const follow = options.followSymlinks ?? false;
	const match = options.match ?? "file";
	const raw = pattern.source.split("/");
	// The leading literal run, every length: `x/../*.js` spells `x/`, `x/../`; the whole source when it is literal.
	const spellings: Array<{ readonly spelling: string; readonly prefix: string }> = [{ spelling: "", prefix: "" }];
	for (let length = 1; length <= raw.length && !/[*?[\]{}()!+@]/.test(raw[length - 1] ?? ""); length++) {
		const spelled = raw.slice(0, length).join("/");
		const resolved = resolveSegments(raw.slice(0, length));
		if (resolved === undefined) continue;
		const whole = length === raw.length;
		spellings.push({
			spelling: whole ? spelled : `${spelled}/`,
			prefix: resolved.length === 0 ? "" : whole ? resolved.join("/") : `${resolved.join("/")}/`,
		});
	}
	// Every spelling of every reachable entry that matches and resolves physically: a walk answers each entry
	// once, in one of them (the spelling its root carries), so the oracle keeps them all.
	const answers = new Map<string, Set<string>>();
	for (const { path, kind } of enumerate(root, follow)) {
		if (kind === "file" ? match === "directory" : match === "file") continue;
		for (const { spelling, prefix } of spellings) {
			const exact = prefix !== "" && !prefix.endsWith("/");
			if (exact ? path !== prefix : !path.startsWith(prefix)) continue;
			const candidate = exact ? spelling : spelling + path.slice(prefix.length);
			if (pattern.matches(candidate) && resolvesPhysically(root, candidate, follow)) {
				const spelled = answers.get(path) ?? new Set<string>();
				spelled.add(candidate);
				answers.set(path, spelled);
			}
		}
	}
	return answers;
};

/** An answer's canonical path: its `.`, `..` and empty segments folded. */
const canonicalOf = (answer: string): string => resolveSegments(answer.split("/"))?.join("/") ?? answer;

const level0 = GlobPatternOptions.make({ optimizationLevel: 0 });
const compile = (source: string) => Result.getOrThrow(GlobPattern.compileResult(source, level0));

/** Each row: a source compiled at optimization level 0, the walk options, and the answer the oracle gives. */
const rows: ReadonlyArray<readonly [string, RowOptions, ReadonlyArray<string>]> = [
	// <file>/.. in a magic walk's root spelling: ENOTDIR on a real filesystem, so nothing.
	["f.js/../*.js", {}, []],
	["f.js/./*.js", {}, []],
	["x/b.js/../*.js", {}, []],
	// Controls: the same spelling through a real directory resolves, and is answered as spelled.
	["x/../*.js", {}, ["x/../a.js", "x/../f.js"]],
	["real/e/../*.js", {}, ["real/e/../d.js"]],
	// link/e/.. reaches through `link`: a walk that does not follow links never answers through it.
	["link/e/..", { match: "any" }, []],
	["link/e/../*", { match: "any" }, []],
	["link/./*.js", {}, []],
	// Controls: the real directory answers, and so does the link once followSymlinks lets the walk through.
	["real/e/..", { match: "any" }, ["real/e/.."]],
	["link/e/../*.js", { followSymlinks: true }, ["link/e/../d.js"]],
	// A `.` or empty segment after a followed link is the link's target itself: only `..` reads its target's parent.
	["link/./*.js", { followSymlinks: true }, ["link/./d.js"]],
	["link/.//*.js", { followSymlinks: true }, ["link/./d.js"]],
	["link/./d.js", { followSymlinks: true }, ["link/./d.js"]],
	["link/./d.js", {}, []],
	// `..` after a followed link resolves from its target, never lexically: refused, as the oracle refuses it.
	["link/../*.js", { followSymlinks: true }, []],
];

/** The whole table at once, so a failing run shows every row that differs. */
const expectedTable = rows.map(([source, , expected]) => [source, [...expected]]);

describe("dot segments in a pattern resolve as a real filesystem resolves them (#1290)", () => {
	it("the oracle itself: each row's answers are exactly the entries the brute-force filter keeps, spelled as it allows", () => {
		withTree((root) => {
			for (const [source, options, expected] of rows) {
				const oracle = bruteForce(root, compile(source), options);
				// Complete: the row answers exactly the entries the oracle reaches, each once.
				assert.deepStrictEqual(expected.map(canonicalOf).sort(), [...oracle.keys()].sort(), source);
				// Sound: each answer is a spelling of its entry that matches and resolves on the real tree.
				for (const answer of expected) {
					assert.isTrue(oracle.get(canonicalOf(answer))?.has(answer) ?? false, `${source}: ${answer}`);
				}
			}
		});
	});

	it("descendSync over real node:fs answers exactly the oracle", () => {
		withTree((root) => {
			const walked = rows.map(([source, options]) => [
				source,
				Result.getOrThrow(descendSync(compile(source), { cwd: root, ...options, ...nodeWalkerSyncOps })),
			]);
			assert.deepStrictEqual(walked, expectedTable);
		});
	});

	it("descendSync over a memfs volume holding the same tree answers the same", () => {
		const ops = memoryOps();
		const walked = rows.map(([source, options]) => [
			source,
			Result.getOrThrow(descendSync(compile(source), { cwd: "/repo", ...options, ...ops })),
		]);
		assert.deepStrictEqual(walked, expectedTable);
	});
});
