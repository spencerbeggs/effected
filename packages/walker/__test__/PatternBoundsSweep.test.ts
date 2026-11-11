// A bounded property test over `skipsHiddenDirectories`: no pattern it prunes may match a path inside a hidden
// directory. walker reasons about glob's compiled rows from the outside, and glob rewrites a source on several
// independent paths (popping `<p>/..`, merging adjacent globstars, dropping a middle `.`), any of which can leave a
// one-segment row that `matchBase` matches by basename. Reading the engine found those paths one round at a time;
// this sweep compiles every short pattern over a fixed alphabet, under every option that changes the compiled rows,
// so a new collapse route fails here instead of in a consumer's walk.
//
// The space is exhaustive, not sampled: 1,110 sources of one to three segments, each with and without a trailing
// `/`, under four optimization levels and `matchBase` and `noglobstar` on and off (35,520 compilations).

import { posix } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import { MemoryFileSystem } from "@effected/memfs";
import { Result } from "effect";
import { descendSync } from "../src/DescendSync.js";
import { skipsHiddenDirectories } from "../src/internal/patternBounds.js";
import { resolveSegments } from "../src/internal/segments.js";

const ALPHABET = ["x", "*", "**", ".", "..", "*.js", "a*", "f.js", "*x", "src"] as const;

/** Paths that lie inside a hidden directory: a pruned walk never reads one, so no pruned pattern may match one. */
const HIDDEN = [
	".a/f.js",
	"x/.h/g.js",
	".a/b/c.js",
	"src/.x/f.js",
	".a/x",
	".a/f.js/x",
	"x/.h/x",
	"x/x/.h/f.js",
	".a/.b/f.js",
	"src/.x/src/f.js",
	".git/config",
	"a/.h/a",
	".a/",
	"x/.h/",
	"src/.x/x/",
] as const;

const sources = (): Array<string> => {
	const out: Array<string> = [];
	for (const a of ALPHABET) {
		out.push(a);
		for (const b of ALPHABET) {
			out.push(`${a}/${b}`);
			for (const c of ALPHABET) out.push(`${a}/${b}/${c}`);
		}
	}
	return out;
};

const LEVELS: ReadonlyArray<0 | 1 | 2 | undefined> = [undefined, 0, 1, 2];

const COMPILED = 94_528;
const LITERALS = 9408;
const DOT_ONLY = 414;

describe("skipsHiddenDirectories over every short pattern", () => {
	it("prunes no pattern that matches a path inside a hidden directory", () => {
		const escapes: Array<string> = [];
		let compiled = 0;
		let pruned = 0;
		for (const base of sources()) {
			for (const source of [base, `${base}/`]) {
				for (const level of LEVELS) {
					for (const matchBase of [false, true]) {
						for (const noglobstar of [false, true]) {
							const options = GlobPatternOptions.make({
								matchBase,
								noglobstar,
								...(level !== undefined && { optimizationLevel: level }),
							});
							const result = GlobPattern.compileResult(source, options);
							if (Result.isFailure(result)) continue;
							compiled += 1;
							const pattern = result.success;
							if (!skipsHiddenDirectories(pattern)) continue;
							pruned += 1;
							for (const path of HIDDEN) {
								if (pattern.matches(path)) {
									escapes.push(
										`${source} level=${level ?? "default"} matchBase=${matchBase} noglobstar=${noglobstar} matches ${path}`,
									);
								}
							}
						}
					}
				}
			}
		}
		// The sweep is not vacuous: it compiles the whole space, and the bound prunes a real share of it.
		assert.strictEqual(compiled, 35_520);
		assert.isAbove(pruned, 1000);
		const escaping = [...new Set(escapes.map((line) => line.split(" matches ")[0]))];
		assert.deepStrictEqual(escaping, [], `${escapes.length} pruned matches of a hidden path`);
	});
});

// The same space, walked, over a wider alphabet: every bound the walk applies (the literal fast path, the roots glob
// reports, the depth bound, the hidden-directory bound) only ever skips reads, so `descendSync` over a fixed tree must
// answer exactly the files a brute-force filter keeps. The filter is independent of glob's enumerator getters: it
// tests every file of the tree through `GlobPattern.matches`, bare, `./`-led, and re-spelled through the source's
// own leading literal segments (matching is spelling-sensitive: `./*.js` does not match `a.js`, and `x/../*.js` at
// level 0 matches `x/../a.js`). `matchBase` is where the bounds once went wrong: `*.js` and `x/../*.js` match
// `b/d/f/g.js` by basename, four levels down. A second leg walks every bounded pattern (no globstar, not negated,
// none of its alternatives matched by basename) under the tightest `maxDepth` its separators allow and requires the
// same complete answer, so a bound dropped for a pattern that keeps one (`src/[ab]/*.ts` under `matchBase`) fails
// as `depthExceeded` here.

