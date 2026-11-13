// The shapes pnpm 12 corrected relative to the older descriptors, each held to
// what pnpm 12.20.0's config crate deserializes. Every check decodes a value
// pnpm accepts AND one it refuses, so a schema that accepted everything fails.

import { assert, describe, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import { PeerDependencyRules, VersioningConfig } from "../../src/index.js";
import { PnpmSettingsCatalog } from "../../src/settings.js";
import inventory from "../fixtures/pnpm-12.20.0-settings.json" with { type: "json" };

const accepts = (schema: Schema.Codec<unknown, unknown>, value: unknown): boolean =>
	Schema.decodeUnknownResult(schema)(value)._tag === "Success";

describe("the pnpm 12 shapes", () => {
	it("nodeLinker accepts loaded and the loaded-linker object", () => {
		const { schema } = PnpmSettingsCatalog.nodeLinker;
		for (const value of [
			"isolated",
			"hoisted",
			"pnp",
			"loaded",
			{ type: "loaded" },
			{ type: "loaded", excluded: ["vitest"] },
		])
			assert.isTrue(accepts(schema, value), JSON.stringify(value));
		for (const value of ["flat", { type: "hoisted" }, { type: "loaded", extra: true }])
			assert.isFalse(accepts(schema, value), JSON.stringify(value));
	});

	it("lockfile accepts a boolean and its object form", () => {
		const { schema } = PnpmSettingsCatalog.lockfile;
		for (const value of [true, false, {}, { format: "v13", includeResolutionSettings: true, integrityTarget: "tar" }])
			assert.isTrue(accepts(schema, value), JSON.stringify(value));
		for (const value of ["yes-please", { format: "v10" }, { integrityTarget: "sha" }, { frmat: "v9" }])
			assert.isFalse(accepts(schema, value), JSON.stringify(value));
	});

	it("sideEffectsCache accepts a boolean and its object form", () => {
		const { schema } = PnpmSettingsCatalog.sideEffectsCache;
		for (const value of [true, { read: true, write: false }, { exclude: ["esbuild"] }])
			assert.isTrue(accepts(schema, value), JSON.stringify(value));
		for (const value of [{ read: "sometimes" }, { exclude: "esbuild" }, 3])
			assert.isFalse(accepts(schema, value), JSON.stringify(value));
	});

	it("auditConfig is { ignoreGhsas } and refuses any other key", () => {
		const { schema } = PnpmSettingsCatalog.auditConfig;
		assert.isTrue(accepts(schema, { ignoreGhsas: ["GHSA-xxxx-yyyy-zzzz"] }));
		assert.isTrue(accepts(schema, {}));
		assert.isFalse(accepts(schema, { "GHSA-xxxx-yyyy-zzzz": ["lodash"] }));
		assert.isFalse(accepts(schema, { ignoreGhsas: "GHSA-x" }));
	});

	it("updateConfig carries every key pnpm reads", () => {
		const { schema } = PnpmSettingsCatalog.updateConfig;
		const full = {
			ignoreDependencies: ["a"],
			changeset: true,
			githubActions: false,
			githubActionsServer: "https://ghe.example",
		};
		assert.deepStrictEqual(Schema.decodeUnknownSync(schema)(full), full);
		assert.isFalse(accepts(schema, { changeset: "yes-please" }));
	});

	it("every tri-state setting accepts null and its value, and still refuses a wrong type", () => {
		const triStates = inventory.settings.filter((entry) => entry.triState === true).map((entry) => entry.name);
		assert.sameMembers(triStates, ["hoistPattern", "nodeOptions", "publicHoistPattern", "scriptShell"]);
		for (const name of triStates) {
			const { schema } = PnpmSettingsCatalog[name as keyof typeof PnpmSettingsCatalog] as {
				readonly schema: Schema.Codec<unknown, unknown>;
			};
			assert.isTrue(accepts(schema, null), name);
			assert.isFalse(accepts(schema, 42), name);
		}
		assert.isTrue(accepts(PnpmSettingsCatalog.hoistPattern.schema, ["*eslint*"]));
		assert.isTrue(accepts(PnpmSettingsCatalog.scriptShell.schema, "/bin/bash"));
		// The control: a setting that is not tri-state refuses null.
		assert.isFalse(accepts(PnpmSettingsCatalog.hoist.schema, null));
	});

	it("none of the seven phantom settings exist", () => {
		for (const name of [
			"allowNonAppliedPatches",
			"ignoreDepScripts",
			"ignorePatchFailures",
			"managePackageManagerVersions",
			"packageManagerStrict",
			"packageManagerStrictVersion",
			"useNodeVersion",
		])
			assert.notProperty(PnpmSettingsCatalog, name);
	});

	it("the five build settings pnpm 12 never applies are absent", () => {
		assert.sameMembers(inventory.inert, [
			"executionEnv",
			"ignoredBuiltDependencies",
			"neverBuiltDependencies",
			"onlyBuiltDependencies",
			"onlyBuiltDependenciesFile",
		]);
		for (const name of inventory.inert) assert.notProperty(PnpmSettingsCatalog, name);
		// The control: the setting that replaced them is offered.
		assert.property(PnpmSettingsCatalog, "allowBuilds");
	});

	it("versioning and peerDependencyRules are the package's own schemas", () => {
		const versioning = Schema.decodeUnknownSync(PnpmSettingsCatalog.versioning.schema)({ fixed: [["a", "b"]] });
		assert.instanceOf(versioning, VersioningConfig);
		const rules = Schema.decodeUnknownSync(PnpmSettingsCatalog.peerDependencyRules.schema)({
			ignoreMissing: ["react"],
		});
		assert.instanceOf(rules, PeerDependencyRules);
	});

	it("overrides keys are OverrideKey selectors", () => {
		const { schema } = PnpmSettingsCatalog.overrides;
		assert.isTrue(accepts(schema, { foo: "1.0.0", "bar@^1>baz": "-", "@scope/qux": "$qux" }));
		assert.isFalse(accepts(schema, { "a>b>c": "1.0.0" }));
		assert.isFalse(accepts(schema, { foo: 1 }));
	});

	it("documented scalar defaults agree with pnpm's docs", () => {
		// A docs default of exactly **true**, **false** or a bare number is a fact the catalog must repeat.
		let checked = 0;
		for (const entry of inventory.settings) {
			const match = entry.docsDefault?.match(/^\*\*(true|false|\d+)\*\*$/);
			if (match?.[1] === undefined) continue;
			const setting = PnpmSettingsCatalog[entry.name as keyof typeof PnpmSettingsCatalog];
			const expected = match[1] === "true" ? true : match[1] === "false" ? false : Number(match[1]);
			if (entry.name === "update") continue; // documents `update.changeset`'s default under the section heading
			assert.deepStrictEqual(setting.default, Option.some(expected), entry.name);
			checked++;
		}
		assert.isAbove(checked, 60);
	});

	it("every kind is one of the descriptor kinds", () => {
		const kinds = new Set([
			"boolean",
			"number",
			"string",
			"enum",
			"union",
			"stringArray",
			"stringRecord",
			"booleanRecord",
			"unknownRecord",
			"stringArrayRecord",
			"object",
		]);
		for (const setting of Object.values(PnpmSettingsCatalog))
			assert.isTrue(kinds.has(setting.kind), `${setting.name}: ${setting.kind}`);
	});
});
