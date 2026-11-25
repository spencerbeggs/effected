import { assert, describe, it } from "vitest";
import type { PackageFacts } from "../lib/scripts/full-test-projects.js";
import { affectedProjects, projectFlags, requestedProjects } from "../lib/scripts/full-test-projects.js";

/**
 * Which packages the Full Tests workflow runs at full depth (#1415).
 *
 * @remarks
 * On the release pull request the diff is version bumps and changelogs, so a changed path under a package means
 * that package is in the release. Its depth-aware tests run, and so do those of every package that depends on it,
 * since a parser's release can break the parity of the linter built on it.
 */
const packages: ReadonlyArray<PackageFacts> = [
	{ name: "@effected/markdown", dir: "packages/markdown", dependsOn: ["@effected/source"], hasDepthAwareTests: false },
	{
		name: "@effected/markdown-lint",
		dir: "packages/markdown-lint",
		dependsOn: ["@effected/markdown", "@effected/jsonc"],
		hasDepthAwareTests: true,
	},
	{ name: "@effected/source", dir: "packages/source", dependsOn: [], hasDepthAwareTests: false },
	{ name: "@effected/glob", dir: "packages/glob", dependsOn: [], hasDepthAwareTests: true },
	{ name: "@effected/xdg", dir: "packages/xdg", dependsOn: [], hasDepthAwareTests: false },
	{ name: "@effected/yaml", dir: "packages/yaml", dependsOn: [], hasDepthAwareTests: false },
];

describe("affectedProjects", () => {
	it("selects a changed depth-aware package", () => {
		assert.deepStrictEqual(affectedProjects(packages, ["packages/glob/package.json"]), ["@effected/glob"]);
	});

	it("selects the depth-aware dependents of a changed package", () => {
		assert.deepStrictEqual(affectedProjects(packages, ["packages/markdown/CHANGELOG.md"]), ["@effected/markdown-lint"]);
	});

	it("follows dependents transitively", () => {
		assert.deepStrictEqual(affectedProjects(packages, ["packages/source/package.json"]), ["@effected/markdown-lint"]);
	});

	it("selects nothing when no changed package or dependent is depth-aware", () => {
		assert.deepStrictEqual(affectedProjects(packages, ["packages/xdg/package.json", ".changeset/x.md"]), []);
		assert.deepStrictEqual(affectedProjects(packages, []), []);
	});

	// `packages/markdown-lint/...` starts with `packages/markdown`, and must not count as a change to it.
	it("does not match a package by directory prefix", () => {
		assert.deepStrictEqual(affectedProjects(packages, ["packages/markdown-lint/package.json"]), [
			"@effected/markdown-lint",
		]);
		assert.deepStrictEqual(affectedProjects(packages, ["packages/glob-extra/package.json"]), []);
	});

	it("lists each project once, sorted by name", () => {
		assert.deepStrictEqual(
			affectedProjects(packages, [
				"packages/markdown/package.json",
				"packages/markdown-lint/CHANGELOG.md",
				"packages/glob/package.json",
			]),
			["@effected/glob", "@effected/markdown-lint"],
		);
	});

	it("terminates on a dependency cycle", () => {
		const cyclic: ReadonlyArray<PackageFacts> = [
			{ name: "a", dir: "packages/a", dependsOn: ["b"], hasDepthAwareTests: true },
			{ name: "b", dir: "packages/b", dependsOn: ["a"], hasDepthAwareTests: true },
		];
		assert.deepStrictEqual(affectedProjects(cyclic, ["packages/a/package.json"]), ["a", "b"]);
	});
});

describe("requestedProjects", () => {
	it("returns every depth-aware package for an empty request", () => {
		assert.deepStrictEqual(requestedProjects(packages, []), ["@effected/glob", "@effected/markdown-lint"]);
	});

	it("returns the named packages, sorted", () => {
		assert.deepStrictEqual(requestedProjects(packages, ["@effected/markdown-lint", "@effected/glob"]), [
			"@effected/glob",
			"@effected/markdown-lint",
		]);
	});

	// A dispatch that names nothing runnable must fail, not report a green run of zero tests.
	it("refuses an unknown name and a package with no depth-aware tests", () => {
		assert.throws(() => requestedProjects(packages, ["@effected/nope"]), /@effected\/nope/);
		assert.throws(() => requestedProjects(packages, ["@effected/xdg"]), /no depth-aware tests/);
	});
});

describe("projectFlags", () => {
	it("prints one --project flag per name, and nothing for none", () => {
		assert.strictEqual(
			projectFlags(["@effected/glob", "@effected/markdown-lint"]),
			"--project @effected/glob --project @effected/markdown-lint",
		);
		assert.strictEqual(projectFlags([]), "");
	});
});
