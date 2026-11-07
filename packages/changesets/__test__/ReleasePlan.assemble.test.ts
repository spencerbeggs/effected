import { assert, describe, it } from "@effect/vitest";
import { WorkspacePackage } from "@effected/workspaces";
import { Result } from "effect";
import { ChangesetConfig } from "../src/ChangesetConfig.js";
import { PendingChangeset } from "../src/PendingChangesets.js";
import { ReleasePlan } from "../src/ReleasePlan.js";

type Dependencies = Pick<
	Partial<WorkspacePackage>,
	"dependencies" | "devDependencies" | "optionalDependencies" | "peerDependencies" | "private"
>;

const pkg = (name: string, version: string | undefined, extra: Dependencies = {}): WorkspacePackage =>
	WorkspacePackage.make({
		name,
		...(version === undefined ? {} : { version }),
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

const plan = (
	packages: ReadonlyArray<WorkspacePackage>,
	changesets: ReadonlyArray<PendingChangeset>,
	fields: Partial<ChangesetConfig> = {},
) => ReleasePlan.assemble({ packages, changesets, config: config(fields) });

const projected = (result: ReturnType<typeof plan>) => {
	assert.isTrue(Result.isSuccess(result), "the plan should assemble");
	return Result.isSuccess(result)
		? result.success.releases.map((r) => [r.name, r.type, r.oldVersion, r.newVersion] as const)
		: [];
};

const failure = (result: ReturnType<typeof plan>) => {
	assert.isTrue(Result.isFailure(result), "the plan should fail");
	return Result.isFailure(result) ? result.failure : undefined;
};

describe("ReleasePlan.assemble", () => {
	it("plans a single patch and leaves unnamed packages out", () => {
		const result = plan([pkg("a", "1.2.3"), pkg("b", "2.0.0")], [change("one.md", { a: "patch" })]);
		assert.deepStrictEqual(projected(result), [["a", "patch", "1.2.3", "1.2.4"]]);
	});

	it("ripples a minor on a 0.x dependency through a workspace caret", () => {
		const result = plan(
			[pkg("a", "0.23.1"), pkg("b", "1.0.0", { dependencies: { a: "workspace:^" } })],
			[change("one.md", { a: "minor" })],
		);
		assert.deepStrictEqual(projected(result), [
			["a", "minor", "0.23.1", "0.24.0"],
			["b", "patch", "1.0.0", "1.0.1"],
		]);
	});

	it("does not ripple when the workspace caret still holds", () => {
		const result = plan(
			[pkg("a", "1.2.0"), pkg("b", "1.0.0", { dependencies: { a: "workspace:^" } })],
			[change("one.md", { a: "minor" })],
		);
		assert.deepStrictEqual(projected(result), [["a", "minor", "1.2.0", "1.3.0"]]);
	});

	it("ripples a workspace star pin on any bump", () => {
		const result = plan(
			[pkg("a", "1.2.0"), pkg("b", "1.0.0", { dependencies: { a: "workspace:*" } })],
			[change("one.md", { a: "patch" })],
		);
		assert.deepStrictEqual(projected(result), [
			["a", "patch", "1.2.0", "1.2.1"],
			["b", "patch", "1.0.0", "1.0.1"],
		]);
	});

	it("lists a devDependency-only dependent as none, at its old version", () => {
		const result = plan(
			[pkg("a", "1.2.0"), pkg("b", "1.0.0", { devDependencies: { a: "workspace:*" } })],
			[change("one.md", { a: "patch" })],
		);
		assert.deepStrictEqual(projected(result), [
			["a", "patch", "1.2.0", "1.2.1"],
			["b", "none", "1.0.0", "1.0.0"],
		]);
	});

	it("does not ripple onward from a none entry", () => {
		const result = plan(
			[
				pkg("a", "1.2.0"),
				pkg("b", "1.0.0", { devDependencies: { a: "workspace:*" } }),
				pkg("c", "1.0.0", { dependencies: { b: "workspace:*" } }),
			],
			[change("one.md", { a: "patch" })],
		);
		assert.deepStrictEqual(projected(result), [
			["a", "patch", "1.2.0", "1.2.1"],
			["b", "none", "1.0.0", "1.0.0"],
		]);
	});

	it("upgrades a none entry when a second dependency ripples the package for real", () => {
		const result = plan(
			[
				pkg("a", "1.2.0"),
				pkg("b", "1.0.0"),
				pkg("c", "1.0.0", { devDependencies: { a: "workspace:*" }, dependencies: { b: "workspace:*" } }),
			],
			[change("one.md", { a: "patch", b: "patch" })],
		);
		assert.deepStrictEqual(projected(result).at(-1), ["c", "patch", "1.0.0", "1.0.1"]);
	});

	it("ripples transitively through real dependencies", () => {
		const result = plan(
			[
				pkg("a", "1.0.0"),
				pkg("b", "1.0.0", { dependencies: { a: "workspace:*" } }),
				pkg("c", "1.0.0", { peerDependencies: { b: "workspace:*" } }),
				pkg("d", "1.0.0", { optionalDependencies: { c: "workspace:*" } }),
			],
			[change("one.md", { a: "major" })],
		);
		assert.deepStrictEqual(projected(result), [
			["a", "major", "1.0.0", "2.0.0"],
			["b", "patch", "1.0.0", "1.0.1"],
			["c", "patch", "1.0.0", "1.0.1"],
			["d", "patch", "1.0.0", "1.0.1"],
		]);
	});

	it("terminates on a dependency cycle", () => {
		const result = plan(
			[
				pkg("a", "1.0.0", { dependencies: { b: "workspace:*" } }),
				pkg("b", "1.0.0", { dependencies: { a: "workspace:*" } }),
			],
			[change("one.md", { a: "minor" })],
		);
		assert.deepStrictEqual(projected(result), [
			["a", "minor", "1.0.0", "1.1.0"],
			["b", "patch", "1.0.0", "1.0.1"],
		]);
	});

	it("bumps a dependent patch whatever updateInternalDependencies says", () => {
		const result = plan(
			[pkg("a", "1.2.0"), pkg("b", "1.0.0", { dependencies: { a: "workspace:*" } })],
			[change("one.md", { a: "patch" })],
			{ updateInternalDependencies: "minor" },
		);
		assert.deepStrictEqual(projected(result).at(-1), ["b", "patch", "1.0.0", "1.0.1"]);
	});

	it("resolves an explicit workspace range and a plain range as written", () => {
		const result = plan(
			[
				pkg("a", "1.2.0"),
				pkg("wide", "1.0.0", { dependencies: { a: "workspace:^1.0.0" } }),
				pkg("tight", "1.0.0", { dependencies: { a: "~1.2.0" } }),
			],
			[change("one.md", { a: "minor" })],
		);
		assert.deepStrictEqual(projected(result), [
			["a", "minor", "1.2.0", "1.3.0"],
			["tight", "patch", "1.0.0", "1.0.1"],
		]);
	});

	it("resolves a workspace path specifier to the exact current version", () => {
		const result = plan(
			[pkg("a", "1.2.0"), pkg("b", "1.0.0", { dependencies: { a: "workspace:packages/a" } })],
			[change("one.md", { a: "patch" })],
		);
		assert.deepStrictEqual(projected(result).at(-1), ["b", "patch", "1.0.0", "1.0.1"]);
	});

	it("draws no edge for a range the current version misses, or a protocol specifier", () => {
		const result = plan(
			[
				pkg("a", "1.2.0"),
				pkg("missed", "1.0.0", { dependencies: { a: "^0.1.0" } }),
				pkg("catalogued", "1.0.0", { dependencies: { a: "catalog:" } }),
				pkg("linked", "1.0.0", { dependencies: { a: "link:../a" } }),
				pkg("nonsense", "1.0.0", { dependencies: { a: "workspace:nonsense" } }),
			],
			[change("one.md", { a: "major" })],
		);
		assert.deepStrictEqual(projected(result), [["a", "major", "1.2.0", "2.0.0"]]);
	});

	it("draws no devDependency edge for a link or file specifier", () => {
		const result = plan(
			[pkg("a", "1.2.0"), pkg("b", "1.0.0", { devDependencies: { a: "file:../a" } })],
			[change("one.md", { a: "major" })],
		);
		assert.deepStrictEqual(projected(result), [["a", "major", "1.2.0", "2.0.0"]]);
	});

	it("never releases an ignored package named in a changeset", () => {
		const result = plan([pkg("a", "1.0.0")], [change("one.md", { a: "minor" })], { ignore: ["a"] });
		assert.deepStrictEqual(projected(result), []);
	});

	it("expands a glob in ignore over the workspace names", () => {
		const result = plan(
			[pkg("@x/a", "1.0.0"), pkg("@y/b", "1.0.0")],
			[change("one.md", { "@x/a": "minor" }), change("two.md", { "@y/b": "patch" })],
			{ ignore: ["@x/*"] },
		);
		assert.deepStrictEqual(projected(result), [["@y/b", "patch", "1.0.0", "1.0.1"]]);
	});

	it("does not ripple from an ignored package", () => {
		const result = plan(
			[pkg("a", "1.0.0"), pkg("b", "1.0.0", { dependencies: { a: "workspace:*" } })],
			[change("one.md", { a: "major" })],
			{ ignore: ["a", "b"] },
		);
		assert.deepStrictEqual(projected(result), []);
	});

	it("lists an ignored dependent of a released package as none", () => {
		const result = plan(
			[pkg("a", "1.0.0"), pkg("b", "3.0.0", { dependencies: { a: "workspace:^" } })],
			[change("one.md", { a: "patch" })],
			{ ignore: ["b"] },
		);
		assert.deepStrictEqual(projected(result), [
			["a", "patch", "1.0.0", "1.0.1"],
			["b", "none", "3.0.0", "3.0.0"],
		]);
	});

	it("releases a private package only when privatePackages.version is on", () => {
		const packages = [pkg("a", "1.0.0", { private: true })];
		const changesets = [change("one.md", { a: "patch" })];
		assert.deepStrictEqual(projected(plan(packages, changesets)), [["a", "patch", "1.0.0", "1.0.1"]]);
		assert.deepStrictEqual(
			projected(plan(packages, changesets, { privatePackages: { tag: false, version: false } })),
			[],
		);
	});

	it("skips a version-less package and keeps it out of the plan", () => {
		const result = plan(
			[pkg("a", "1.0.0"), pkg("app", undefined, { dependencies: { a: "workspace:*" } }), pkg("named", undefined)],
			[change("one.md", { a: "patch" }), change("two.md", { named: "patch" })],
		);
		assert.deepStrictEqual(projected(result), [["a", "patch", "1.0.0", "1.0.1"]]);
	});

	it("takes the highest bump and lists every contributing file", () => {
		const result = plan(
			[pkg("a", "1.0.0")],
			[change("one.md", { a: "patch" }), change("two.md", { a: "minor" }), change("three.md", { a: "patch" })],
		);
		assert.deepStrictEqual(projected(result), [["a", "minor", "1.0.0", "1.1.0"]]);
		assert.deepStrictEqual(Result.isSuccess(result) ? result.success.releases[0]?.changesets : [], [
			"one.md",
			"two.md",
			"three.md",
		]);
	});

	it("bumps a 0.x package by plain semver", () => {
		assert.deepStrictEqual(projected(plan([pkg("a", "0.23.1")], [change("one.md", { a: "major" })])), [
			["a", "major", "0.23.1", "1.0.0"],
		]);
	});

	it("carries no changesets on a rippled dependent", () => {
		const result = plan(
			[pkg("a", "1.0.0"), pkg("b", "1.0.0", { dependencies: { a: "workspace:*" } })],
			[change("one.md", { a: "patch" })],
		);
		assert.deepStrictEqual(Result.isSuccess(result) ? result.success.releases[1]?.changesets : ["unreached"], []);
	});

	it("draws edges only over the workspace protocol when the config says so", () => {
		const result = plan(
			[pkg("a", "1.2.0"), pkg("b", "1.0.0", { dependencies: { a: "~1.2.0" } })],
			[change("one.md", { a: "minor" })],
			{ extra: { bumpVersionsWithWorkspaceProtocolOnly: true } },
		);
		assert.deepStrictEqual(projected(result), [["a", "minor", "1.2.0", "1.3.0"]]);
	});

	it("ripples a satisfied range when the config asks for always", () => {
		const result = plan(
			[pkg("a", "1.2.0"), pkg("b", "1.0.0", { dependencies: { a: "workspace:^" } })],
			[change("one.md", { a: "patch" })],
			{ extra: { ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: { updateInternalDependents: "always" } } },
		);
		assert.deepStrictEqual(projected(result).at(-1), ["b", "patch", "1.0.0", "1.0.1"]);
	});

	it("fails on a changeset naming a package outside the workspace", () => {
		const error = failure(plan([pkg("a", "1.0.0")], [change("one.md", { ghost: "patch" })]));
		assert.strictEqual(error?._tag, "UnknownPackageError");
		assert.isTrue(
			error?._tag === "UnknownPackageError" && error.packageName === "ghost" && error.changeset === "one.md",
		);
	});

	it("fails on a version that cannot be bumped", () => {
		const error = failure(plan([pkg("a", "not-a-version")], [change("one.md", { a: "patch" })]));
		assert.strictEqual(error?._tag, "InvalidVersionError");
	});

	it("carries an unparseable version on a none entry without failing", () => {
		const result = plan(
			[pkg("a", "1.0.0"), pkg("b", "not-a-version", { devDependencies: { a: "workspace:*" } })],
			[change("one.md", { a: "patch" })],
		);
		assert.deepStrictEqual(projected(result).at(-1), ["b", "none", "not-a-version", "not-a-version"]);
	});

	it("refuses a non-empty fixed or linked group", () => {
		const fixed = failure(plan([pkg("a", "1.0.0")], [], { fixed: [["a"]] }));
		assert.isTrue(fixed?._tag === "UnsupportedChangesetModeError" && fixed.mode === "fixed");
		const linked = failure(plan([pkg("a", "1.0.0")], [], { linked: [["a"]] }));
		assert.isTrue(linked?._tag === "UnsupportedChangesetModeError" && linked.mode === "linked");
	});
});
