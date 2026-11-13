import { assert, describe, it } from "@effect/vitest";
import { Epic, VersioningConfig } from "@effected/pnpm";
import { WorkspacePackage } from "@effected/workspaces";
import { Result } from "effect";
import { VersioningCheck } from "../src/VersioningCheck.js";

// `check_versioning_invariants` (.repos/pnpm/pnpm/crates/versioning/src/plan.rs:217), case by case.

const pkg = (name: string, dir: string, version: string): WorkspacePackage =>
	WorkspacePackage.make({
		name,
		version,
		path: `/ws/${dir}`,
		packageJsonPath: `/ws/${dir}/package.json`,
		relativePath: dir,
		workspaceRoot: "/ws",
	});

const versioning = (fields: Partial<VersioningConfig>) => VersioningConfig.make(fields);

const found = (packages: ReadonlyArray<WorkspacePackage>, config: VersioningConfig | undefined) => {
	const result = VersioningCheck.check(packages, config);
	assert.isTrue(Result.isSuccess(result));
	return Result.isSuccess(result) ? result.success : [];
};

describe("VersioningCheck.check", () => {
	it("returns an epic and a fixed-group violation together", () => {
		const violations = found(
			[
				pkg("lead", "lead", "3.0.0"),
				pkg("in-band", "a", "300.1.0"),
				pkg("below", "b", "299.0.0"),
				pkg("x", "x", "1.0.0"),
				pkg("y", "y", "1.1.0"),
			],
			versioning({
				epics: [Epic.make({ lead: "lead", packages: ["in-band", "below"] })],
				fixed: [["x", "y"]],
			}),
		);
		assert.deepStrictEqual(
			violations.map((v) => v._tag),
			["EpicOutOfBand", "FixedOutOfStep"],
		);
		const [epic, fixed] = violations;
		assert.strictEqual(epic?._tag === "EpicOutOfBand" && epic.package, "below");
		assert.strictEqual(epic?._tag === "EpicOutOfBand" && epic.bandMajor, 3);
		assert.deepStrictEqual(fixed?._tag === "FixedOutOfStep" && fixed.group, ["x", "y"]);
		assert.deepStrictEqual(fixed?._tag === "FixedOutOfStep" && fixed.versions, [
			{ package: "x", version: "1.0.0" },
			{ package: "y", version: "1.1.0" },
		]);
		assert.match(fixed?.message ?? "", /not in lockstep: x@1.0.0, y@1.1.0/);
		// plan.rs:257 prints the member's major and the band, low-high.
		assert.strictEqual(
			epic?.message,
			'below is at 299.0.0, whose major 299 is outside the band 300-399 of the epic led by "lead" (major 3).',
		);
	});

	it("is empty when every invariant holds", () => {
		assert.deepStrictEqual(
			found(
				[pkg("lead", "lead", "2.0.0"), pkg("m", "m", "250.0.0"), pkg("x", "x", "1.0.0"), pkg("y", "y", "1.0.0")],
				versioning({ epics: [Epic.make({ lead: "lead", packages: ["m"] })], fixed: [["x", "y"]] }),
			),
			[],
		);
		assert.deepStrictEqual(found([pkg("a", "a", "1.0.0")], undefined), []);
	});

	it("keeps a lead on N.0.0-lane.x in the band of N-1", () => {
		const config = versioning({ epics: [Epic.make({ lead: "lead", packages: ["m"] })], lanes: { lead: "rc" } });
		assert.deepStrictEqual(found([pkg("lead", "lead", "3.0.0-rc.1"), pkg("m", "m", "250.0.0")], config), []);
		assert.strictEqual(found([pkg("lead", "lead", "3.0.0-rc.1"), pkg("m", "m", "350.0.0")], config).length, 1);
	});

	it("fails VersioningError for a configuration pnpm refuses, before reading any version", () => {
		const result = VersioningCheck.check(
			[pkg("a", "a", "1.0.0")],
			versioning({ epics: [Epic.make({ lead: "ghost", packages: ["a"] })] }),
		);
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) assert.strictEqual(result.failure.reason, "epicUnknownLead");
	});
});
