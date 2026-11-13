// The catalog against the inventory extracted from pnpm 12.20.0's source
// (`../fixtures/pnpm-12.20.0-settings.json`, provenance in its README). Set
// equality both ways: a setting pnpm reads that the catalog lacks, and a catalog
// entry pnpm does not read, each fail by name.

import { assert, describe, it } from "@effect/vitest";
import { PnpmSettingsCatalog } from "../../src/settings.js";
import inventory from "../fixtures/pnpm-12.20.0-settings.json" with { type: "json" };

interface InventoryEntry {
	readonly name: string;
	readonly locations: ReadonlyArray<string>;
	readonly documented: boolean;
	readonly anchor: string;
	readonly triState?: boolean;
}

const entries: ReadonlyArray<InventoryEntry> = inventory.settings;
const catalogNames = new Set(Object.keys(PnpmSettingsCatalog));
const inventoryNames = new Set(entries.map((entry) => entry.name));

describe("the catalog covers pnpm 12.20.0", () => {
	it("the inventory was extracted", () => {
		// The control: an empty walk would make both set checks vacuous.
		assert.isAbove(entries.length, 200);
		assert.isAbove(entries.filter((entry) => entry.documented).length, 130);
	});

	it("every documented pnpm 12.20.0 setting has a catalog entry", () => {
		const missing = entries.filter((entry) => !catalogNames.has(entry.name)).map((entry) => entry.name);
		assert.deepStrictEqual(missing, []);
	});

	it("every catalog entry exists in pnpm 12.20.0", () => {
		const extra = [...catalogNames].filter((name) => !inventoryNames.has(name));
		assert.deepStrictEqual(extra, []);
	});

	it("each entry is keyed by its own name", () => {
		for (const [key, setting] of Object.entries(PnpmSettingsCatalog)) assert.strictEqual(setting.name, key);
	});

	it("each entry's locations and anchor are pnpm's", () => {
		for (const entry of entries) {
			const setting = PnpmSettingsCatalog[entry.name as keyof typeof PnpmSettingsCatalog];
			if (setting === undefined) continue;
			assert.deepStrictEqual([...setting.locations].sort(), [...entry.locations].sort(), entry.name);
			assert.strictEqual(setting.anchor, entry.anchor, entry.name);
		}
	});

	it("each entry carries a description", () => {
		for (const setting of Object.values(PnpmSettingsCatalog))
			assert.isAbove(setting.description.length, 10, setting.name);
	});

	it("the inert build settings and the other-version settings are not offered", () => {
		assert.lengthOf(inventory.inert, 5);
		for (const name of [...inventory.inert, ...inventory.otherVersions.map((entry) => entry.name)])
			assert.isFalse(catalogNames.has(name), name);
	});
});
