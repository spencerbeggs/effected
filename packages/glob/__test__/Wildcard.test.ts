// The Wildcard module: `*` and `?` only, no separator, brace, class or
// dotfile semantics, whitespace never matched by a wildcard.

import { assert, describe, it } from "@effect/vitest";
import { Wildcard, WildcardOptions } from "../src/index.js";

describe("Wildcard star", () => {
	it("matches any run of non-whitespace, across a slash", () => {
		const isAgent = Wildcard.compile("agent:*");
		assert.isTrue(isAgent("agent:okfit/claude-code"));
		assert.isTrue(isAgent("agent:"));
		assert.isFalse(isAgent("human:spencer"));
	});

	it("stops at whitespace", () => {
		// The discriminating case: a star that crossed whitespace would accept these.
		const isAgent = Wildcard.compile("agent:*");
		assert.isFalse(isAgent("agent: x"));
		assert.isFalse(isAgent("agent:a b"));
		assert.isFalse(isAgent("agent:a\tb"));
		assert.isFalse(isAgent("agent:a b"));
		assert.isFalse(isAgent("agent:a\nb"));
	});

	it("matches literal whitespace in the pattern", () => {
		assert.isTrue(Wildcard.matches("a * b", "a xyz b"));
		assert.isFalse(Wildcard.matches("a * b", "a x y b"));
	});

	it("matches zero characters and stars anywhere", () => {
		assert.isTrue(Wildcard.matches("*", ""));
		assert.isTrue(Wildcard.matches("a*b*c", "abc"));
		assert.isTrue(Wildcard.matches("a*b*c", "a-x-b-y-c"));
		assert.isFalse(Wildcard.matches("a*b*c", "a-x-c-y-b"));
		assert.isTrue(Wildcard.matches("*c", "abcabc"));
		assert.isFalse(Wildcard.matches("*c", "abcab"));
	});
});

describe("Wildcard question mark", () => {
	it("matches exactly one non-whitespace character", () => {
		const one = Wildcard.compile("a?c");
		assert.isTrue(one("abc"));
		assert.isTrue(one("a/c"));
		assert.isFalse(one("ac"));
		assert.isFalse(one("abbc"));
		assert.isFalse(one("a c"));
	});

	it("counts a code point, not a UTF-16 unit", () => {
		assert.isTrue(Wildcard.matches("?", "😀"));
		assert.isFalse(Wildcard.matches("??", "😀"));
	});
});

describe("Wildcard literals", () => {
	it("treats glob and regex syntax as literal", () => {
		assert.isTrue(Wildcard.matches("[a]", "[a]"));
		assert.isFalse(Wildcard.matches("[a]", "a"));
		assert.isTrue(Wildcard.matches("{a,b}", "{a,b}"));
		assert.isFalse(Wildcard.matches("{a,b}", "a"));
		assert.isTrue(Wildcard.matches("a.b", "a.b"));
		assert.isFalse(Wildcard.matches("a.b", "axb"));
		assert.isTrue(Wildcard.matches("^(x|y)+$\\", "^(x|y)+$\\"));
		assert.isFalse(Wildcard.matches("!a", "b"));
	});

	it("has no dotfile rule", () => {
		assert.isTrue(Wildcard.matches("*", ".hidden"));
		assert.isTrue(Wildcard.matches("?rc", ".rc"));
	});

	it("matches case-sensitively by default", () => {
		assert.isFalse(Wildcard.matches("Agent:*", "agent:x"));
	});
});

describe("Wildcard empty pattern", () => {
	it("matches only the empty string", () => {
		const empty = Wildcard.compile("");
		assert.isTrue(empty(""));
		assert.isFalse(empty("a"));
		assert.isFalse(empty(" "));
	});
});

describe("Wildcard nocase", () => {
	it("folds case on literals", () => {
		const loose = Wildcard.compile("HUMAN:?pencer", WildcardOptions.make({ nocase: true }));
		assert.isTrue(loose("human:spencer"));
		assert.isTrue(loose("Human:Spencer"));
		assert.isFalse(loose("human:s pencer"));
	});

	it("uses simple case folding", () => {
		const nocase = WildcardOptions.make({ nocase: true });
		assert.isTrue(Wildcard.matches("k", "K", nocase));
		assert.isTrue(Wildcard.matches("K", "K", nocase));
		assert.isTrue(Wildcard.matches("s", "ſ", nocase));
		assert.isFalse(Wildcard.matches("İ", "i", nocase));
		assert.isFalse(Wildcard.matches("k", "K"));
	});

	it("rejects an invalid option at make", () => {
		assert.throws(() => WildcardOptions.make({ nocase: "yes" as unknown as boolean }));
		assert.throws(() => WildcardOptions.make({ nocase: undefined as unknown as boolean }));
	});
});

describe("Wildcard hardening", () => {
	it("collapses 100,000 stars", () => {
		const stars = Wildcard.compile("*".repeat(100_000));
		assert.isTrue(stars("a".repeat(100_000)));
		assert.isTrue(stars(""));
		assert.isFalse(stars("a b"));
	});

	it("stays polynomial on many stars and literals against a long candidate", () => {
		// A backtracking /^\S*a\S*a…\S*b$/ does not return on this in any useful time.
		const pattern = `${"*a".repeat(200)}*b`;
		const candidate = "a".repeat(5_000);
		assert.isFalse(Wildcard.matches(pattern, candidate));
		assert.isTrue(Wildcard.matches(pattern, `${candidate}b`));
	});

	it("never throws on lone surrogates or control characters", () => {
		assert.isTrue(Wildcard.matches("\ud800*", "\ud800x"));
		assert.isTrue(Wildcard.matches("\ud800", "\ud800", WildcardOptions.make({ nocase: true })));
		assert.isTrue(Wildcard.matches("\u0000?", "\u0000x"));
	});
});