const WIDE = [...ALPHABET, "{x,src}", "[ab]*", "@(f.js|x)", "\\x"] as const;

/** Files at every depth up to five, beside and inside hidden directories, named from the alphabet. */
const FILES = [
	"a.js",
	"f.js",
	"ax",
	"xx",
	"b/c.js",
	"b/d/e.js",
	"b/d/f/g.js",
	"src/f.js",
	"src/src/f.js",
	"src/x/f.js",
	"src/a/x",
	"x/x/x/f.js",
	"x/x/x/x/x",
	"x/src/f.js",
	"b/xx/x/x/f.js",
	"xx2/ax",
	".a/f.js",
	".a/x",
	"x/.h/g.js",
	"x/.h/x",
	"src/.x/f.js",
	".h/x/f.js",
	".a/.b/f.js",
	".env",
] as const;

const volume = MemoryFileSystem.makeSync(Object.fromEntries(FILES.map((file) => [`/repo/${file}`, ""])));
const ops = { fileSystem: volume.sync, path: posix };

/** Characters that make a source segment magic rather than a literal directory name. */
const MAGIC = /[*?[\]{}()!+@]/;

/** The source's brace alternatives: the alphabet's one brace set, `{x,src}`, expanded wherever it occurs. */
const alternatives = (source: string): Array<string> =>
	source.includes("{x,src}")
		? [...alternatives(source.replace("{x,src}", "x")), ...alternatives(source.replace("{x,src}", "src"))]
		: [source];

/**
 * The files the pattern matches as spelled through the leading literal segments of some brace alternative of the
 * source (escapes undone, as glob reads them), canonical, sorted. With `dotLed`, a bare `./` spelling is tried too:
 * glob itself can lead a row with `.` (level 2 rewrites `x/../**` to `./**`), but it also matches `./a.js` against
 * the source globstar, `.`, star (a comment cannot spell it), a spelling no walk forms, so the walk is held
 * between the two answers.
 */
/** Every directory of the tree, slash-free at both ends. */
const DIRECTORIES = new Set(
	FILES.flatMap((file) =>
		file
			.split("/")
			.slice(0, -1)
			.map((_, i, all) => all.slice(0, i + 1).join("/")),
	),
);

/**
 * Whether a spelling's `.`, `..` and empty segments resolve the way a real stat resolves them: each follows a
 * directory of the tree (`f.js/../` fails ENOTDIR, `q/../` ENOENT), where joining would collapse them lexically.
 */
const resolvesPhysically = (spelling: string): boolean => {
	const raw = spelling.split("/");
	for (let index = 1; index < raw.length; index++) {
		const segment = raw[index];
		if (segment !== "" && segment !== "." && segment !== "..") continue;
		const before = resolveSegments(raw.slice(0, index));
		if (before === undefined) return false;
		if (before.length > 0 && !DIRECTORIES.has(before.join("/"))) return false;
	}
	return true;
};

const bruteForce = (pattern: GlobPattern, source: string, dotLed: boolean): Array<string> => {
	const spellings: Array<{ readonly spelling: string; readonly prefix: string }> = [{ spelling: "", prefix: "" }];
	if (dotLed) spellings.push({ spelling: "./", prefix: "" });
	for (const alternative of alternatives(source)) {
		const literal: Array<string> = [];
		for (const segment of alternative.split("/").slice(0, -1)) {
			if (MAGIC.test(segment)) break;
			literal.push(segment.replace(/\\(.)/g, "$1"));
		}
		// Every leading run of literal segments, as spelled and as it resolves: `./x/../` reaches `""` as `./x/../`.
		for (let length = 1; length <= literal.length; length++) {
			const resolved = resolveSegments(literal.slice(0, length));
			if (resolved === undefined) continue;
			spellings.push({
				spelling: `${literal.slice(0, length).join("/")}/`,
				prefix: resolved.length === 0 ? "" : `${resolved.join("/")}/`,
			});
		}
	}
	return FILES.filter((file) =>
		spellings.some(
			({ spelling, prefix }) =>
				file.startsWith(prefix) &&
				pattern.matches(spelling + file.slice(prefix.length)) &&
				// A real filesystem resolves a spelling physically, whether the walk stats it (a literal, #1283) or
				// walks a root spelled through it (`f.js/../*.js` at level 0 reaches nothing, #1290).
				resolvesPhysically(spelling + file.slice(prefix.length)),
		),
	).sort();
};

