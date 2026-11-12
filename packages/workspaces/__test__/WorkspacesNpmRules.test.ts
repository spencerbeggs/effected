// An npm root reads `package.json#workspaces` the way npm does (#1329), through
// `@effected/npm`'s `NpmWorkspacePatterns`; a yarn or bun root on the same
// patterns keeps `GlobSet` set semantics. The six rows are the pattern sets on
// which the two readings were probed to disagree, so every row discriminates:
// each is asserted on an npm root AND on a yarn and a bun root, and the answers
// differ. All three readers — `WorkspaceDiscovery`, `getWorkspacePackagesSync`
// and `WorkspaceSnapshots.at` — share one membership, and each is asserted.

import nodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Git, LsTreeEntry } from "@effected/git";
import { GlobPatternError } from "@effected/glob";
import { MemoryFileSystem } from "@effected/memfs";
import { CatalogAssemblyError, NpmWorkspacePatternsError } from "@effected/npm";
import { Effect, Layer, Option } from "effect";
import {
	ConfigDependencyHooks,
	WorkspaceDiscovery,
	WorkspacePatternError,
	WorkspaceRoot,
	WorkspaceSnapshots,
	Workspaces,
	getWorkspacePackagesSync,
} from "../src/index.js";
import type { Tree } from "./fixtures.js";
import { manifest, platform, rootManifest } from "./fixtures.js";

/** The members every row chooses among. */
const MEMBERS: Tree = {
	"/repo/packages/a/package.json": manifest("a"),
	"/repo/packages/b/package.json": manifest("b"),
	"/repo/apps/c/package.json": manifest("c"),
};

interface Row {
	readonly patterns: ReadonlyArray<string>;
	/** npm's answer: what `map-workspaces` (and `@effected/lockfiles`) decide. */
	readonly npm: ReadonlyArray<string>;
	/** `GlobSet`'s answer: set-level, order-independent exclusion. */
	readonly glob: ReadonlyArray<string>;
	/** What makes the two disagree. */
	readonly rule: string;
}

const ROWS: ReadonlyArray<Row> = [
	{ patterns: ["packages/*", "!packages/a", "packages/a"], npm: ["a", "b"], glob: ["b"], rule: "ordered negation" },
	{ patterns: ["apps/c", "!apps/*", "apps/c"], npm: ["c"], glob: [], rule: "ordered negation of a literal" },
	{ patterns: ["packages/*/"], npm: ["a", "b"], glob: [], rule: "a trailing slash on a positive" },
	{ patterns: ["!!packages/a"], npm: ["a"], glob: [], rule: "an even run of bangs" },
	{ patterns: ["packages\\a"], npm: ["a"], glob: [], rule: "a backslash as a separator" },
	{ patterns: ["packages/*", "!packages/a/"], npm: ["b"], glob: ["a", "b"], rule: "a trailing slash on a negation" },
];

type Manager = "npm" | "yarn" | "bun";

/** The root-level files that make `/repo` the given manager's root, beside `workspaces`. */
const rootFor = (manager: Manager, patterns: ReadonlyArray<string>): Tree => {
	switch (manager) {
		case "npm":
			return {
				"/repo/package.json": rootManifest(patterns),
				"/repo/package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
			};
		case "yarn":
			return {
				"/repo/package.json": rootManifest(patterns, { packageManager: "yarn@4.5.0" }),
				"/repo/yarn.lock": "",
			};
		case "bun":
			return {
				"/repo/package.json": rootManifest(patterns, { packageManager: "bun@1.2.0" }),
				"/repo/bun.lock": "{}",
			};
	}
};

const treeFor = (manager: Manager, patterns: ReadonlyArray<string>): Tree => ({
	...rootFor(manager, patterns),
	...MEMBERS,
});

/** The member names, root dropped, sorted. */
const membersOf = (names: ReadonlyArray<string>): ReadonlyArray<string> =>
	names.filter((name) => name !== "root").sort();

/** Discovery over a tree rooted at `/repo`. */
const discoveryOver = (tree: Tree) => {
	const base = platform(tree);
	const roots = WorkspaceRoot.layer.pipe(Layer.provide(base));
	return WorkspaceDiscovery.layer({ cwd: "/repo" }).pipe(Layer.provide(roots), Layer.provide(base));
};

/** `WorkspaceSnapshots` whose `HEAD` holds `tree`, read through a scripted `Git`. */
const snapshotsOver = (tree: Tree) => {
	const relative: Record<string, string> = {};
	for (const [path, content] of Object.entries(tree)) relative[path.slice("/repo/".length)] = content;
	const git = Git.layerTest({
		show: (_cwd: string, _ref: string, path: string) => {
			const content = relative[path.startsWith("./") ? path.slice(2) : path];
			return Effect.succeed(content === undefined ? Option.none() : Option.some(content));
		},
		lsTree: () =>
			Effect.succeed(
				Object.keys(relative).map((path) =>
					LsTreeEntry.make({ mode: "100644", type: "blob", oid: "0".repeat(40), path }),
				),
			),
	});
	const base = platform(tree);
	const core = Workspaces.layer({ cwd: "/repo" });
	return WorkspaceSnapshots.layer({ cwd: "/repo" }).pipe(
		Layer.provide(git),
		Layer.provide(ConfigDependencyHooks.layerNoop),
		Layer.provide(core),
		Layer.provide(base),
	);
};

