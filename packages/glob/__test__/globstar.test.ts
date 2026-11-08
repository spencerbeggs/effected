// Patterns with more than one `**`, and `partial` under `**`.
//
// minimatch 10.2.3 through 10.2.6 answered these wrongly, and the engine took
// minimatch 11.0.4's fixes before the oracle moved to 11. The answers below are
// hard-coded, as regressions, and checked against the oracle (11.0.5) and the
// reference matcher at the end of this file.

import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import type { MinimatchOptions } from "minimatch";
import { minimatch as oracle } from "minimatch";
import type { EngineOptions } from "../src/internal/minimatch.js";
import { Minimatch } from "../src/internal/minimatch.js";

type Row = readonly [pattern: string, candidate: string, expected: boolean, options?: EngineOptions];

const engine = (pattern: string, candidate: string, options?: EngineOptions): boolean =>
	new Minimatch(pattern, { platform: "posix", ...options }).match(candidate);

const oracleSays = (pattern: string, candidate: string, options?: EngineOptions): boolean =>
	oracle(candidate, pattern, { ...options, platform: "linux" } as MinimatchOptions);

const rep = (s: string, n: number): string => Array.from({ length: n }, () => s).join("/");

// The rows minimatch 10.2.x got wrong.
const fixed: ReadonlyArray<Row> = [
	// a section's last start was computed from the wrong sections' lengths
	["**/a/b/c/**/d/**", "d/a/b/c/d/b", true],
	["**/c/e/b/f/**/f/b/b/**/c/c/c", "c/c/c/e/b/f/f/b/b/c/c/c", true],
	["e/a/**/d/b/**/b/**/f/a", "e/a/d/b/b/f/a", true],
	["*/a*/**/a*/?/c/d/**/a*/**/?/a*", "x/a/z/ax/a/c/d/c/a/a/a", true],
	["**/a/c/c/e/**/e/**", "a/x/x/a/c/c/e/e/f", true, { dot: true }],
	["**/!(c)/!(c)/+(a|b)/**/!(c)/**/*(b)", "xb/xb/ab/a/c/b", true],
	["**/*/B/**/B/**/c", "z/a/B/b/c", true, { nocase: true }],
	["a/**/*/a/**/*/**/*", "a/ab/a/z/b", true, { optimizationLevel: 0 }],
	// the last ** was walked over the tail too, so a dot in the tail failed it
	["**/a/**/.hidden", "a/.hidden", true],
	["**/a/c/**/a/c/.d", "a/a/c/a/c/.d", true],
	["**/a/c/**/a/c/.d", "c/a/c/c/a/c/.d/", true],
	["**/c/**/.", "c/.", true, { optimizationLevel: 2 }],
	// partial: a path under a dot portion that ** can not walk
	["a/**/b/**/c", "a/.x", false, { partial: true }],
	["**/.c/b/.c", "z/.c/a", false, { partial: true }],
	["*/**/c/.d/.d/**", "zz/c/.d/.d/./b/.", false, { partial: true }],
	["*/**/c/.d/.d/**", "zz/x/c/.d/.d/../a", false, { partial: true }],
	[".e/**/.e/.d/.d/**/.*/.d", ".e/x/.e/.e/.d/.d/y/../.e/.d/.d/.d", false, { partial: true, dot: true }],
	// partial: a path that ends in the pattern's last portion
	["c/**/a/.*/**/.*", "c/a/.q/a/c/x/.q", true, { partial: true }],
];

// The neighbours that must not move: 10.2.x was right about these too.
const held: ReadonlyArray<Row> = [
	["**/a/b/c/**/d/**", "d/a/b/c/d", false],
	["**/a/b/c/**/d/**", "a/b/d/c/d/b", false],
	["**/a/b/c/**/d/**", "a/b/c", false],
	["**/a/b/c/**/d/**", "d/a/.b/c/d/b", false],
	["**/a/b/c/**/d/**", ".x/a/b/c/d/e", false],
	["**/a/b/c/**/d/**", "a/b/c/.x/d/e", false],
	// a section can not borrow a portion from the tail, or from another section
	["**/a/**/a", "a", false],
	["**/a/b/**/b/c", "a/b/c", false],
	["a/**/b/**/b", "a/b", false],
	["**/a/c/**/a/c/.d", "a/c/.d", false],
	["**/a/**/.hidden", ".hidden", false],
	["**/a/**/.hidden", "x/.y/a/.hidden", false],
	["a/**/b/**/c", "a/x/b/y/c", true, { partial: true }],
	["a/**/b", "x", false, { partial: true }],
	["a/**/b/c", "a/x/y", true, { partial: true }],
	["a/**/b/c", "a/b/d/e", true, { partial: true }],
];