/** The separators in the source past a leading `./` and before a trailing `/` (a backslash is one under win32 escapes). */
const separators = (source: string): number => {
	let text = source;
	while (text.startsWith("./")) text = text.slice(2);
	if (text.endsWith("/")) text = text.slice(0, -1);
	return [...text].filter((character) => character === "/" || character === "\\").length;
};

const canonical = (paths: ReadonlyArray<string>): string =>
	JSON.stringify(paths.map((path) => resolveSegments(path.split("/"))?.join("/") ?? path).sort());

describe("descend over every short pattern", () => {
	it("answers exactly the files a brute-force matches filter keeps, and keeps every bound under a tight maxDepth", () => {
		const differences: Array<string> = [];
		let compiled = 0;
		let deepBasename = 0;
		let bounded = 0;
		let literals = 0;
		let dotOnly = 0;
		const wide: Array<string> = [];
		for (const a of WIDE) {
			wide.push(a);
			for (const b of WIDE) {
				wide.push(`${a}/${b}`);
				for (const c of WIDE) wide.push(`${a}/${b}/${c}`);
			}
		}
		for (const base of wide) {
			for (const source of [base, `${base}/`]) {
				for (const level of LEVELS) {
					for (const matchBase of [false, true]) {
						for (const dot of [false, true]) {
							const options = GlobPatternOptions.make({
								matchBase,
								dot,
								...(level !== undefined && { optimizationLevel: level }),
							});
							const result = GlobPattern.compileResult(source, options);
							if (Result.isFailure(result)) continue;
							compiled += 1;
							const pattern = result.success;
							const label = `${source} ${JSON.stringify(options)}`;
							const walked = descendSync(pattern, { cwd: "/repo", ...ops });
							if (Result.isFailure(walked)) {
								differences.push(`${label} failed ${walked.failure.reason}`);
								continue;
							}
							// The bounded leg: the tightest maxDepth the separators allow must succeed with the whole answer.
							if (!pattern.negated && !pattern.matchesByBasename && !source.includes("**")) {
								bounded += 1;
								const maxDepth = Math.max(1, separators(source));
								const tight = descendSync(pattern, { cwd: "/repo", maxDepth, ...ops });
								if (Result.isFailure(tight))
									differences.push(`${label} maxDepth=${maxDepth} failed ${tight.failure.reason}`);
								else if (JSON.stringify(tight.success) !== JSON.stringify(walked.success))
									differences.push(`${label} maxDepth=${maxDepth} answered ${JSON.stringify(tight.success)}`);
							}
							// A literal that runs past a file through `.`, `..` or an empty segment (`f.js/x/..` at level 0), or an escaped
							// literal (`src/\\x/f.js`): the fast path stats it as glob reads it, resolving those segments physically, and the
							// filter below resolves its spellings the same way, so the class is compared like every other (#1283).
							if (
								!pattern.hasMagic &&
								!pattern.matchesByBasename &&
								/\/\.\.?(\/|$)|\\/.test(source.replace(/^(\.\/)+/, ""))
							)
								literals += 1;
							// Complete against the strict filter, sound against the `./`-led one, and every answer matches as spelled.
							const strict = bruteForce(pattern, source, false);
							const loose = bruteForce(pattern, source, true);
							const answered: ReadonlyArray<string> = JSON.parse(canonical(walked.success));
							if (matchBase && strict.some((file) => file.split("/").length > 2)) deepBasename += 1;
							const missed = strict.filter((file) => !answered.includes(file));
							const extra = answered.filter((file) => !loose.includes(file));
							const unsound = walked.success.filter((path) => !pattern.matches(path));
							if (missed.length + extra.length + unsound.length > 0)
								differences.push(`${label} missed ${missed} extra ${extra} unsound ${unsound}`);
							dotOnly += loose.filter((file) => !answered.includes(file)).length;
						}
					}
				}
			}
		}
		const differing = [...new Set(differences.map((line) => line.split(" ")[0]))];
		assert.deepStrictEqual(differing, [], `${differences.length} walks differ: ${differences.slice(0, 5).join("; ")}`);
		// Not vacuous: the whole space compiles, matchBase reaches files more than two levels down, and the bounded
		// leg walks a real share of it.
		assert.strictEqual(compiled, COMPILED);
		assert.isAbove(deepBasename, 1000);
		assert.isAbove(bounded, 10_000);
		assert.strictEqual(literals, LITERALS);
		// Files only a `./` spelling no walk forms reaches (`**/./*` against `./a.js`): pinned, not a bound.
		assert.strictEqual(dotOnly, DOT_ONLY);
		// About a minute under coverage. Exhaustive on purpose; never sample it down.
	}, 300_000);
});
