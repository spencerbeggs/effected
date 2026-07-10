// Task 6: the GlobSet public module — multi-pattern include/exclude sets with
// glob-core's SET semantics (a leading bang is an exclusion filter applied
// after positive matching, distinct from minimatch's whole-pattern negation),
// the structural accessors serving the future workspaces enumerator, and the
// inherited glob-core behavioral table with issue #62 INVERTED: ** is real.

import { assert, describe, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { GlobPattern, GlobPatternError, GlobSet } from "../src/index.js";

describe("GlobSet: the workspaces contract (inherited glob-core table)", () => {
	it.effect("1. classifies literals and wildcards", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["packages/internal", "packages/*"]);
			assert.deepStrictEqual(set.literals, ["packages/internal"]);
			assert.lengthOf(set.wildcards, 1);
			assert.strictEqual(set.wildcards[0]?.source, "packages/*");
		}),
	);

	it.effect("2. exposes prefix extraction through the wildcard patterns", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["packages/*", "pkg-*"]);
			assert.strictEqual(set.wildcards[0]?.enumerationPrefix, "packages/");
			assert.strictEqual(set.wildcards[1]?.enumerationPrefix, "");
		}),
	);

	it.effect("3. question mark matches exactly one non-slash character", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["a?c"]);
			assert.isTrue(set.matches("abc"));
			assert.isFalse(set.matches("a/c"));
			assert.isFalse(set.matches("ac"));
		}),
	);

	it.effect("4. escapes regex metacharacters in literal-ish segments", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["libs/a.b+c/*"]);
			assert.isTrue(set.matches("libs/a.b+c/x"));
			assert.isFalse(set.matches("libs/aXbYc/x"));
		}),
	);

	it.effect("5. literal negation excludes an exact path", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["packages/*", "!packages/internal"]);
			assert.isTrue(set.matches("packages/a"));
			assert.isFalse(set.matches("packages/internal"));
		}),
	);

	it.effect("6. wildcard negation excludes by pattern", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["packages/*", "!packages/test-*"]);
			assert.isTrue(set.matches("packages/core"));
			assert.isFalse(set.matches("packages/test-utils"));
		}),
	);

	it.effect("7. preserves the source text of every pattern", () =>
		Effect.gen(function* () {
			const input = ["packages/*", "!packages/internal", "{tools/cli,libs/*}"];
			const set = yield* GlobSet.compile(input);
			assert.deepStrictEqual([...set.patterns], input);
		}),
	);

	it.effect("8. dedupes literals while preserving order", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["a", "b", "a"]);
			assert.deepStrictEqual(set.literals, ["a", "b"]);
		}),
	);

	it.effect("9. THE #62 INVERSION: a globstar include matches nested paths", () =>
		Effect.gen(function* () {
			// glob-core silently rewrote a trailing /** to /* and its test locked
			// packages/** to NOT match packages/a/b. That degradation is the bug
			// this package must not carry forward: ** is real here, by design.
			const set = yield* GlobSet.compile(["packages/**"]);
			assert.isTrue(set.matches("packages/a"));
			assert.isTrue(set.matches("packages/a/b"));
		}),
	);
});

describe("GlobSet: the matchesDependency contract", () => {
	it.effect("matches exact literals", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["vitest"]);
			assert.isTrue(set.matches("vitest"));
			assert.isFalse(set.matches("vite"));
		}),
	);

	it.effect("star does not cross slashes: *test* matches vitest", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["*test*"]);
			assert.isTrue(set.matches("vitest"));
			assert.isFalse(set.matches("vi/test"));
		}),
	);

	it.effect("@scope/* does not match slash-free names", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["@scope/*"]);
			assert.isFalse(set.matches("somepkg"));
			assert.isTrue(set.matches("@scope/x"));
		}),
	);
});

describe("GlobSet: classification per expanded alternative (pinned decision)", () => {
	it.effect("a braced pattern contributes a literal AND a wildcard", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["{tools/cli,packages/*}"]);
			assert.deepStrictEqual(set.literals, ["tools/cli"]);
			assert.lengthOf(set.wildcards, 1);
			assert.strictEqual(set.wildcards[0]?.source, "packages/*");
			assert.isTrue(set.matches("tools/cli"));
			assert.isTrue(set.matches("packages/x"));
			assert.isFalse(set.matches("tools/other"));
		}),
	);

	it.effect("brace-expanded literals participate in dedupe", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["{a,b}", "a"]);
			assert.deepStrictEqual(set.literals, ["a", "b"]);
		}),
	);
});

