// The engine compliance gate's oracle properties: generated patterns,
// candidates and option bags sampling the full dialect, where every run must
// agree with the real upstream minimatch (the exact-pinned oracle
// devDependency). The deterministic fixture table is in `compliance.test.ts`.

import { assert, describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Effect, Schema } from "effect";
import { Minimatch as OracleMinimatch, minimatch as oracle } from "minimatch";
import type { EngineOptions } from "../src/internal/minimatch.js";
import { Minimatch, escape as escapePattern } from "../src/internal/minimatch.js";
import { oracleAnswer, oracleOpts } from "./support/oracle.js";

// ── Oracle property tests ─────────────────────────────────────────────────
// Array form ONLY: the named-record form of it.effect.prop silently discards
// Schema conversion in @effect/vitest 4.0.0-beta.94.
//
// Literal and magic segments are two equal-weight groups (a Union of two
// Literals unions, not one flat list), so the pattern mix stays balanced
// between plain paths and paths that exercise the dialect.

const literalSeg = Schema.Literals(["a", "b", "abc", "x-y", "a.b+c", ".hidden", "..", ""]);
const magicSeg = Schema.Literals([
	"*",
	"?",
	"**",
	"*.js",
	"a*",
	"?(a|b)",
	"+(a|b)",
	"!(a)",
	"@(a|b)",
	"*(a|b)",
	"[abc]",
	"[!a]",
	"[[:alpha:]]",
	"{a,b}",
	"{1..3}",
	"\\*",
	"!x",
	// minimatch 11's dot and negation rules: a class beside other magic, a
	// nullable extglob before a *, and a !(...) not at the pattern start
	"[.]",
	"[.]*",
	"*(a|b)*",
	"?(a|)*",
	"!(*)",
	"a!(b)*",
	".!(a)",
	"*\\.",
	// escaped regexp syntax, and a sequence through [ \ ] ^ _ `
	"\\|*",
	"a\\(",
	"{Z..a}",
	// a [ that never closes, before extglobs
	"[",
	"[+(a)",
	"a[*(b)",
	"[!(a)",
]);
const patternArb = Arbitrary.schema(
	Schema.Array(Schema.Union([literalSeg, magicSeg])).check(Schema.isBetweenLength(1, 5)),
).pipe(Arbitrary.map((xs) => xs.join("/")));
// The dot rules are reached only by the path portions they restrict: `.`, `..`
// and dotfiles, so they are a group of their own beside the plain ones.
const candidateArb = Arbitrary.schema(
	Schema.Array(
		Schema.Union([
			Schema.Literals(["a", "b", "abc", "x", "a.b+c", "", "A", "[a", "[", "a[b"]),
			Schema.Literals([".hidden", ".", "..", ".a", "a."]),
		]),
	).check(Schema.isBetweenLength(1, 6)),
).pipe(Arbitrary.map((xs) => xs.join("/")));
// Every key is optional so the bag ranges from `{}` to fully specified — the
// generator draws a random subset of the optional keys per run.
const optionBagArb = Arbitrary.schema(
	Schema.Struct({
		dot: Schema.optionalKey(Schema.Boolean),
		nocase: Schema.optionalKey(Schema.Boolean),
		matchBase: Schema.optionalKey(Schema.Boolean),
		noglobstar: Schema.optionalKey(Schema.Boolean),
		noext: Schema.optionalKey(Schema.Boolean),
		nobrace: Schema.optionalKey(Schema.Boolean),
		nonegate: Schema.optionalKey(Schema.Boolean),
		flipNegate: Schema.optionalKey(Schema.Boolean),
		preserveMultipleSlashes: Schema.optionalKey(Schema.Boolean),
		partial: Schema.optionalKey(Schema.Boolean),
		optimizationLevel: Schema.optionalKey(Schema.Literals([0, 1, 2])),
		platform: Schema.optionalKey(Schema.Literals(["posix", "win32"])),
	}),
);
// Printable ASCII only, as the property's name promises; the pattern also
// keeps `/` and `\` out constructively instead of by residual filtering. The
// class is spelled as the four spans printable ASCII splits into around those
// two characters so the exclusions read as such.
const printableNoSlashArb = Arbitrary.schema(Schema.String.check(Schema.isPattern(/^[ -.0-9:-@A-Z[\]-~]{1,30}$/)));
const braceSegArb = Arbitrary.schema(
	Schema.Array(Schema.Literals(["a", "{b,c}", "{1..4}", "x{y,z}w", "{a,{b,c}}", "plain", "[{a,b}", "{[,x}"])).check(
		Schema.isBetweenLength(1, 4),
	),
).pipe(Arbitrary.map((xs) => xs.join("/")));

