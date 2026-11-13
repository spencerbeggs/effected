import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import { OverrideKey } from "../src/index.js";

// The `overrides` selector grammar, restated from pnpm's
// `parse_pkg_and_parent_selector` (vendored: .repos/pnpm/pnpm/crates/
// config-parse-overrides/src/lib.rs), `parse_wanted_dependency`
// (.repos/pnpm/pnpm/crates/resolving-parse-wanted-dependency/src/lib.rs) and
// `is_valid_old_npm_package_name` (.repos/pnpm/pnpm/crates/package-name/src/lib.rs).
// The `parent@exact>peer` spelling below is the shape rolldown-pnpm-config's
// `allowed-versions` derivation emits (package/__test__/plugin/allowed-versions.test.ts);
// `allowedVersions` keys themselves are NOT `OverrideKey` selectors (pnpm splits
// them on a plain first `>`: .repos/pnpm/pnpm/crates/deps-inspection-peers/src/filter.rs).

const parsed = (key: string): OverrideKey => {
	const result = OverrideKey.parseResult(key);
	if (Result.isFailure(result)) return assert.fail(`expected ${key} to parse: ${result.failure.message}`);
	return result.success;
};

const shape = (key: OverrideKey) =>
	key.path.map((segment) => ({
		name: segment.name,
		range: Option.getOrUndefined(segment.range),
		...(segment.depType === undefined ? {} : { depType: segment.depType }),
	}));

describe("OverrideKey.parseResult", () => {
	it("a bare name is one segment with no range", () => {
		assert.deepStrictEqual(shape(parsed("foo")), [{ name: "foo", range: undefined }]);
	});

	it("name@range keeps the range text verbatim", () => {
		assert.deepStrictEqual(shape(parsed("foo@^1")), [{ name: "foo", range: "^1" }]);
		assert.deepStrictEqual(shape(parsed("foo@>=1.2.3 <2")), [{ name: "foo", range: ">=1.2.3 <2" }]);
	});

	it("a scoped name keeps its leading `@`; the version separator is the next `@`", () => {
		assert.deepStrictEqual(shape(parsed("@s/a")), [{ name: "@s/a", range: undefined }]);
		assert.deepStrictEqual(shape(parsed("@s/a@1>@s/b")), [
			{ name: "@s/a", range: "1" },
			{ name: "@s/b", range: undefined },
		]);
	});

	it("parent>child splits the parent from the target", () => {
		assert.deepStrictEqual(shape(parsed("a>b@2")), [
			{ name: "a", range: undefined },
			{ name: "b", range: "2" },
		]);
	});

	it("a parent@exact>name selector, the shape the allowedVersions derivation emits", () => {
		// rolldown-pnpm-config allowed-versions.test.ts: `@effect/platform-node@4.0.0-beta.99>effect`.
		const key = parsed("@effect/platform-node@4.0.0-beta.99>effect");
		assert.deepStrictEqual(shape(key), [
			{ name: "@effect/platform-node", range: "4.0.0-beta.99" },
			{ name: "effect", range: undefined },
		]);
	});

	it("a `>` after `@` is a range operator, not the parent delimiter", () => {
		// pnpm: the byte before the delimiter must not be ` `, `|` or `@`.
		assert.deepStrictEqual(shape(parsed("bar@>=1>foo@2")), [
			{ name: "bar", range: ">=1" },
			{ name: "foo", range: "2" },
		]);
		assert.deepStrictEqual(shape(parsed("foo@>=1 <2")), [{ name: "foo", range: ">=1 <2" }]);
		assert.deepStrictEqual(shape(parsed("foo@1 || >2")), [{ name: "foo", range: "1 || >2" }]);
	});

	it("trims surrounding whitespace, as pnpm does", () => {
		assert.deepStrictEqual(shape(parsed("  minimist  ")), [{ name: "minimist", range: undefined }]);
		assert.deepStrictEqual(shape(parsed("  bar@1>foo@2  ")), [
			{ name: "bar", range: "1" },
			{ name: "foo", range: "2" },
		]);
	});

	it("a glob name is accepted", () => {
		assert.deepStrictEqual(shape(parsed("@types/*")), [{ name: "@types/*", range: undefined }]);
	});

	it("the dependency-type pseudo-selectors qualify the target", () => {
		assert.deepStrictEqual(shape(parsed("foo:prod")), [{ name: "foo", range: undefined, depType: "prod" }]);
		assert.deepStrictEqual(shape(parsed("a>foo@1:peer")), [
			{ name: "a", range: undefined },
			{ name: "foo", range: "1", depType: "peer" },
		]);
		assert.deepStrictEqual(shape(parsed("foo:optional")), [{ name: "foo", range: undefined, depType: "optional" }]);
	});

	it('an empty range (`pkg@`) is a convergence selector with range Some("")', () => {
		assert.deepStrictEqual(shape(parsed("foo@")), [{ name: "foo", range: "" }]);
	});

	it("rejects an empty segment", () => {
		for (const key of ["a>", ">b", "", "   ", "a> "]) {
			const result = OverrideKey.parseResult(key);
			assert.isTrue(Result.isFailure(result), `expected ${JSON.stringify(key)} to fail`);
			if (Result.isFailure(result)) {
				assert.strictEqual(result.failure._tag, "OverrideKeyError");
				assert.strictEqual(result.failure.reason, "invalid-selector");
				assert.strictEqual(result.failure.key, key);
			}
		}
	});

	it("rejects what is not a package name", () => {
		for (const key of ["%", "foo > bar", "foo@1:2", "a>b>c", "_hidden", ".hidden", "node_modules", "@s", "foo bar"]) {
			const result = OverrideKey.parseResult(key);
			assert.isTrue(Result.isFailure(result), `expected ${JSON.stringify(key)} to fail`);
		}
	});

	it("rejects a dependency-type pseudo-selector on the parent", () => {
		assert.isTrue(Result.isFailure(OverrideKey.parseResult("a:peer>b")));
	});

	it("rejects an empty range beside a parent", () => {
		// `a@>b` is one segment (the `>` follows `@`), so only the target can carry the empty range.
		for (const key of ["a>b@"]) {
			const result = OverrideKey.parseResult(key);
			assert.isTrue(Result.isFailure(result), `expected ${key} to fail`);
			if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "empty-range-with-parent");
		}
	});

	it("rejects an empty-range convergence selector that is a glob or carries a dependency type", () => {
		assert.isTrue(Result.isFailure(OverrideKey.parseResult("@types/*@")));
		assert.isTrue(Result.isFailure(OverrideKey.parseResult("foo@:peer")));
	});

	it("its error message names the key and the reason", () => {
		const result = OverrideKey.parseResult("a>");
		if (Result.isSuccess(result)) return assert.fail("expected a failure");
		assert.include(result.failure.message, "a>");
	});
});

