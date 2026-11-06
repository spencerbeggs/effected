import { assert, it } from "@effect/vitest";
import * as Changesets from "../src/index.js";

it("the root exports exactly the public surface", () => {
	assert.deepStrictEqual(Object.keys(Changesets).sort(), [
		"BumpType",
		"ChangesetConfig",
		"ChangesetConfigError",
		"ChangesetFile",
		"ChangesetParseError",
		"ParsedChangeset",
		"PendingChangeset",
		"PendingChangesets",
		"PlannedRelease",
		"ReleasePlan",
		"UnknownPackageError",
		"UnsupportedChangesetModeError",
	]);
});
