import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import { PackageManifest, PackageSpec, TypeResolver } from "../src/index.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const loadManifest = (relativePath: string): PackageManifest =>
	Schema.decodeUnknownSync(PackageManifest)(
		JSON.parse(readFileSync(join(fixturesDir, relativePath), "utf8")) as unknown,
	);

const manifest = (fields: Record<string, unknown>): PackageManifest =>
	Schema.decodeUnknownSync(PackageManifest)(fields);

const zod = PackageSpec.make({ name: "zod", version: "3.22.4" });
const zodManifest = loadManifest("zod/package.json");
const tsPattern = PackageSpec.make({ name: "ts-pattern", version: "5.0.6" });
const tsPatternManifest = loadManifest("ts-pattern/package.json");
const effectSchema = PackageSpec.make({ name: "@effect/schema", version: "0.68.0" });
const effectSchemaManifest = loadManifest("@effect/schema/package.json");

describe("TypeResolver", () => {
	describe("resolveImport", () => {
		it("resolves the root specifier through the exports types condition", () => {
			for (const [spec, fixture, expected] of [
				[zod, zodManifest, "index.d.ts"],
				[tsPattern, tsPatternManifest, "dist/index.d.ts"],
				[effectSchema, effectSchemaManifest, "dist/index.d.ts"],
			] as const) {
				const result = TypeResolver.resolveImport(spec.name, fixture, spec);
				assert.isTrue(Option.isSome(result), `expected ${spec.name} to resolve`);
				if (Option.isSome(result)) {
					assert.strictEqual(result.value.filePath, expected);
					assert.isTrue(result.value.isTypeDefinition);
					assert.strictEqual(result.value.package.name, spec.name);
				}
			}
		});

		it("resolves subpaths through exports wildcards with substitution", () => {
			const wild = manifest({
				exports: { "./*": { types: "./dist/*.d.ts" } },
			});
			const result = TypeResolver.resolveImport(
				"pkg/util/deep",
				wild,
				PackageSpec.make({ name: "pkg", version: "1.0.0" }),
			);
			assert.isTrue(Option.isSome(result));
			if (Option.isSome(result)) {
				assert.strictEqual(result.value.filePath, "dist/util/deep.d.ts");
			}
		});

		it("resolves subpaths through typesVersions exact and wildcard entries", () => {
			const pkg = PackageSpec.make({ name: "pkg", version: "1.0.0" });
			const tv = manifest({
				typesVersions: { "*": { deep: ["types/deep.d.ts"], "lib/*": ["types/*"] } },
			});
			const exact = TypeResolver.resolveImport("pkg/deep", tv, pkg);
			assert.isTrue(Option.isSome(exact));
			if (Option.isSome(exact)) assert.strictEqual(exact.value.filePath, "types/deep.d.ts");
			const wildcard = TypeResolver.resolveImport("pkg/lib/thing.d.ts", tv, pkg);
			assert.isTrue(Option.isSome(wildcard));
			if (Option.isSome(wildcard)) assert.strictEqual(wildcard.value.filePath, "types/thing.d.ts");
		});

		it("falls back to top-level types only for the root specifier", () => {
			const pkg = PackageSpec.make({ name: "pkg", version: "1.0.0" });
			const legacy = manifest({ types: "./lib/main.d.ts" });
			const root = TypeResolver.resolveImport("pkg", legacy, pkg);
			assert.isTrue(Option.isSome(root));
			if (Option.isSome(root)) assert.strictEqual(root.value.filePath, "lib/main.d.ts");
			assert.isTrue(Option.isNone(TypeResolver.resolveImport("pkg/sub", legacy, pkg)));
		});

		it("returns none where v3 fabricated a guess", () => {
			const pkg = PackageSpec.make({ name: "pkg", version: "1.0.0" });
			assert.isTrue(Option.isNone(TypeResolver.resolveImport("pkg/unknown/deep", manifest({}), pkg)));
			assert.isTrue(Option.isNone(TypeResolver.resolveImport("pkg", manifest({}), pkg)));
		});
	});

	describe("hostile input", () => {
		const pkg = PackageSpec.make({ name: "evil", version: "1.0.0" });

		it("a __proto__ exports key pollutes nothing and resolves nothing", () => {
			const hostile = manifest({
				exports: JSON.parse('{"__proto__": {"types": "./pwned.d.ts"}}') as Record<string, unknown>,
			});
			const result = TypeResolver.resolveImport("evil/__proto__", hostile, pkg);
			assert.isTrue(Option.isNone(result));
			assert.strictEqual(({} as Record<string, unknown>).types, undefined);
			assert.strictEqual(({} as Record<string, unknown>).pwned, undefined);
		});

		it("wildcard substitution over a __proto__ carrier does not assign the prototype", () => {
			const hostile = manifest({
				exports: JSON.parse('{"./*": {"__proto__": {"polluted": "yes"}, "types": "./dist/*.d.ts"}}') as Record<
					string,
					unknown
				>,
			});
			const result = TypeResolver.resolveImport("evil/x", hostile, pkg);
			assert.isTrue(Option.isSome(result));
			if (Option.isSome(result)) assert.strictEqual(result.value.filePath, "dist/x.d.ts");
			assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
		});

		it("deeply nested exports conditions fail closed instead of overflowing the stack", () => {
			let nested: Record<string, unknown> = { types: "./deep.d.ts" };
			for (let index = 0; index < 5_000; index += 1) {
				nested = { import: nested };
			}
			const hostile = manifest({ exports: { ".": nested } });
			// Past the depth guard nothing resolves; the call must return, not throw.
			const result = TypeResolver.resolveImport("evil", hostile, pkg);
			assert.isTrue(Option.isNone(result));
		});

		it("a pattern with many wildcards simply does not match (ReDoS guard)", () => {
			const hostile = manifest({
				exports: { [`./${"*".repeat(30)}`]: { types: "./boom-*.d.ts" } },
			});
			const started = performance.now();
			const result = TypeResolver.resolveImport(`evil/${"a".repeat(64)}b`, hostile, pkg);
			const elapsed = performance.now() - started;
			assert.isTrue(Option.isNone(result));
			assert.isBelow(elapsed, 1_000);
		});

		it("typesVersions dunder keys are skipped", () => {
			const hostile = manifest({
				typesVersions: JSON.parse('{"*": {"__proto__": ["./pwned.d.ts"]}}') as Record<
					string,
					Record<string, ReadonlyArray<string>>
				>,
			});
			assert.isTrue(Option.isNone(TypeResolver.resolveImport("evil/__proto__", hostile, pkg)));
		});
	});

	describe("resolveMainEntry", () => {
		it("is total: types, then exports, then main swap, then the index.d.ts floor", () => {
			const pkg = PackageSpec.make({ name: "pkg", version: "1.0.0" });
			assert.strictEqual(TypeResolver.resolveMainEntry(zodManifest, zod).filePath, "index.d.ts");
			assert.strictEqual(
				TypeResolver.resolveMainEntry(manifest({ exports: { ".": { types: "./t.d.ts" } } }), pkg).filePath,
				"t.d.ts",
			);
			assert.strictEqual(TypeResolver.resolveMainEntry(manifest({ main: "./lib/x.js" }), pkg).filePath, "lib/x.d.ts");
			const floor = TypeResolver.resolveMainEntry(manifest({}), pkg);
			assert.strictEqual(floor.filePath, "index.d.ts");
			assert.isTrue(floor.isTypeDefinition);
		});
	});

	describe("resolveTypeEntries", () => {
		it("enumerates main and exports entries, deduplicated", () => {
			const entries = TypeResolver.resolveTypeEntries(zodManifest, zod);
			assert.deepStrictEqual(
				entries.map((entry) => entry.filePath),
				["index.d.ts", "package.json"],
			);
		});

		it("collects distinct subpath entries", () => {
			const pkg = PackageSpec.make({ name: "pkg", version: "1.0.0" });
			const multi = manifest({
				exports: {
					".": { types: "./index.d.ts" },
					"./testing": { types: "./testing.d.ts" },
				},
			});
			assert.deepStrictEqual(
				TypeResolver.resolveTypeEntries(multi, pkg).map((entry) => entry.filePath),
				["index.d.ts", "testing.d.ts"],
			);
		});
	});

	describe("findTypeDefinition", () => {
		it("swaps javascript extensions for declaration extensions", () => {
			const pkg = PackageSpec.make({ name: "pkg", version: "1.0.0" });
			assert.strictEqual(TypeResolver.findTypeDefinition("lib/index.js", pkg).filePath, "lib/index.d.ts");
			assert.strictEqual(TypeResolver.findTypeDefinition("lib/index.mjs", pkg).filePath, "lib/index.d.mts");
			assert.strictEqual(TypeResolver.findTypeDefinition("lib/index.cjs", pkg).filePath, "lib/index.d.cts");
			assert.strictEqual(TypeResolver.findTypeDefinition("lib/plain", pkg).filePath, "lib/plain.d.ts");
		});
	});
});
