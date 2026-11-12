import { assert, describe, it } from "@effect/vitest";

describe("@effected/pnpm root entry", () => {
	it("exports the pnpm-only modules moved in from npm and workspaces", async () => {
		assert.deepStrictEqual(Object.keys(await import("../src/index.js")).sort(), [
			"PartialReleaseAgeGate",
			"PnpmMatcher",
			"PnpmSettings",
			"PnpmSettingsError",
			"ReleaseAgeGate",
		]);
	});
});