describe("more than one globstar", () => {
	for (const [pattern, candidate, expected, options] of fixed) {
		it(`${pattern} vs ${candidate} is ${expected}${options ? ` ${JSON.stringify(options)}` : ""}`, () => {
			assert.strictEqual(engine(pattern, candidate, options), expected);
		});
	}

	it("the oracle answers every fixed row the same way", () => {
		for (const [pattern, candidate, expected, options] of fixed) {
			assert.strictEqual(oracleSays(pattern, candidate, options), expected, `${pattern} vs ${candidate}`);
		}
	});

	for (const [pattern, candidate, expected, options] of held) {
		it(`stays ${expected}: ${pattern} vs ${candidate}${options ? ` ${JSON.stringify(options)}` : ""}`, () => {
			assert.strictEqual(engine(pattern, candidate, options), expected);
			assert.strictEqual(oracleSays(pattern, candidate, options), expected, "oracle");
		});
	}
});

describe("hostility: globstar sections that all fail", () => {
	// Every section can start at every `a` and every walk ends at the same dot
	// portion, so trying each combination is exponential in the number of `**`:
	// these took over nine seconds each, and two more `**` with a longer path
	// did not finish in fifteen. The pattern is a few dozen bytes, and match() is
	// sync, so a timeout could not stop it.
	const budgetMs = 1000;
	const path = `${rep("a", 30)}/.x/${rep("q", 14)}`;

	it("does not take exponential time under partial", () => {
		const m = new Minimatch(rep("**/a", 12), { partial: true });
		const start = performance.now();
		const hit = m.match(path);
		const elapsed = performance.now() - start;
		assert.isFalse(hit);
		assert.isBelow(elapsed, budgetMs);
	});

	it("does not take exponential time without partial", () => {
		const m = new Minimatch(`${rep("**/a", 12)}/**/z`);
		const start = performance.now();
		const hit = m.match(`${path}/z`);
		const elapsed = performance.now() - start;
		assert.isFalse(hit);
		assert.isBelow(elapsed, budgetMs);
	});
});

// A second reference for this class, beside the oracle. It states the
// semantics in one place: a ** walks zero or more portions that are not . or ..
// and, without dot, do not start with a dot; a final ** walks at least one; a
// trailing "" may be dropped when the row ends in a portion; and under partial,
// running out of path matches. Rows here hold only literals and **.
const reference = (row: ReadonlyArray<string>, candidate: string, dot: boolean, partial: boolean): boolean => {
	const walkable = (f: string) => f !== "." && f !== ".." && (dot || !f.startsWith("."));
	const run = (parts: ReadonlyArray<string>): boolean => {
		const memo = new Map<number, boolean>();
		const go = (i: number, j: number, walked: boolean): boolean => {
			const key = (i * (row.length + 1) + j) * 2 + (walked ? 1 : 0);
			const seen = memo.get(key);
			if (seen !== undefined) return seen;
			let out: boolean;
			if (partial && i >= parts.length) out = true;
			else if (j === row.length) out = i === parts.length || (partial && i === parts.length - 1 && parts[i] === "");
			else if (row[j] === "**") {
				const canStop = j < row.length - 1 || walked || partial;
				out =
					(canStop && go(i, j + 1, false)) || (i < parts.length && walkable(parts[i] as string) && go(i + 1, j, true));
			} else out = i < parts.length && row[j] === parts[i] && go(i + 1, j + 1, false);
			memo.set(key, out);
			return out;
		};
		return go(0, 0, false);
	};
	const parts = candidate.split("/");
	if (run(parts)) return true;
	return !partial && parts.at(-1) === "" && parts.length > 1 && row.at(-1) !== "**" && run(parts.slice(0, -1));
};

const portions = (min: number, max: number, of: ReadonlyArray<string>) =>
	Schema.Array(Schema.Literals(of as [string, ...Array<string>])).check(Schema.isBetweenLength(min, max));

const rowArb = Arbitrary.schema(
	Schema.Tuple([
		portions(0, 2, ["a", "b", ".c"]),
		portions(1, 4, ["a", "b", ".c"]),
		portions(0, 3, ["a", "b", ".c", "**"]),
		portions(0, 2, ["a", "b", ".c"]),
	]),
).pipe(Arbitrary.map(([head, mid, more, tail]) => [...head, "**", ...mid, "**", ...more, ...tail]));

const pathArb = Arbitrary.schema(
	Schema.Tuple([
		Schema.Array(Schema.Literals(["a", "b", ".c", "x", ".", ".."])).check(Schema.isBetweenLength(1, 12)),
		Schema.Boolean,
	]),
).pipe(Arbitrary.map(([parts, slash]) => `${parts.join("/")}${slash ? "/" : ""}`));

describe("more than one globstar: reference properties", () => {
	it.effect.prop(
		"agrees with the reference matcher",
		[rowArb, pathArb, Arbitrary.schema(Schema.Boolean), Arbitrary.schema(Schema.Boolean)],
		([row, candidate, dot, partial]) =>
			Effect.sync(() => {
				const answer = engine(row.join("/"), candidate, { dot, partial });
				const label = `${row.join("/")} vs ${candidate} dot=${dot} partial=${partial}`;
				assert.strictEqual(answer, reference(row, candidate, dot, partial), label);
				assert.strictEqual(answer, oracleSays(row.join("/"), candidate, { dot, partial }), `oracle: ${label}`);
			}),
		{ arbitrary: { runs: 2000 } },
	);
});