describe("OverrideKey.parseResult — package-name rules and hostile input", () => {
	it("rejects the names pnpm's old-name check rejects, one rule each", () => {
		for (const key of ["-foo", "NODE_MODULES", "Favicon.ico", "@s/.foo", "a>-foo", "a>@s/.foo"]) {
			const result = OverrideKey.parseResult(key);
			assert.isTrue(Result.isFailure(result), `expected ${key} to fail`);
		}
	});

	it("still accepts uppercase and url-friendly punctuation", () => {
		assert.strictEqual(parsed("Foo").format(), "Foo");
		assert.strictEqual(parsed("a.b-c_d!~*'()").format(), "a.b-c_d!~*'()");
		assert.strictEqual(parsed("@s/a.b").format(), "@s/a.b");
	});

	it("fails typed, never throws, on a lone surrogate in the target or the parent", () => {
		for (const key of ["\uD800", "a>\uDC00b", "\uD800>b", "@\uD800/x", "a@\uD800", "x:\uD800"]) {
			const outcome = Result.try(() => OverrideKey.parseResult(key));
			assert.isTrue(Result.isSuccess(outcome), `parseResult threw for ${JSON.stringify(key)}`);
			if (Result.isSuccess(outcome) && Result.isFailure(outcome.success)) {
				assert.strictEqual(outcome.success.failure._tag, "OverrideKeyError");
			}
		}
		const target = OverrideKey.parseResult("\uD800");
		assert.isTrue(Result.isFailure(target));
		const parent = OverrideKey.parseResult("a>\uDC00b");
		assert.isTrue(Result.isFailure(parent));
	});
});

describe("OverrideKey.parse (Effect)", () => {
	it.effect("succeeds with the key and fails typed with OverrideKeyError", () =>
		Effect.gen(function* () {
			const key = yield* OverrideKey.parse("a>b@2");
			assert.strictEqual(key.format(), "a>b@2");
			const error = yield* Effect.flip(OverrideKey.parse("a>"));
			assert.strictEqual(error._tag, "OverrideKeyError");
		}),
	);
});

describe("OverrideKey path shape", () => {
	const segment = { name: "a", range: Option.none() };
	it("make rejects zero or three segments, which parse can never produce", () => {
		assert.throws(() => OverrideKey.make({ path: [] }));
		assert.throws(() => OverrideKey.make({ path: [segment, segment, segment] }));
		assert.strictEqual(OverrideKey.make({ path: [segment, segment] }).format(), "a>a");
	});
});

describe("OverrideKey.format", () => {
	it("round-trips every accepted spelling", () => {
		for (const key of [
			"foo",
			"foo@^1",
			"@s/a",
			"@s/a@1>@s/b",
			"a>b@2",
			"bar@>=1>foo@2",
			"foo@>=1 <2",
			"foo:prod",
			"a>foo@1:peer",
			"foo@",
			"@effect/platform-node@4.0.0-beta.99>effect",
			"@types/*",
		]) {
			assert.strictEqual(parsed(key).format(), key);
		}
	});

	it("formats the trimmed canonical spelling", () => {
		assert.strictEqual(parsed("  bar@1>foo@2  ").format(), "bar@1>foo@2");
	});
});

describe("OverrideKey accessors", () => {
	it("target is the last segment and parent an Option of the first of two", () => {
		const bare = parsed("foo");
		assert.strictEqual(bare.target.name, "foo");
		assert.isTrue(Option.isNone(bare.parent));
		const nested = parsed("a@1>b");
		assert.strictEqual(nested.target.name, "b");
		const parent = nested.parent;
		assert.isTrue(Option.isSome(parent));
		if (Option.isSome(parent)) assert.strictEqual(parent.value.name, "a");
	});
});