describe("GlobSet: set semantics truth table", () => {
	it.effect("matches requires some include and no exclude", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["a/*", "!a/x"]);
			assert.isTrue(set.matches("a/y")); // include, not excluded
			assert.isFalse(set.matches("a/x")); // include, excluded
			assert.isFalse(set.matches("b/y")); // no include
		}),
	);

	it.effect("an exclude-only set matches nothing", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["!a/*"]);
			assert.isFalse(set.matches("a/x"));
			assert.isFalse(set.matches("b/x"));
		}),
	);

	it.effect("an empty set matches nothing", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile([]);
			assert.isFalse(set.matches("anything"));
			assert.isFalse(set.matches(""));
		}),
	);

	it.effect("isExcluded reports the exclusion filter independently", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["a/*", "!a/x"]);
			assert.isTrue(set.isExcluded("a/x"));
			assert.isFalse(set.isExcluded("a/y"));
			// isExcluded consults only excludes — even a non-included candidate
			// can report excluded.
			const excludeOnly = yield* GlobSet.compile(["!b/*"]);
			assert.isTrue(excludeOnly.isExcluded("b/z"));
		}),
	);

	it.effect("excludes accessor exposes compiled GlobPatterns", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["a/*", "!a/x", "!a/y-*"]);
			assert.lengthOf(set.excludes, 2);
			assert.instanceOf(set.excludes[0], GlobPattern);
			assert.strictEqual(set.excludes[0]?.source, "a/x");
			assert.strictEqual(set.excludes[1]?.source, "a/y-*");
		}),
	);
});

describe("GlobSet: construction and failure", () => {
	it.effect("compile fails typed on the first uncompilable pattern, naming it", () =>
		Effect.gen(function* () {
			const bomb = "{a,b}".repeat(17);
			const e = yield* Effect.flip(GlobSet.compile(["fine/*", bomb, "also-fine"]));
			assert.instanceOf(e, GlobPatternError);
			assert.strictEqual(e.reason, "ExpansionBudgetExceeded");
			assert.strictEqual(e.pattern, bomb);
		}),
	);

	it.effect("compile validates exclusion patterns after stripping the bang", () =>
		Effect.gen(function* () {
			const e = yield* Effect.flip(GlobSet.compile([`!${"{a,b}".repeat(17)}`]));
			assert.strictEqual(e.reason, "ExpansionBudgetExceeded");
		}),
	);

	it("make throws when any member is uncompilable (wiring defect)", () => {
		assert.throws(() => GlobSet.make({ patterns: ["ok", "{a,b}".repeat(17)] }));
	});

	it("make succeeds and matches lazily", () => {
		const set = GlobSet.make({ patterns: ["packages/*", "!packages/internal"] });
		assert.isTrue(set.matches("packages/a"));
		assert.isFalse(set.matches("packages/internal"));
	});

	it.effect("encode round-trips the patterns array", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["a/*", "!a/x"]);
			const encoded = yield* Schema.encodeEffect(GlobSet)(set);
			assert.deepStrictEqual(encoded, { patterns: ["a/*", "!a/x"] });
		}),
	);

	it.effect("class decode produces a working instance", () =>
		Effect.gen(function* () {
			const set = yield* Schema.decodeUnknownEffect(GlobSet)({ patterns: ["x/*"] });
			assert.instanceOf(set, GlobSet);
			assert.isTrue(set.matches("x/y"));
		}),
	);
});

// The literal fast-path must key on what the engine actually matches — the
// unescaped effective path — never the raw member source. An exact-string key
// cannot represent comments or negation either; those route to the engine.
describe("GlobSet: literals key on the effective unescaped path", () => {
	it.effect("an escaped-magic literal include matches its unescaped candidate", () =>
		Effect.gen(function* () {
			const member = yield* GlobPattern.compile("foo\\*bar");
			assert.isTrue(member.matches("foo*bar"));

			const set = yield* GlobSet.compile(["foo\\*bar"]);
			assert.isTrue(set.matches("foo*bar"));
			assert.isFalse(set.matches("foo\\*bar"));
			assert.deepStrictEqual(set.literals, ["foo*bar"]);
		}),
	);

	it.effect("escaped and bare spellings of one effective literal dedupe", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["a\\{b", "a{b"]);
			assert.deepStrictEqual(set.literals, ["a{b"]);
			assert.isTrue(set.matches("a{b"));
		}),
	);

	it.effect("a comment member contributes nothing", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["#note", "real/path"]);
			assert.isFalse(set.matches("#note"));
			assert.deepStrictEqual(set.literals, ["real/path"]);
		}),
	);

	it.effect("a negated brace alternative is engine-matched, not string-keyed", () =>
		Effect.gen(function* () {
			const set = yield* GlobSet.compile(["{!x,y}"]);
			assert.isTrue(set.matches("z"));
			assert.isFalse(set.matches("x"));
		}),
	);

	it.effect("set matching agrees with member-wise pattern matching", () =>
		Effect.gen(function* () {
			const patterns = ["foo\\*bar", "a\\{b", "#c", "plain/lit", ""];
			const set = yield* GlobSet.compile(patterns);
			const members = yield* Effect.forEach(patterns, (p) => GlobPattern.compile(p));
			for (const candidate of ["foo*bar", "foo\\*bar", "a{b", "#c", "plain/lit", "", "other"]) {
				assert.strictEqual(
					set.matches(candidate),
					members.some((m) => m.matches(candidate)),
					`candidate ${JSON.stringify(candidate)}`,
				);
			}
		}),
	);
});
