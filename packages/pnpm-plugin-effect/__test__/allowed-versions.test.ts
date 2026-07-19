// The allowed-versions generator: version-qualified parent rules over the
// effect satellite family, derived from the v4 lock catalog and spliced as
// pure literals (the export CLI statically evaluates the config source and
// rejects anything computed). The final test is the drift tripwire:
// regenerating against the real config must be a byte-level no-op, so a
// catalog advance that skips regeneration fails here.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import {
	BLOCK_END,
	BLOCK_START,
	deriveAllowedVersions,
	extractLockEntries,
	regenerate,
	renderBlock,
	spliceBlock,
} from "../allowed-versions.gen.js";

const here = dirname(fileURLToPath(import.meta.url));
const configFile = join(here, "..", "savvy.build.ts");

const entry = (name: string, range: string, strategy: string): string => {
	const key = name === "effect" ? "effect" : JSON.stringify(name);
	return [
		`\t\t\t\t\t\t${key}: {`,
		`\t\t\t\t\t\t\trange: ${JSON.stringify(range)},`,
		`\t\t\t\t\t\t\tpeer: ${JSON.stringify(range)},`,
		`\t\t\t\t\t\t\tstrategy: ${JSON.stringify(strategy)},`,
		"\t\t\t\t\t\t},",
	].join("\n");
};

const fixtureSource = (effectRange: string, satellites: ReadonlyArray<readonly [string, string]> = []): string =>
	[
		"await build({",
		"\tplugins: [",
		"\t\tPnpmConfigPlugin({",
		'\t\t\tname: "@effected/pnpm-plugin-effect",',
		"\t\t\tcatalogs: {",
		"\t\t\t\teffect: {",
		"\t\t\t\t\tpackages: {",
		...satellites.map(([name, range]) => entry(name, range, "lock")),
		entry("effect", effectRange, "lock"),
		"\t\t\t\t\t},",
		"\t\t\t\t},",
		"\t\t\t\teffect3: {",
		"\t\t\t\t\tpackages: {",
		entry("@effect/platform-node", "^0.107.0", "interop"),
		entry("effect", "^3.21.4", "interop"),
		"\t\t\t\t\t},",
		"\t\t\t\t},",
		"\t\t\t},",
		"\t\t}),",
		"\t],",
		"});",
		"",
	].join("\n");

describe("extractLockEntries", () => {
	it("finds quoted and bare lock entries and ignores the interop catalog", () => {
		const source = fixtureSource("4.0.0-beta.99", [["@effect/platform-node", "4.0.0-beta.99"]]);
		assert.deepStrictEqual(extractLockEntries(source), [
			{ name: "@effect/platform-node", range: "4.0.0-beta.99" },
			{ name: "effect", range: "4.0.0-beta.99" },
		]);
	});

	it("finds nothing in a source without lock entries", () => {
		assert.deepStrictEqual(extractLockEntries("nothing here"), []);
	});
});

describe("deriveAllowedVersions", () => {
	it("emits one version-qualified rule per satellite at the effect pin", () => {
		const table = deriveAllowedVersions([
			{ name: "@effect/vitest", range: "4.0.0-beta.99" },
			{ name: "@effect/platform-node", range: "4.0.0-beta.99" },
			{ name: "effect", range: "4.0.0-beta.99" },
		]);
		assert.deepStrictEqual(table, {
			"@effect/platform-node@4.0.0-beta.99>effect": "4.0.0-beta.99",
			"@effect/vitest@4.0.0-beta.99>effect": "4.0.0-beta.99",
		});
	});

	it("emits no rule for effect itself and no blanket or unqualified key", () => {
		const table = deriveAllowedVersions([
			{ name: "@effect/vitest", range: "4.0.0-beta.99" },
			{ name: "effect", range: "4.0.0-beta.99" },
		]);
		assert.isFalse(Object.hasOwn(table, "effect"));
		for (const key of Object.keys(table)) {
			assert.match(key, /^@effect\/[^@]+@[^>]+>effect$/);
		}
	});

	it("skips a satellite whose range is not exact", () => {
		const table = deriveAllowedVersions([
			{ name: "@effect/tsgo", range: "^0.19.0" },
			{ name: "@effect/vitest", range: "4.0.0-beta.99" },
			{ name: "effect", range: "4.0.0-beta.99" },
		]);
		assert.deepStrictEqual(Object.keys(table), ["@effect/vitest@4.0.0-beta.99>effect"]);
	});

	it("refuses a missing or non-exact effect pin", () => {
		assert.throws(() => deriveAllowedVersions([{ name: "@effect/vitest", range: "4.0.0-beta.99" }]));
		assert.throws(() =>
			deriveAllowedVersions([
				{ name: "@effect/vitest", range: "4.0.0-beta.99" },
				{ name: "effect", range: "^4.0.0-beta.99" },
			]),
		);
	});
});

describe("spliceBlock", () => {
	const rendered = renderBlock(
		deriveAllowedVersions([
			{ name: "@effect/vitest", range: "4.0.0-beta.99" },
			{ name: "effect", range: "4.0.0-beta.99" },
		]),
	);

	it("inserts after the name anchor when absent and is idempotent", () => {
		const once = spliceBlock(fixtureSource("4.0.0-beta.99"), rendered);
		assert.include(once, BLOCK_START);
		assert.include(once, '"@effect/vitest@4.0.0-beta.99>effect": "4.0.0-beta.99",');
		assert.strictEqual(spliceBlock(once, rendered), once);
	});

	it("replaces an existing block wholesale", () => {
		const once = spliceBlock(fixtureSource("4.0.0-beta.99"), rendered);
		const other = renderBlock(
			deriveAllowedVersions([
				{ name: "@effect/platform-node", range: "4.0.0-beta.100" },
				{ name: "effect", range: "4.0.0-beta.100" },
			]),
		);
		const twice = spliceBlock(once, other);
		assert.notInclude(twice, '>effect": "4.0.0-beta.99"');
		assert.include(twice, '"@effect/platform-node@4.0.0-beta.100>effect": "4.0.0-beta.100",');
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
	it("the real catalog yields a rule per exact-pinned satellite", () => {
		const entries = extractLockEntries(readFileSync(configFile, "utf8"));
		const table = deriveAllowedVersions(entries);
		assert.isAtLeast(Object.keys(table).length, 20);
		assert.isTrue(
			Object.keys(table).some((key) => key.startsWith("@effect/platform-node-shared@") && key.endsWith(">effect")),
		);
	});

	it("drift tripwire: the committed table is exactly what regeneration produces", () => {
		const source = readFileSync(configFile, "utf8");
		assert.strictEqual(regenerate(source), source);
	});
});
