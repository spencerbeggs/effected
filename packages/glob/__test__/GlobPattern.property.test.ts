// The GlobPattern public module against upstream minimatch, through compile
// and matches, on generated patterns and candidates.

import { assert, describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Effect, Schema } from "effect";
import { minimatch as oracle } from "minimatch";
import { GlobPattern } from "../src/index.js";

describe("GlobPattern oracle (public seam)", () => {
	// Literal and magic segments are two equal-weight groups (a Union of two
	// Literals unions, not one flat list), so the pattern mix stays balanced
	// between plain paths and paths that exercise the dialect.
	const literalSeg = Schema.Literals(["a", "b", "abc", "x-y", "a.b+c", ".hidden", ""]);
	const magicSeg = Schema.Literals(["*", "?", "**", "*.js", "a*", "+(a|b)", "[abc]", "{a,b}", "!x"]);
	const patternArb = Arbitrary.schema(
		Schema.Array(Schema.Union([literalSeg, magicSeg])).check(Schema.isBetweenLength(1, 4)),
	).pipe(Arbitrary.map((xs) => xs.join("/")));
	const candidateArb = Arbitrary.schema(
		Schema.Array(Schema.Literals(["a", "b", "abc", ".hidden", "x", ""])).check(Schema.isBetweenLength(1, 5)),
	).pipe(Arbitrary.map((xs) => xs.join("/")));

	it.effect.prop(
		"agrees with upstream through compile and matches",
		[patternArb, candidateArb],
		([pattern, candidate]) =>
			Effect.gen(function* () {
				const compiled = yield* Effect.result(GlobPattern.compile(pattern));
				if (compiled._tag === "Failure") return; // guard-tripping input; the engine gate covers those
				assert.strictEqual(
					compiled.success.matches(candidate),
					oracle(candidate, pattern, { platform: "linux" }),
					`${pattern} vs ${candidate}`,
				);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 20, full: 200 }) } },
	);
});
