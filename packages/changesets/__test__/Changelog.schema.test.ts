// The changelog contract's schemas over values @changesets/apply-release-plan
// really hands a changelog module, captured into fixtures/changelog-contract.json
// (its `provenance` says how): each decodes and round-trips unchanged, and a
// value of the wrong shape fails decoding with a typed SchemaError.

import { readFileSync } from "node:fs";
import { assert, describe, it } from "@effect/vitest";
import { Result, Schema } from "effect";
import {
	ComprehensiveRelease,
	ModCompWithPackage,
	NewChangesetWithCommit,
	PackageJSON,
	VersionType,
} from "../src/Changelog.js";

const captured = JSON.parse(readFileSync(new URL("./fixtures/changelog-contract.json", import.meta.url), "utf8")) as {
	readonly getReleaseLine: { readonly changeset: unknown; readonly type: unknown };
	readonly getDependencyReleaseLine: {
		readonly changesets: ReadonlyArray<unknown>;
		readonly dependenciesUpdated: ReadonlyArray<unknown>;
	};
};

/** Decode, encode back, and require the value unchanged. */
const roundTrip = <S extends Schema.Codec<unknown, unknown>>(schema: S, value: unknown): unknown => {
	const decoded = Schema.decodeUnknownResult(schema)(value);
	assert.isTrue(Result.isSuccess(decoded), Result.isFailure(decoded) ? String(decoded.failure) : "");
	if (Result.isFailure(decoded)) return undefined;
	const encoded = Schema.encodeUnknownResult(schema)(decoded.success);
	assert.isTrue(Result.isSuccess(encoded));
	if (Result.isSuccess(encoded)) assert.deepStrictEqual(encoded.success, value);
	return decoded.success;
};

const failsTyped = (schema: Schema.Codec<unknown, unknown>, value: unknown): void => {
	const decoded = Schema.decodeUnknownResult(schema)(value);
	assert.isTrue(Result.isFailure(decoded), "the value should not decode");
	if (Result.isFailure(decoded)) assert.strictEqual(decoded.failure._tag, "SchemaError");
};

describe("the changelog contract's schemas", () => {
	it("round-trips the changeset and bump getReleaseLine was handed", () => {
		const changeset = roundTrip(NewChangesetWithCommit, captured.getReleaseLine.changeset) as NewChangesetWithCommit;
		assert.match(changeset.commit ?? "", /^[0-9a-f]{40}$/);
		roundTrip(VersionType, captured.getReleaseLine.type);
	});

	it("round-trips the changesets and updated dependencies getDependencyReleaseLine was handed, relativeDir included", () => {
		for (const changeset of captured.getDependencyReleaseLine.changesets) roundTrip(NewChangesetWithCommit, changeset);
		assert.isAbove(captured.getDependencyReleaseLine.dependenciesUpdated.length, 0);
		for (const dependency of captured.getDependencyReleaseLine.dependenciesUpdated) {
			const decoded = roundTrip(ModCompWithPackage, dependency) as ModCompWithPackage;
			assert.strictEqual(decoded.relativeDir, "packages/a");
			const { packageJson: _packageJson, dir: _dir, relativeDir: _relativeDir, ...release } = decoded;
			roundTrip(ComprehensiveRelease, release);
		}
	});

	it("keeps a manifest's unknown keys and scoped registries: PackageJSON is open", () => {
		const manifest = {
			name: "@scope/a",
			version: "1.0.0",
			scripts: { build: "tsc" },
			exports: { ".": "./index.js" },
			publishConfig: { access: "public", "@scope:registry": "https://npm.example.com" },
		};
		const decoded = roundTrip(PackageJSON, manifest) as PackageJSON;
		assert.deepStrictEqual(decoded.scripts, { build: "tsc" });
		assert.strictEqual(decoded.publishConfig?.["@scope:registry"], "https://npm.example.com");
		const asRecord: Record<string, unknown> = decoded;
		assert.deepStrictEqual(asRecord.exports, { ".": "./index.js" });
		// The control: the same fields with no record rest strip what is not named.
		const closed = Schema.decodeUnknownSync(PackageJSON.schema)(manifest) as Record<string, unknown>;
		assert.isUndefined(closed.scripts);
		assert.isUndefined(closed.exports);
	});

	it("fails a value of the wrong shape with a typed SchemaError", () => {
		const changeset = captured.getReleaseLine.changeset as Record<string, unknown>;
		failsTyped(NewChangesetWithCommit, { ...changeset, releases: [{ name: "a", type: "huge" }] });
		failsTyped(NewChangesetWithCommit, { ...changeset, id: 7 });
		failsTyped(VersionType, "huge");
		const dependency = captured.getDependencyReleaseLine.dependenciesUpdated[0] as Record<string, unknown>;
		// Only a `none` entry may lack its versions.
		failsTyped(ModCompWithPackage, { ...dependency, newVersion: undefined });
		failsTyped(PackageJSON, { name: 1, version: "1.0.0" });
		failsTyped(PackageJSON, { name: "a", version: "1.0.0", dependencies: { b: 2 } });
		failsTyped(PackageJSON, { name: "a", version: "1.0.0", publishConfig: { access: "private" } });
	});

	it("decodes a none entry with no versions, as @changesets/types allows", () => {
		roundTrip(ComprehensiveRelease, {
			name: "a",
			type: "none",
			changesets: [],
			oldVersion: undefined,
			newVersion: undefined,
		});
	});
});
