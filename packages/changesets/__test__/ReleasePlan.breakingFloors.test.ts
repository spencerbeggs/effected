import { assert, describe, it } from "@effect/vitest";
import { WorkspacePackage } from "@effected/workspaces";
import { Result } from "effect";
import { ChangesetConfig } from "../src/ChangesetConfig.js";
import { PendingChangeset } from "../src/PendingChangesets.js";
import { ReleasePlan } from "../src/ReleasePlan.js";

type Dependencies = Pick<
	Partial<WorkspacePackage>,
	"dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies"
>;

const pkg = (name: string, version: string, extra: Dependencies = {}): WorkspacePackage =>
	WorkspacePackage.make({
		name,
		version,
		path: `/repo/packages/${name}`,
		packageJsonPath: `/repo/packages/${name}/package.json`,
		relativePath: `packages/${name}`,
		workspaceRoot: "/repo",
		...extra,
	});

const change = (file: string, releases: Record<string, "patch" | "minor" | "major">): PendingChangeset =>
	PendingChangeset.make({ file, releases: new Map(Object.entries(releases)), summary: "Summary." });

const config = (fields: Partial<ChangesetConfig> = {}): ChangesetConfig =>
	ChangesetConfig.make({
		baseBranch: "main",
		fixed: [],
		linked: [],
		ignore: [],
		updateInternalDependencies: "patch",
		privatePackages: { tag: false, version: true },
		access: "restricted",
		commit: false,
		extra: {},
		...fields,
	});

/** Assemble, then answer the crossings as `[name, type, required, ...dependency@range]` rows. */
const floors = (
	packages: ReadonlyArray<WorkspacePackage>,
	changesets: ReadonlyArray<PendingChangeset>,
	fields: Partial<ChangesetConfig> = {},
) => {
	const made = config(fields);
	const result = ReleasePlan.assemble({ packages, changesets, config: made });
	assert.isTrue(Result.isSuccess(result), "the plan should assemble");
	if (Result.isFailure(result)) return [];
	const crossings = ReleasePlan.breakingFloors(result.success, { packages, config: made });
	assert.isTrue(Result.isSuccess(crossings), "the floors should compute");
	if (Result.isFailure(crossings)) return [];
	return crossings.success.map((floor) => [
		floor.name,
		floor.type,
		floor.required,
		...floor.causes.map((cause) => `${cause.kind}:${cause.dependency}@${cause.range}`),
	]);
};