const discovered = (tree: Tree) =>
	Effect.gen(function* () {
		const discovery = yield* WorkspaceDiscovery;
		return membersOf((yield* discovery.listPackages()).map((pkg) => pkg.name));
	}).pipe(Effect.provide(discoveryOver(tree)));

const synced = (tree: Tree): ReadonlyArray<string> =>
	membersOf(
		getWorkspacePackagesSync("/repo", {
			fileSystem: MemoryFileSystem.makeSync(tree).sync,
			path: nodePath.posix,
		}).map((pkg) => pkg.name),
	);

const snapshotted = (tree: Tree) =>
	Effect.gen(function* () {
		const snapshots = yield* WorkspaceSnapshots;
		return membersOf([...(yield* snapshots.at("HEAD")).versions.keys()]);
	}).pipe(Effect.provide(snapshotsOver(tree)));

for (const row of ROWS) {
	describe(`${JSON.stringify(row.patterns)} — ${row.rule}`, () => {
		it("discriminates: npm's answer is not GlobSet's", () => {
			assert.notDeepEqual(row.npm, row.glob);
		});

		it.effect("WorkspaceDiscovery on an npm root gives npm's answer", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* discovered(treeFor("npm", row.patterns)), row.npm);
			}),
		);

		it("getWorkspacePackagesSync on an npm root gives npm's answer", () => {
			assert.deepStrictEqual(synced(treeFor("npm", row.patterns)), row.npm);
		});

		it.effect("WorkspaceSnapshots.at on an npm root gives npm's answer", () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* snapshotted(treeFor("npm", row.patterns)), row.npm);
			}),
		);

		for (const manager of ["yarn", "bun"] as const) {
			it.effect(`control: a ${manager} root on the same patterns keeps GlobSet's answer, on all three readers`, () =>
				Effect.gen(function* () {
					const tree = treeFor(manager, row.patterns);
					assert.deepStrictEqual(yield* discovered(tree), row.glob);
					assert.deepStrictEqual(synced(tree), row.glob);
					assert.deepStrictEqual(yield* snapshotted(tree), row.glob);
				}),
			);
		}
	});
}

describe("an npm root's workspaces field past an NpmWorkspacePatterns ceiling", () => {
	// 33 wildcard patterns: one past the matcher's 32.
	const patterns = Array.from({ length: 33 }, (_, index) => `group-${index}/*`);
	const tree = treeFor("npm", patterns);

	it.effect("WorkspaceDiscovery fails typed, carrying npm's error, never a defect", () =>
		Effect.gen(function* () {
			const discovery = yield* WorkspaceDiscovery;
			const failure = yield* Effect.flip(discovery.listPackages());
			assert.instanceOf(failure, WorkspacePatternError);
			if (!(failure instanceof WorkspacePatternError)) return;
			assert.strictEqual(failure.kind, "uncompilable");
			assert.strictEqual(failure.pattern, "package.json#workspaces");
			assert.instanceOf(failure.cause, NpmWorkspacePatternsError);
			if (failure.cause instanceof NpmWorkspacePatternsError) {
				assert.strictEqual(failure.cause.reason, "tooManyWildcards");
				assert.strictEqual(failure.cause.limit, 32);
			}
		}).pipe(Effect.provide(discoveryOver(tree))),
	);

	it("getWorkspacePackagesSync throws the same typed error", () => {
		let thrown: unknown;
		try {
			synced(tree);
		} catch (error) {
			thrown = error;
		}
		assert.instanceOf(thrown, WorkspacePatternError);
		if (thrown instanceof WorkspacePatternError) assert.instanceOf(thrown.cause, NpmWorkspacePatternsError);
	});

	it.effect("WorkspaceSnapshots.at fails typed as a catalog-assembly error with npm's cause", () =>
		Effect.gen(function* () {
			const snapshots = yield* WorkspaceSnapshots;
			const failure = yield* Effect.flip(snapshots.at("HEAD"));
			assert.instanceOf(failure, CatalogAssemblyError);
			if (failure instanceof CatalogAssemblyError) assert.instanceOf(failure.cause, NpmWorkspacePatternsError);
		}).pipe(Effect.provide(snapshotsOver(tree))),
	);

	it.effect("control: a bun root on the same 33 patterns reads them as a GlobSet", () =>
		Effect.gen(function* () {
			const discovery = yield* WorkspaceDiscovery;
			// GlobSet has no wildcard ceiling at 33, so it gets as far as enumerating —
			// and the first absent base directory is the failure, not npm's ceiling.
			const failure = yield* Effect.flip(discovery.listPackages());
			assert.instanceOf(failure, WorkspacePatternError);
			if (failure instanceof WorkspacePatternError) assert.strictEqual(failure.kind, "missingBaseDir");
		}).pipe(Effect.provide(discoveryOver(treeFor("bun", patterns)))),
	);
});

describe("a GlobSet compile failure still carries glob's error as its cause", () => {
	it.effect("on a yarn root, an over-long pattern fails uncompilable with a GlobPatternError cause", () =>
		Effect.gen(function* () {
			const discovery = yield* WorkspaceDiscovery;
			const failure = yield* Effect.flip(discovery.listPackages());
			assert.instanceOf(failure, WorkspacePatternError);
			if (failure instanceof WorkspacePatternError) {
				assert.strictEqual(failure.kind, "uncompilable");
				assert.instanceOf(failure.cause, GlobPatternError);
			}
		}).pipe(Effect.provide(discoveryOver(treeFor("yarn", [`packages/${"*".repeat(70_000)}`])))),
	);
});
