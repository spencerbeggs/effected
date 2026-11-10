import { assert, describe, it } from "@effect/vitest";
import { WorkspacePackage } from "@effected/workspaces";
import { Result, Schema } from "effect";
import { ChangesetConfig } from "../src/ChangesetConfig.js";
import { PendingChangeset } from "../src/PendingChangesets.js";
import { PlannedRelease, ReleasePlan } from "../src/ReleasePlan.js";

const pkg = (name: string, version: string, dependencies: Record<string, string> = {}): WorkspacePackage =>
	WorkspacePackage.make({
		name,
		version,
		path: `/repo/packages/${name}`,
		packageJsonPath: `/repo/packages/${name}/package.json`,
		relativePath: `packages/${name}`,
		workspaceRoot: "/repo",
		dependencies,
	});

const config = Schema.decodeUnknownSync(ChangesetConfig)({});

const release = (name: string, type: "patch" | "minor" | "none", oldVersion: string, newVersion: string) =>
	PlannedRelease.make({ name, type, oldVersion, newVersion, changesets: [] });

describe("ReleasePlan.edits", () => {
	it("fails InvalidVersionError when a bounded range must be bumped past a new version that is not one", () => {
		const plan = ReleasePlan.make({
			releases: [release("a", "minor", "1.0.0", "not-a-version"), release("b", "patch", "1.0.0", "1.0.1")],
			changesets: [],
		});
		const result = ReleasePlan.edits(plan, {
			packages: [pkg("a", "1.0.0"), pkg("b", "1.0.0", { a: ">=1.0.0 <1.1.0" })],
			config,
		});
		assert.isTrue(Result.isFailure(result) && result.failure._tag === "InvalidVersionError");
	});

	it("leaves out a none entry's version and a manifest with nothing to change", () => {
		const plan = ReleasePlan.make({
			releases: [release("a", "patch", "1.0.0", "1.0.1"), release("b", "none", "1.0.0", "1.0.0")],
			changesets: [PendingChangeset.make({ file: "one.md", releases: new Map([["a", "patch"]]), summary: "S." })],
		});
		const result = ReleasePlan.edits(plan, {
			packages: [pkg("a", "1.0.0"), pkg("b", "1.0.0", { a: "^1.0.0" })],
			config,
		});
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result)) {
			// b's range on a is rewritten (a patch meets updateInternalDependencies), its version is not.
			assert.deepStrictEqual(
				result.success.manifests.map((m) => [m.name, m.version, m.ranges.map((r) => r.to)]),
				[
					["a", "1.0.1", []],
					["b", undefined, ["^1.0.1"]],
				],
			);
			assert.deepStrictEqual(result.success.deleteChangesets, ["one.md"]);
			assert.isUndefined(result.success.preState);
		}
	});

	it("never rewrites a ~> range, which @effected/semver rejects (the oracle writes it as ~)", () => {
		const plan = ReleasePlan.make({
			releases: [release("a", "minor", "1.0.0", "1.1.0"), release("b", "patch", "1.0.0", "1.0.1")],
			changesets: [],
		});
		const result = ReleasePlan.edits(plan, {
			packages: [pkg("a", "1.0.0"), pkg("b", "1.0.0", { a: "~>1.0.0" })],
			config,
		});
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result)) {
			assert.deepStrictEqual(
				result.success.manifests.map((m) => [m.name, m.ranges.length]),
				[
					["a", 0],
					["b", 0],
				],
			);
		}
	});
});
