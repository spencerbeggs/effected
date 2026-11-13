import { assert, describe, it } from "@effect/vitest";
import { Option, Result } from "effect";
import { OverrideKey } from "../src/index.js";

// The `overrides` / `peerDependencyRules.allowedVersions` selector grammar,
// restated from pnpm's `pnpm_config_parse_overrides::parse_pkg_and_parent_selector`
// (pnpm/pnpm v12.20.0, pnpm/crates/config-parse-overrides/src/lib.rs) and
// `parse_wanted_dependency` (crates/resolving-parse-wanted-dependency/src/lib.rs).
// The allowedVersions key shapes (`parent@exact>peer`, `parent>peer`, a bare
// `peer`) are the ones rolldown-pnpm-config's `allowed-versions` derivation
// emits (package/__test__/plugin/allowed-versions.test.ts).

const parsed = (key: string): OverrideKey => {
	const result = OverrideKey.parse(key);
	if (Result.isFailure(result)) return assert.fail(`expected ${key} to parse: ${result.failure.message}`);
	return result.success;
};

const shape = (key: OverrideKey) =>
	key.path.map((segment) => ({
		name: segment.name,
		range: Option.getOrUndefined(segment.range),
		...(segment.depType === undefined ? {} : { depType: segment.depType }),
	}));

describe("OverrideKey.parse", () => {
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

	it("the derived allowedVersions shape: exact parent version, then the peer", () => {
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
			const result = OverrideKey.parse(key);
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
			const result = OverrideKey.parse(key);
			assert.isTrue(Result.isFailure(result), `expected ${JSON.stringify(key)} to fail`);
		}
	});

	it("rejects a dependency-type pseudo-selector on the parent", () => {
		assert.isTrue(Result.isFailure(OverrideKey.parse("a:peer>b")));
	});

	it("rejects an empty range beside a parent", () => {
		// `a@>b` is one segment (the `>` follows `@`), so only the target can carry the empty range.
		for (const key of ["a>b@"]) {
			const result = OverrideKey.parse(key);
			assert.isTrue(Result.isFailure(result), `expected ${key} to fail`);
			if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "empty-range-with-parent");
		}
	});

	it("rejects an empty-range convergence selector that is a glob or carries a dependency type", () => {
		assert.isTrue(Result.isFailure(OverrideKey.parse("@types/*@")));
		assert.isTrue(Result.isFailure(OverrideKey.parse("foo@:peer")));
	});

	it("its error message names the key and the reason", () => {
		const result = OverrideKey.parse("a>");
		if (Result.isSuccess(result)) return assert.fail("expected a failure");
		assert.include(result.failure.message, "a>");
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
