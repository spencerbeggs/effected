import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { PackageSpec } from "../src/index.js";

describe("PackageSpec", () => {
	it("fromString parses name@version", () => {
		const pkg = PackageSpec.fromString("zod@3.23.8");
		assert.strictEqual(pkg.name, "zod");
		assert.strictEqual(pkg.version, "3.23.8");
		assert.strictEqual(pkg.toString(), "zod@3.23.8");
	});

	it("fromString parses scoped specs with ranges", () => {
		const pkg = PackageSpec.fromString("@effect/schema@^0.68.0");
		assert.strictEqual(pkg.name, "@effect/schema");
		assert.strictEqual(pkg.version, "^0.68.0");
	});

	it("fromString defaults a missing version to latest", () => {
		const pkg = PackageSpec.fromString("zod");
		assert.strictEqual(pkg.version, "latest");
	});

	it("make rejects path-hostile names and versions", () => {
		assert.throws(() => PackageSpec.make({ name: "..", version: "1.0.0" }));
		assert.throws(() => PackageSpec.make({ name: "a/b", version: "1.0.0" }));
		assert.throws(() => PackageSpec.make({ name: "a\\b", version: "1.0.0" }));
		assert.throws(() => PackageSpec.make({ name: "@../escape", version: "1.0.0" }));
		assert.throws(() => PackageSpec.make({ name: "zod", version: ".." }));
		assert.throws(() => PackageSpec.make({ name: "zod", version: "1.0.0/x" }));
		assert.throws(() => PackageSpec.make({ name: "", version: "1.0.0" }));
	});

	it("normalizeSpecifier maps node built-ins, scopes and deep imports", () => {
		assert.strictEqual(PackageSpec.normalizeSpecifier("node:fs"), "node");
		assert.strictEqual(PackageSpec.normalizeSpecifier("fs/promises"), "node");
		assert.strictEqual(PackageSpec.normalizeSpecifier("@effect/platform/HttpClient"), "@effect/platform");
		assert.strictEqual(PackageSpec.normalizeSpecifier("lodash/fp"), "lodash");
		assert.strictEqual(PackageSpec.normalizeSpecifier("zod"), "zod");
	});

	it("cacheKey round-trips through parseCacheKey for scoped and unscoped names", () => {
		for (const spec of [
			PackageSpec.make({ name: "zod", version: "3.23.8" }),
			PackageSpec.make({ name: "@effect/schema", version: "0.68.0" }),
		]) {
			const parsed = PackageSpec.parseCacheKey(spec.cacheKey);
			assert.isTrue(Option.isSome(parsed));
			if (Option.isSome(parsed)) {
				assert.strictEqual(parsed.value.name, spec.name);
				assert.strictEqual(parsed.value.version, spec.version);
			}
		}
	});

	it("parseCacheKey returns none for foreign or hostile keys", () => {
		assert.isTrue(Option.isNone(PackageSpec.parseCacheKey("not-a-key")));
		assert.isTrue(Option.isNone(PackageSpec.parseCacheKey("a:b:c")));
		assert.isTrue(Option.isNone(PackageSpec.parseCacheKey("@scope:name:1.0.0:extra")));
		assert.isTrue(Option.isNone(PackageSpec.parseCacheKey("..:1.0.0")));
		assert.isTrue(Option.isNone(PackageSpec.parseCacheKey("")));
	});
});