// One path portion built from the atoms minimatch 11's matcher rules turn on:
// classes beside other magic, nullable extglobs, negations at any position,
// unclosed openers and escapes. nonegate keeps a leading ! an extglob. The
// candidates are the portions those rules decide: dotfiles, `.`, `..`, and
// strings a negation's tail can split.
const ruleAtom = Schema.Literals([
	"a",
	"b",
	".",
	"*",
	"?",
	"[.]",
	"[!a]",
	"!(a)",
	"!(*)",
	"!(b*)",
	"*(a|b)",
	"?(a|)",
	"@(a|.)",
	"*(",
	"?(",
	"@(a|",
	"\\.",
	"*\\.",
	"?\\.",
	"\\|",
	"\\(",
	"[,]",
	"[",
	"]",
	"[+(",
]);
const ruleShapeArb = Arbitrary.schema(Schema.Array(ruleAtom).check(Schema.isBetweenLength(1, 4))).pipe(
	Arbitrary.map((xs) => xs.join("")),
);
const ruleCandidateArb = Arbitrary.schema(
	Schema.Literals([
		".a",
		".ab",
		".",
		"..",
		"a",
		"ab",
		"abc",
		"ba",
		"a.",
		"*(",
		"a*(",
		"@(a|",
		"a(",
		"b",
		"[a",
		"[",
		"]a",
		"[x()",
	]),
);

describe("engine compliance: oracle properties", () => {
	it.effect.prop(
		"matches exactly as upstream under default options",
		[patternArb, candidateArb],
		([pattern, candidate]) =>
			Effect.sync(() => {
				const opts: EngineOptions = { platform: "posix" };
				assert.strictEqual(
					new Minimatch(pattern, opts).match(candidate),
					oracleAnswer(candidate, pattern, oracleOpts(opts)),
					`${pattern} vs ${candidate}`,
				);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 50, full: 500 }) } },
	);

	it.effect.prop(
		"matches exactly as upstream under arbitrary option bags",
		[patternArb, candidateArb, optionBagArb],
		([pattern, candidate, options]) =>
			Effect.sync(() => {
				const opts: EngineOptions = { platform: "posix", ...options };
				assert.strictEqual(
					new Minimatch(pattern, opts).match(candidate),
					oracleAnswer(candidate, pattern, oracleOpts(opts)),
					`${pattern} vs ${candidate} (${JSON.stringify(options)})`,
				);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 50, full: 500 }) } },
	);

	it.effect.prop(
		"matches exactly as upstream on minimatch 11's dot, negation and literal rules",
		[ruleShapeArb, ruleCandidateArb, Arbitrary.schema(Schema.Boolean)],
		([pattern, candidate, dot]) =>
			Effect.sync(() => {
				const opts: EngineOptions = { platform: "posix", dot, nonegate: true };
				assert.strictEqual(
					new Minimatch(pattern, opts).match(candidate),
					oracleAnswer(candidate, pattern, oracleOpts(opts)),
					`${pattern} vs ${candidate} (dot ${dot})`,
				);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 50, full: 500 }) } },
	);

	it.effect.prop(
		"a compiled escape of any printable string matches exactly that string",
		[printableNoSlashArb],
		([s]) =>
			Effect.sync(() => {
				// default options: escape() escapes a leading # or ! too (11.0.8), so
				// the result is never a comment or a negation. magicalBraces: brace
				// EXPANSION is magic regardless, but escape() only escapes braces
				// under this flag (oracle-confirmed upstream semantics).
				const opts: EngineOptions = { platform: "posix" };
				const m = new Minimatch(escapePattern(s, { magicalBraces: true }), opts);
				assert.isTrue(m.match(s), `escape(${JSON.stringify(s)}) must match its own literal`);
				assert.strictEqual(m.match(s), oracle(s, oracle.escape(s, { magicalBraces: true }), oracleOpts(opts)));
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 30, full: 300 }) } },
	);

	it.effect.prop(
		"braceExpand agrees with the upstream expansion for in-budget patterns",
		[braceSegArb],
		([pattern]) =>
			Effect.sync(() => {
				const vendored = new Minimatch(pattern, { platform: "posix" });
				const upstream = new OracleMinimatch(pattern, oracleOpts({ platform: "posix" }));
				assert.deepStrictEqual(vendored.braceExpand(), upstream.braceExpand(), pattern);
			}),
		{ arbitrary: { runs: Depth.pick({ sample: 30, full: 300 }) } },
	);
});
