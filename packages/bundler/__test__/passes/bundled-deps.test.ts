import { assert, describe, it } from "@effect/vitest";
import { GlobPattern } from "@effected/glob";
import { Result } from "effect";
import { bundlePatterns, bundledEverywhere, bundlesPackage, pruneBundled } from "../../src/passes/bundled-deps.js";

describe("bundlePatterns", () => {
	it("widens a bare package name to the package and every subpath", () => {
		assert.deepStrictEqual(bundlePatterns(["effect", "@effected/cli"]), [
			"effect",
			"effect/**",
			"@effected/cli",
			"@effected/cli/**",
		]);
	});

	it("widens a glob to every subpath under what it matches, and passes a subpath entry as written", () => {
		assert.deepStrictEqual(bundlePatterns(["@effected/*", "effect/Schema"]), [
			"@effected/*",
			"@effected/*/**",
			"effect/Schema",
		]);
	});

	it("inlines a subpath of a package a glob matches, as bundlesPackage prunes it", () => {
		// tsdown matches a specifier exactly or by picomatch, where `*` stops at `/`.
		const matches = (id: string) =>
			bundlePatterns(["@effected/*"]).some((pattern) => {
				const compiled = GlobPattern.compileResult(pattern);
				return Result.isSuccess(compiled) && compiled.success.matches(id);
			});
		assert.isTrue(bundlesPackage("@effected/cli", ["@effected/*"]));
		assert.isTrue(matches("@effected/cli"));
		assert.isTrue(matches("@effected/cli/main"));
		assert.isFalse(matches("@other/cli/main"));
	});

	it("leaves a glob already covering subpaths and a negation alone", () => {
		assert.deepStrictEqual(bundlePatterns(["@effected/**", "!@effected/cli"]), ["@effected/**", "!@effected/cli"]);
	});
});

describe("bundlesPackage", () => {
	it("matches a package named, or matched by a glob, and nothing else", () => {
		assert.isTrue(bundlesPackage("effect", ["effect"]));
		assert.isTrue(bundlesPackage("@effected/cli", ["@effected/*"]));
		assert.isFalse(bundlesPackage("effect-two", ["effect"]));
		assert.isFalse(bundlesPackage("@other/cli", ["@effected/*"]));
		// A subpath entry inlines one module, not the package, so the package stays a dependency.
		assert.isFalse(bundlesPackage("effect", ["effect/Schema"]));
	});
});

describe("bundledEverywhere", () => {
	it("holds a package every partition bundles", () => {
		const bundled = bundledEverywhere(["a", "b"], [{ bundle: ["a"] }]);
		assert.isTrue(bundled("a"));
		assert.isFalse(bundled("b"));
	});

	it("keeps a package an override does not force-bundle", () => {
		assert.isFalse(bundledEverywhere(["a"], [{}])("a"));
		assert.isFalse(bundledEverywhere(undefined, [])("a"));
	});
});

describe("pruneBundled", () => {
	it("drops inlined packages from dependencies and optionalDependencies, keeping peers", () => {
		const pruned = pruneBundled(
			{
				name: "x",
				dependencies: { a: "1", b: "1" },
				optionalDependencies: { a: "1" },
				peerDependencies: { a: "*" },
			},
			(name) => name === "a",
		);
		assert.deepStrictEqual(pruned, { name: "x", dependencies: { b: "1" }, peerDependencies: { a: "*" } });
	});

	it("removes a field it empties and leaves its input alone", () => {
		const input = { dependencies: { a: "1" } };
		assert.deepStrictEqual(
			pruneBundled(input, () => true),
			{},
		);
		assert.deepStrictEqual(input, { dependencies: { a: "1" } });
	});
});
