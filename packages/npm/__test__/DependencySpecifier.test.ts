import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { FastCheck } from "effect/testing";
import {
	CatalogSpecifier,
	DependencySpecifier,
	DistTagSpecifier,
	InvalidDependencySpecifierError,
	RangeSpecifier,
	RawSpecifier,
	WorkspaceSpecifier,
} from "../src/index.js";

describe("DependencySpecifier schema", () => {
	const valid = [
		"^1.0.0",
		"~2.3.4",
		">=1.0.0 <2.0.0",
		"1.2.3",
		"*",
		"1.x",
		"latest",
		"next",
		"https://example.com/pkg.tgz",
		"git+https://github.com/user/repo.git",
		"git+ssh://git@github.com/user/repo.git",
		"github:u/r",
		"gist:abc",
		"bitbucket:u/r",
		"gitlab:u/r",
		"user/repo",
		"user/repo#branch",
		"file:../local-pkg",
		"npm:lodash@^4.0.0",
		"catalog:silk",
		"workspace:*",
	];

	it.effect("accepts every recognized specifier", () =>
		Effect.gen(function* () {
			for (const specifier of valid) {
				assert.strictEqual(yield* Schema.decodeUnknownEffect(DependencySpecifier)(specifier), specifier);
			}
		}),
	);

	it.effect("rejects garbage, unknown protocols and empty string", () =>
		Effect.gen(function* () {
			for (const specifier of ["!!garbage", "patch:lodash", ""]) {
				const error = yield* Effect.flip(Schema.decodeUnknownEffect(DependencySpecifier)(specifier));
				assert.strictEqual(error._tag, "SchemaError", specifier);
			}
		}),
	);
});

describe("DependencySpecifier.protocolOf", () => {
	const cases: ReadonlyArray<[string, string]> = [
		["^1.0.0", "range"],
		["1.x", "range"],
		["*", "range"],
		[">=1.0.0 <2.0.0", "range"],
		["latest", "tag"],
		["git+https://github.com/u/r.git", "git"],
		["github:u/r", "git"],
		["user/repo", "git"],
		["file:../x", "file"],
		["./local", "file"],
		["/absolute/path", "file"],
		["link:../x", "link"],
		["portal:../x", "portal"],
		["catalog:silk", "catalog"],
		["workspace:*", "workspace"],
		["https://x.com/a.tgz", "url"],
		["npm:lodash@^4", "npm"],
		["!!garbage", "unknown"],
	];

	it("classifies each specifier", () => {
		for (const [specifier, protocol] of cases) {
			assert.strictEqual(DependencySpecifier.protocolOf(specifier), protocol, specifier);
		}
	});

	it("isValid agrees with protocolOf, including bare paths", () => {
		assert.isTrue(DependencySpecifier.isValid("/absolute/path"));
		assert.strictEqual(DependencySpecifier.protocolOf("/absolute/path"), "file");
		assert.isTrue(DependencySpecifier.isValid("./local"));
		assert.strictEqual(DependencySpecifier.protocolOf("./local"), "file");
		assert.isFalse(DependencySpecifier.isValid("!!garbage"));
	});

	it("isRange decodes ranges purely (no tag, no protocol)", () => {
		assert.isTrue(DependencySpecifier.isRange("^1.0.0"));
		assert.isTrue(DependencySpecifier.isRange(">=1.0.0 <2.0.0"));
		assert.isFalse(DependencySpecifier.isRange("latest"));
		assert.isFalse(DependencySpecifier.isRange("workspace:*"));
		assert.isTrue(Option.isSome(DependencySpecifier.parseRange("^1.0.0")));
		assert.isTrue(Option.isNone(DependencySpecifier.parseRange("latest")));
	});
});

describe("DependencySpecifier.decode", () => {
	it.effect("returns the branded value for a valid specifier", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* DependencySpecifier.decode("^1.0.0"), "^1.0.0");
		}),
	);

	it.effect("fails with InvalidDependencySpecifierError for an empty string", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(DependencySpecifier.decode(""));
			assert.instanceOf(error, InvalidDependencySpecifierError);
			assert.strictEqual(error._tag, "InvalidDependencySpecifierError");
			assert.strictEqual(error.input, "");
		}),
	);
});

describe("DependencySpecifier.FromString", () => {
	it.effect("classifies each case and preserves the raw string", () =>
		Effect.gen(function* () {
			const decode = Schema.decodeUnknownEffect(DependencySpecifier.FromString);

			const defaultCatalog = yield* decode("catalog:");
			assert.instanceOf(defaultCatalog, CatalogSpecifier);
			assert.strictEqual(defaultCatalog._tag, "catalog");
			assert.isTrue(Option.isNone((defaultCatalog as CatalogSpecifier).name));
			assert.strictEqual(defaultCatalog.raw, "catalog:");

			const namedCatalog = yield* decode("catalog:react18");
			assert.deepStrictEqual((namedCatalog as CatalogSpecifier).name, Option.some("react18"));

			const ws = yield* decode("workspace:^1.2.3");
			assert.instanceOf(ws, WorkspaceSpecifier);
			assert.strictEqual((ws as WorkspaceSpecifier).range, "^1.2.3");

			const range = yield* decode("^1.0.0");
			assert.instanceOf(range, RangeSpecifier);

			const bareVersion = yield* decode("1.2.3");
			assert.instanceOf(bareVersion, RangeSpecifier);

			const tag = yield* decode("latest");
			assert.instanceOf(tag, DistTagSpecifier);

			for (const rawForm of ["file:../x", "link:../x", "git+https://github.com/u/r.git", "https://x.com/a.tgz"]) {
				const raw = yield* decode(rawForm);
				assert.instanceOf(raw, RawSpecifier, rawForm);
				assert.strictEqual(raw.raw, rawForm);
			}
		}),
	);

	it.effect("fails decoding an invalid specifier", () =>
		Effect.gen(function* () {
			for (const bad of ["", "!!garbage", "patch:lodash"]) {
				const error = yield* Effect.flip(Schema.decodeUnknownEffect(DependencySpecifier.FromString)(bad));
				assert.strictEqual(error._tag, "SchemaError", bad);
			}
		}),
	);

	it.effect.prop(
		"encode(decode(s)) === s for every recognized specifier (byte-for-byte round-trip)",
		[
			FastCheck.constantFrom(
				"catalog:",
				"catalog:react18",
				"workspace:*",
				"workspace:^1.2.3",
				"workspace:foo@*",
				"^1.0.0",
				"1.2.3",
				">=1.0.0 <2.0.0",
				"1.x",
				"latest",
				"next",
				"file:../local-pkg",
				"link:../x",
				"portal:../x",
				"npm:lodash@^4.0.0",
				"git+https://github.com/user/repo.git",
				"github:u/r",
				"https://example.com/pkg.tgz",
			),
		],
		([specifier]) =>
			Effect.gen(function* () {
				const decoded = yield* Schema.decodeUnknownEffect(DependencySpecifier.FromString)(specifier);
				const encoded = yield* Schema.encodeUnknownEffect(DependencySpecifier.FromString)(decoded);
				assert.strictEqual(encoded, specifier);
			}),
	);
});
