import { assert, describe, it } from "@effect/vitest";
import { WorkspacePackage } from "@effected/workspaces";
import { Effect, Option, Schema } from "effect";
import type { ChangelogFunctions } from "../src/Changelog.js";
import { Changelog } from "../src/Changelog.js";
import { ChangesetConfig } from "../src/ChangesetConfig.js";
import { PendingChangeset } from "../src/PendingChangesets.js";
import { PlannedRelease, ReleasePlan } from "../src/ReleasePlan.js";

const pkg = (name: string, version: string): WorkspacePackage =>
	WorkspacePackage.make({
		name,
		version,
		path: `/repo/packages/${name}`,
		packageJsonPath: `/repo/packages/${name}/package.json`,
		relativePath: `packages/${name}`,
		workspaceRoot: "/repo",
	});

const changeset = PendingChangeset.make({
	file: "one.md",
	releases: new Map([["a", "minor"]]),
	summary: "\nA change.\n\n",
});
const release = PlannedRelease.make({
	name: "a",
	type: "minor",
	oldVersion: "1.0.0",
	newVersion: "1.1.0",
	changesets: ["one.md"],
});
const plan = ReleasePlan.make({ releases: [release], changesets: [changeset] });
const config = (written: unknown = {}) => Schema.decodeUnknownSync(ChangesetConfig)(written);

const lines = (seen: Array<unknown>): ChangelogFunctions => ({
	getReleaseLine: (cs, type, opts) => {
		seen.push({ id: cs.id, summary: cs.summary, commit: cs.commit, type, opts });
		return `- ${cs.summary}`;
	},
	getDependencyReleaseLine: () => "",
});

describe("Changelog.entry", () => {
	it.effect("passes the trimmed summary, the id, the commit and the config's options", () =>
		Effect.gen(function* () {
			const seen: Array<unknown> = [];
			const block = yield* Changelog.entry(plan, release, lines(seen), {
				packages: [pkg("a", "1.0.0")],
				config: config({ changelog: ["mod", { repo: "x/y" }] }),
				commits: new Map([["one.md", "abc"]]),
			});
			assert.deepStrictEqual(seen, [
				{ id: "one", summary: "A change.", commit: "abc", type: "minor", opts: { repo: "x/y" } },
			]);
			assert.deepStrictEqual(block, Option.some("## 1.1.0\n\n### Minor Changes\n\n- A change."));
		}),
	);

	it.effect("answers none for a none entry and 'No changes' for a block with no lines", () =>
		Effect.gen(function* () {
			const none = PlannedRelease.make({ ...release, type: "none", newVersion: "1.0.0" });
			const options = { packages: [pkg("a", "1.0.0")], config: config() };
			assert.isTrue(Option.isNone(yield* Changelog.entry(plan, none, lines([]), options)));
			const empty = { getReleaseLine: () => "", getDependencyReleaseLine: () => "" };
			assert.deepStrictEqual(
				yield* Changelog.entry(plan, release, empty, options),
				Option.some("## 1.1.0\n\nNo changes in this release."),
			);
		}),
	);

	it.effect("fails ChangelogError when a function throws or rejects", () =>
		Effect.gen(function* () {
			const options = { packages: [pkg("a", "1.0.0")], config: config() };
			const throws = {
				getReleaseLine: () => {
					throw new Error("boom");
				},
				getDependencyReleaseLine: () => "",
			};
			const thrown = yield* Effect.flip(Changelog.entry(plan, release, throws, options));
			assert.isTrue(thrown._tag === "ChangelogError" && thrown.message.includes("boom"));
			const rejects = { getReleaseLine: () => Promise.reject(new Error("later")), getDependencyReleaseLine: () => "" };
			const rejected = yield* Effect.flip(Changelog.entry(plan, release, rejects, options));
			assert.isTrue(rejected._tag === "ChangelogError" && rejected.message.includes("later"));
		}),
	);

	it.effect("fails MissingPackageError and ChangesetConfigError", () =>
		Effect.gen(function* () {
			const missing = yield* Effect.flip(Changelog.entry(plan, release, lines([]), { packages: [], config: config() }));
			assert.strictEqual(missing._tag, "MissingPackageError");
			const bad = yield* Effect.flip(
				Changelog.entry(plan, release, lines([]), {
					packages: [pkg("a", "1.0.0")],
					config: config({ changelog: ["mod", "not-an-object"] }),
				}),
			);
			assert.strictEqual(bad._tag, "ChangesetConfigError");
			// An override replaces the config's options, a bad one included.
			const seen: Array<{ opts: unknown }> = [];
			yield* Changelog.entry(plan, release, lines(seen), {
				packages: [pkg("a", "1.0.0")],
				config: config({ changelog: ["mod", "not-an-object"] }),
				changelogOptions: null,
			});
			assert.isNull(seen[0]?.opts);
		}),
	);
});

describe("Changelog.insert", () => {
	it("starts an empty file with the package heading", () => {
		assert.strictEqual(Changelog.insert("", "## 1.0.1\n\n- x\n\n", "a"), "# a\n\n## 1.0.1\n\n- x\n");
	});

	it("goes before the first version heading", () => {
		assert.strictEqual(
			Changelog.insert("# a\n\nIntro.\n\n## 1.0.0\n\n- old\n", "## 1.0.1\n\n- new", "a"),
			"# a\n\nIntro.\n\n## 1.0.1\n\n- new\n\n## 1.0.0\n\n- old\n",
		);
	});

	it("goes after the first line when no version heading exists, and appends to a one-line file", () => {
		assert.strictEqual(Changelog.insert("# a\nrest\n", "## 1.0.1", "a"), "# a\n\n## 1.0.1\nrest\n");
		assert.strictEqual(Changelog.insert("# a", "## 1.0.1", "a"), "# a\n\n## 1.0.1\n");
	});
});
