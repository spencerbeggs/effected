import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { FastCheck } from "effect/testing";
import { DependencySpecifier, InvalidDependencySpecifierError } from "../src/DependencySpecifier.js";

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

describe("DependencySpecifier taxonomy (property)", () => {
	it.prop(
		"caret ranges over valid version triples always classify as range",
		[FastCheck.tuple(FastCheck.nat(50), FastCheck.nat(50), FastCheck.nat(50))],
		([[major, minor, patch]]) => {
			const specifier = `^${major}.${minor}.${patch}`;
			return DependencySpecifier.protocolOf(specifier) === "range" && DependencySpecifier.isRange(specifier);
		},
	);

	it.prop(
		"workspace: specifiers always classify as workspace and validate",
		[FastCheck.constantFrom("*", "~", "^", "1.0.0", "^2.0.0")],
		([modifier]) => {
			const specifier = `workspace:${modifier}`;
			return DependencySpecifier.protocolOf(specifier) === "workspace" && DependencySpecifier.isValid(specifier);
		},
	);
});
