import { assert, describe, it } from "@effect/vitest";

describe("@effected/pnpm root entry", () => {
	it("exports the pnpm-only modules moved in from npm, workspaces and lockfiles", async () => {
		assert.deepStrictEqual(Object.keys(await import("../src/index.js")).sort(), [
			"Epic",
			"PartialReleaseAgeGate",
			"PnpmEnvDocument",
			"PnpmExtension",
			"PnpmLockDocument",
			"PnpmMatcher",
			"PnpmSettings",
			"PnpmSettingsError",
			"ReleaseAgeGate",
			"VersioningConfig",
		]);
	});
});
