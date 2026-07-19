// The allowed-versions generator: parent-scoped rules derived from the effect
// lock catalog, spliced as pure literals (the export CLI statically evaluates
// the config source and rejects anything computed). The final test is the
// drift tripwire: regenerating against the real repo must be a byte-level
// no-op, so a catalog advance that skips regeneration fails here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import {
	BLOCK_END,
	BLOCK_START,
	deriveAllowedVersions,
	extractEffectBeta,
	readMemberNames,
	regenerate,
	renderBlock,
	spliceBlock,
} from "../allowed-versions.gen.js";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = join(here, "..");
const packagesDir = join(packageDir, "..");
const configFile = join(packageDir, "savvy.build.ts");

const fixtureSource = (lockRange: string): string =>
	[
		"await build({",
		"\tplugins: [",
		"\t\tPnpmConfigPlugin({",
		'\t\t\tname: "@effected/pnpm-plugin-effect",',
		"\t\t\tcatalogs: {",
		"\t\t\t\teffect: {",
		"\t\t\t\t\tpackages: {",
		"\t\t\t\t\t\teffect: {",
		`\t\t\t\t\t\t\trange: ${JSON.stringify(lockRange)},`,
		'\t\t\t\t\t\t\tpeer: "4.0.0-beta.99",',
		'\t\t\t\t\t\t\tstrategy: "lock",',
		"\t\t\t\t\t\t},",
		"\t\t\t\t\t},",
		"\t\t\t\t},",
		"\t\t\t\teffect3: {",
		"\t\t\t\t\tpackages: {",
		"\t\t\t\t\t\teffect: {",
		'\t\t\t\t\t\t\trange: "^3.21.4",',
		'\t\t\t\t\t\t\tpeer: "^3.21.0",',
		'\t\t\t\t\t\t\tstrategy: "interop",',
		"\t\t\t\t\t\t},",
		"\t\t\t\t\t},",
		"\t\t\t\t},",
		"\t\t\t},",
		"\t\t}),",
		"\t],",
		"});",
		"",
	].join("\n");

describe("deriveAllowedVersions", () => {
	it("emits one parent-scoped rule per member, sorted, at the exact beta", () => {
		const table = deriveAllowedVersions("4.0.0-beta.99", ["@effected/b", "@effected/a"]);
		assert.deepStrictEqual(table, {
			"@effected/a>effect": "4.0.0-beta.99",
			"@effected/b>effect": "4.0.0-beta.99",
		});
		assert.deepStrictEqual(Object.keys(table), ["@effected/a>effect", "@effected/b>effect"]);
	});

	it("never emits a blanket key", () => {
		const table = deriveAllowedVersions("4.0.0-beta.99", ["@effected/a"]);
		assert.isFalse(Object.hasOwn(table, "effect"));
		for (const key of Object.keys(table)) {
			assert.include(key, ">effect");
		}
	});

	it("refuses a non-exact beta", () => {
		assert.throws(() => deriveAllowedVersions("^4.0.0-beta.99", ["@effected/a"]));
		assert.throws(() => deriveAllowedVersions("4.0.0-beta.99 || 5", ["@effected/a"]));
	});

	it("refuses a parent outside the kit", () => {
		assert.throws(() => deriveAllowedVersions("4.0.0-beta.99", ["someone-else"]));
	});
});

describe("extractEffectBeta", () => {
	it("finds the lock catalog's pin and ignores the interop entry", () => {
		assert.strictEqual(extractEffectBeta(fixtureSource("4.0.0-beta.99")), "4.0.0-beta.99");
	});

	it("refuses a caret pin", () => {
		assert.throws(() => extractEffectBeta(fixtureSource("^4.0.0-beta.99")));
	});

	it("refuses a source with no lock entry", () => {
		assert.throws(() => extractEffectBeta("nothing here"));
	});
});

describe("spliceBlock", () => {
	const rendered = renderBlock(deriveAllowedVersions("4.0.0-beta.99", ["@effected/a"]));

	it("inserts after the name anchor when absent and is idempotent", () => {
		const once = spliceBlock(fixtureSource("4.0.0-beta.99"), rendered);
		assert.include(once, BLOCK_START);
		assert.include(once, '"@effected/a>effect": "4.0.0-beta.99",');
		assert.strictEqual(spliceBlock(once, rendered), once);
	});

	it("replaces an existing block wholesale", () => {
		const once = spliceBlock(fixtureSource("4.0.0-beta.99"), rendered);
		const other = renderBlock(deriveAllowedVersions("4.0.0-beta.100", ["@effected/a", "@effected/b"]));
		const twice = spliceBlock(once, other);
		assert.notInclude(twice, '>effect": "4.0.0-beta.99"');
		assert.include(twice, '"@effected/b>effect": "4.0.0-beta.100",');
		assert.strictEqual(twice.split(BLOCK_START).length, 2);
	});

	it("refuses malformed sentinels", () => {
		const mangled = spliceBlock(fixtureSource("4.0.0-beta.99"), rendered).replace(BLOCK_END, "");
		assert.throws(() => spliceBlock(mangled, rendered));
	});

	it("refuses a source without the name anchor", () => {
		assert.throws(() => spliceBlock("const x = 1;\n", rendered));
	});
});

describe("against the real repo", () => {
	it("reads the kit members from packages/", () => {
		const members = readMemberNames(packagesDir);
		assert.include(members, "@effected/markdown");
		assert.include(members, "@effected/pnpm-plugin-effect");
		for (const name of members) {
			assert.isTrue(name.startsWith("@effected/"));
		}
		assert.deepStrictEqual([...members], [...members].sort());
	});

	it("drift tripwire: the committed table is exactly what regeneration produces", () => {
		const source = readFileSync(configFile, "utf8");
		assert.strictEqual(regenerate(source, packagesDir), source);
	});
});