describe("ReleasePlan.breakingFloors", () => {
	it("reports a ripple patch whose workspace-caret peer crosses a 0.x minor (effected#1333)", () => {
		// lockfiles 0.24.1 shipped requiring npm 0.34 as a patch.
		const packages = [pkg("npm", "0.33.0"), pkg("lockfiles", "0.24.0", { peerDependencies: { npm: "workspace:^" } })];
		assert.deepStrictEqual(floors(packages, [change("one.md", { npm: "minor" })]), [
			["lockfiles", "patch", "minor", "peerDependencies:npm@^0.34.0"],
		]);
	});

	it("reports a dependent's own patch changeset the same way", () => {
		const packages = [pkg("npm", "0.33.0"), pkg("lockfiles", "0.24.0", { peerDependencies: { npm: "workspace:^" } })];
		const changesets = [change("one.md", { npm: "minor" }), change("two.md", { lockfiles: "patch" })];
		assert.deepStrictEqual(floors(packages, changesets), [
			["lockfiles", "patch", "minor", "peerDependencies:npm@^0.34.0"],
		]);
	});

	it("passes a dependent that is already breaking", () => {
		const packages = [pkg("npm", "0.33.0"), pkg("lockfiles", "0.24.0", { peerDependencies: { npm: "workspace:^" } })];
		const changesets = [change("one.md", { npm: "minor", lockfiles: "minor" })];
		assert.deepStrictEqual(floors(packages, changesets), []);
	});

	it("passes a dependency that stays on its line", () => {
		const packages = [pkg("npm", "0.33.0"), pkg("lockfiles", "0.24.0", { peerDependencies: { npm: "workspace:^" } })];
		assert.deepStrictEqual(floors(packages, [change("one.md", { npm: "patch", lockfiles: "patch" })]), []);
	});

	it("requires a major above 1.0 and treats a 1.x minor as not breaking", () => {
		const packages = [pkg("a", "1.2.0"), pkg("b", "2.0.0", { peerDependencies: { a: "workspace:^" } })];
		assert.deepStrictEqual(floors(packages, [change("one.md", { a: "minor", b: "patch" })]), []);
		assert.deepStrictEqual(floors(packages, [change("one.md", { a: "major" })]), [
			["b", "patch", "major", "peerDependencies:a@^2.0.0"],
		]);
	});

	it("reads peers only: a regular, optional or dev dependency nests privately", () => {
		const packages = [
			pkg("a", "0.1.0"),
			pkg("dev", "0.1.0", { devDependencies: { a: "workspace:^" } }),
			pkg("opt", "0.1.0", { optionalDependencies: { a: "workspace:*" } }),
			pkg("reg", "0.1.0", { dependencies: { a: "workspace:~" } }),
			pkg("peer", "0.1.0", { peerDependencies: { a: "workspace:*" } }),
		];
		const changesets = [change("one.md", { a: "minor", dev: "patch", opt: "patch", reg: "patch", peer: "patch" })];
		assert.deepStrictEqual(floors(packages, changesets), [["peer", "patch", "minor", "peerDependencies:a@0.2.0"]]);
	});

	it("publishes workspace:~ as a tilde on the new version", () => {
		const packages = [pkg("a", "0.1.0"), pkg("b", "0.1.0", { peerDependencies: { a: "workspace:~" } })];
		assert.deepStrictEqual(floors(packages, [change("one.md", { a: "minor" })]), [
			["b", "patch", "minor", "peerDependencies:a@~0.2.0"],
		]);
	});

	const widened = () => [
		pkg("a", "0.3.0"),
		pkg("b", "0.1.0", { peerDependencies: { a: "workspace:^0.3.0 || ^0.4.0" } }),
		pkg("c", "0.1.0", { peerDependencies: { a: "^0.3.0 || ^0.4.0" } }),
	];

	it("passes a widened range that onlyUpdatePeerDependentsWhenOutOfRange keeps as written", () => {
		const extra = {
			___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: { onlyUpdatePeerDependentsWhenOutOfRange: true },
		};
		assert.deepStrictEqual(
			floors(widened(), [change("one.md", { a: "minor", b: "patch", c: "patch" })], { extra }),
			[],
		);
	});

	it("reports a widened range that changeset version rewrites to the new version's caret", () => {
		// A held peer range is rewritten unless the option is on, keeping only its leading operator.
		assert.deepStrictEqual(floors(widened(), [change("one.md", { a: "minor", b: "patch", c: "patch" })]), [
			["b", "patch", "minor", "peerDependencies:a@^0.4.0"],
			["c", "patch", "minor", "peerDependencies:a@^0.4.0"],
		]);
	});

	it("reports a workspace range the release leaves, read as rewritten", () => {
		const packages = [pkg("a", "0.3.0"), pkg("b", "0.1.0", { peerDependencies: { a: "workspace:^0.3.0" } })];
		assert.deepStrictEqual(floors(packages, [change("one.md", { a: "minor" })]), [
			["b", "patch", "minor", "peerDependencies:a@^0.4.0"],
		]);
	});

	it("reports a held lower bound that changeset version moves up to the new version", () => {
		const packages = [pkg("a", "1.2.0"), pkg("b", "0.1.0", { peerDependencies: { a: ">=1.2.0" } })];
		assert.deepStrictEqual(floors(packages, [change("one.md", { a: "major", b: "patch" })]), [
			["b", "patch", "minor", "peerDependencies:a@>=2.0.0"],
		]);
	});

	it("keeps a rewritten range's operator, so a moved upper bound still admits the old line", () => {
		const packages = [pkg("a", "0.3.0"), pkg("b", "0.1.0", { peerDependencies: { a: "<=0.3.0" } })];
		assert.deepStrictEqual(floors(packages, [change("one.md", { a: "minor" })]), []);
	});

	it("reports a literal range the release leaves, which changeset version rewrites", () => {
		const packages = [pkg("a", "0.3.0"), pkg("b", "0.1.0", { peerDependencies: { a: "^0.3.0" } })];
		assert.deepStrictEqual(floors(packages, [change("one.md", { a: "minor" })]), [
			["b", "patch", "minor", "peerDependencies:a@^0.4.0"],
		]);
	});

	it("needs only a patch to leave a 0.0.x line, so a 0.0.x patch passes", () => {
		const packages = [pkg("a", "0.1.0"), pkg("b", "0.0.3", { peerDependencies: { a: "workspace:^" } })];
		assert.deepStrictEqual(floors(packages, [change("one.md", { a: "minor" })]), []);
	});

	it("names every cause, sorted, and stops at the first hop", () => {
		// c crosses nothing yet: b is a patch. Raising b is the caller's next plan.
		const packages = [
			pkg("z", "0.1.0"),
			pkg("a", "0.1.0"),
			pkg("b", "0.5.0", { peerDependencies: { z: "workspace:^", a: "workspace:^" } }),
			pkg("c", "0.9.0", { peerDependencies: { b: "workspace:^" } }),
		];
		assert.deepStrictEqual(floors(packages, [change("one.md", { a: "minor", z: "minor" })]), [
			["b", "patch", "minor", "peerDependencies:a@^0.2.0", "peerDependencies:z@^0.2.0"],
		]);
	});

	it("reads a linked member's breaking line from its own version, not the group's", () => {
		// b is linked with c at 0.9.0, so changesets bumps b from 0.9.0: 0.9.1 is a new line for b at 0.4.0.
		const packages = [
			pkg("a", "0.1.0"),
			pkg("b", "0.4.0", { peerDependencies: { a: "workspace:^" } }),
			pkg("c", "0.9.0"),
		];
		assert.deepStrictEqual(
			floors(packages, [change("one.md", { a: "minor", b: "patch" })], { linked: [["b", "c"]] }),
			[],
		);
	});
});
