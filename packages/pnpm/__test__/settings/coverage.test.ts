// The catalog against the inventory extracted from pnpm 12.20.0's source
// (`../fixtures/pnpm-12.20.0-settings.json`, provenance in its README). Set
// equality both ways: a setting pnpm reads that the catalog lacks, and a catalog
// entry pnpm does not read, each fail by name.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { assert, describe, it } from "@effect/vitest";
import type { PnpmSettingName } from "../../src/settings.js";
import { PnpmSettingsCatalog } from "../../src/settings.js";
import inventory from "../fixtures/pnpm-12.20.0-settings.json" with { type: "json" };

interface InventoryEntry {
	readonly name: string;
	readonly locations: ReadonlyArray<string>;
	readonly documented: boolean;
	readonly anchor: string;
	readonly triState?: boolean;
	readonly envFormat?: string;
}

const PNPM_SOURCE = fileURLToPath(new URL("../../../../.repos/pnpm/pnpm/crates/config/src", import.meta.url));
const EXTRACTOR = fileURLToPath(new URL("../../scripts/extract-pnpm-settings.mts", import.meta.url));

const entries: ReadonlyArray<InventoryEntry> = inventory.settings;
const catalogNames = new Set(Object.keys(PnpmSettingsCatalog.entries));
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
		for (const [key, setting] of Object.entries(PnpmSettingsCatalog.entries)) assert.strictEqual(setting.name, key);
	});

	it("each entry's locations and anchor are pnpm's", () => {
		for (const entry of entries) {
			const setting = PnpmSettingsCatalog.entries[entry.name as PnpmSettingName];
			if (setting === undefined) continue;
			assert.deepStrictEqual([...setting.locations].sort(), [...entry.locations].sort(), entry.name);
			assert.strictEqual(setting.anchor, entry.anchor, entry.name);
			assert.strictEqual(setting.envFormat, entry.envFormat, entry.name);
		}
	});

	it("each entry carries a description", () => {
		for (const setting of Object.values(PnpmSettingsCatalog.entries))
			assert.isAbove(setting.description.length, 10, setting.name);
	});

	it("the inert build settings and the other-version settings are not offered", () => {
		assert.lengthOf(inventory.inert, 5);
		for (const name of [...inventory.inert, ...inventory.otherVersions.map((entry) => entry.name)])
			assert.isFalse(catalogNames.has(name), name);
	});

	it.runIf(existsSync(PNPM_SOURCE))("the inventory fixture is current with the vendored pnpm source", () => {
		// The extractor's own comparison: a re-pin of .repos/pnpm without re-extraction goes red here.
		const run = spawnSync(process.execPath, [EXTRACTOR, "--check"], { encoding: "utf8" });
		assert.strictEqual(run.status, 0, `${run.stdout}${run.stderr}`);
	});
});
