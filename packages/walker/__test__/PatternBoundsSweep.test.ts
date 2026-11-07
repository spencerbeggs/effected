// A bounded property test over `skipsHiddenDirectories`: no pattern it prunes may match a path inside a hidden
// directory. walker reasons about glob's compiled rows from the outside, and glob rewrites a source on several
// independent paths (popping `<p>/..`, merging adjacent globstars, dropping a middle `.`), any of which can leave a
// one-segment row that `matchBase` matches by basename. Reading the engine found those paths one round at a time;
// this sweep compiles every short pattern over a fixed alphabet, under every option that changes the compiled rows,
// so a new collapse route fails here instead of in a consumer's walk.
//
// The space is exhaustive, not sampled: 1,110 sources of one to three segments, each with and without a trailing
// `/`, under four optimization levels and `matchBase` and `noglobstar` on and off (35,520 compilations).

import { assert, describe, it } from "@effect/vitest";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import { Result } from "effect";
import { skipsHiddenDirectories } from "../src/internal/patternBounds.js";

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
