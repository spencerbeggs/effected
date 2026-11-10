import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getReleasePlan } from "@changesets/get-release-plan";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";
import { assert, describe, it } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Cause, Effect, Exit, Layer } from "effect";
import { ChangesetConfig } from "../src/ChangesetConfig.js";
import { ReleasePlan } from "../src/ReleasePlan.js";

interface Projected {
	readonly name: string;
	readonly type: string;
	readonly oldVersion: string | undefined;
	readonly newVersion: string | undefined;
	readonly changesets: ReadonlyArray<string>;
}

const fixture = (name: string): string => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

const project = (releases: ReadonlyArray<Projected>): ReadonlyArray<Projected> =>
	releases
		.map(({ name, type, oldVersion, newVersion, changesets }) => ({
			name,
			type,
			oldVersion,
			newVersion,
			changesets: [...changesets].sort(),
		}))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

/** The plan's own changeset list, by id: ours and the oracle's both carry one. */
const planIds = (changesets: ReadonlyArray<{ readonly id: string }>) => changesets.map((c) => c.id).sort();

// The oracle reports a range it draws no edge for through console.error.
const oracle = (root: string) =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const original = console.error;
			console.error = () => {};
			return original;
		}),
		() => Effect.promise(() => getReleasePlan(root)),
		(original) =>
			Effect.sync(() => {
				console.error = original;
			}),
	);

const discovery = (cwd: string) =>
	WorkspaceDiscovery.layer({ cwd }).pipe(
		Layer.provide(WorkspaceRoot.layer),
		Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
	);

const ours = (root: string) => ReleasePlan.read(root).pipe(Effect.provide(discovery(root)));

/**
 * Each case's expected `name -> type` pins what the fixture exists to exercise,
 * so a fixture that stopped reaching its rule fails here rather than agreeing
 * with the planner about nothing.
 */
const cases: Record<string, Record<string, string>> = {
	"single-patch": { a: "patch" },
	"minor-ripple-0x": { a: "minor", b: "patch" },
	"minor-no-ripple-1x": { a: "minor" },
	"workspace-star-pin": { a: "patch", b: "patch" },
	"dev-dependent-none": { a: "patch", b: "none" },
	"ignored-package": { b: "patch" },
	"private-no-version": { b: "patch" },
	"two-changesets-max": { a: "minor" },
	"private-default": { b: "patch" },
	"private-partial-object": {},
	"private-boolean": { a: "minor" },
	"update-internal-minor": { a: "major", b: "patch" },
	"ignored-glob": { "@x/keep": "patch", "@y/b": "patch" },
	"ignored-dependent-none": { a: "patch", b: "none", c: "none" },
	"specifier-forms": {
		a: "minor",
		"tilde-range": "patch",
		"workspace-dot-path": "patch",
		"workspace-path": "patch",
		"workspace-tight": "patch",
	},
	kinds: {
		a: "minor",
		"dep-and-dev": "patch",
		"dep-with-dev-file": "patch",
		"dev-held-dep-missed": "patch",
		onward: "patch",
		optional: "patch",
		peer: "patch",
	},
	"reader-skips": { a: "patch" },
	"workspace-protocol-only": { a: "minor", protocol: "patch" },
	"update-always": { a: "patch", b: "patch" },
	"none-no-ripple-missed-range": { a: "patch", b: "none" },
	"none-no-ripple-caret": { a: "patch", b: "none" },
	"none-no-ripple-always": { a: "patch", b: "none" },
	"explicit-none": { a: "patch", b: "none" },
	"explicit-none-loses-to-bump": { b: "minor" },
	"explicit-none-rippled": { a: "patch", b: "patch" },
	"prerelease-versions": {
		"major-pre": "major",
		"minor-pre": "minor",
		"minor-pre-patched": "minor",
		"patch-pre": "patch",
	},
	"fixed-group": { a: "minor", b: "minor", c: "minor", d: "patch" },
	"fixed-glob": { "@x/a": "patch", "@x/b": "patch" },
	"fixed-ripple": { a: "patch", b: "patch", c: "minor", e: "patch" },
	"fixed-skipped-member": { a: "patch" },
	"linked-group": { a: "minor", b: "minor" },
	"linked-ripple": { a: "minor", b: "minor" },
	"linked-none": { a: "minor", b: "none" },
	"pre-mode": { a: "patch", b: "minor", c: "patch" },
	"pre-exit": { a: "patch", b: "minor" },
	"pre-groups": { a: "patch", b: "patch", c: "minor" },
};

describe("ReleasePlan against @changesets/get-release-plan", () => {
	for (const [name, expected] of Object.entries(cases)) {
		it.effect(name, () =>
			Effect.gen(function* () {
				const root = fixture(name);
				const theirPlan = yield* oracle(root);
				const myPlan = yield* ours(root);
				const theirs = project(theirPlan.releases);
				const mine = project(myPlan.releases);
				assert.deepStrictEqual(Object.fromEntries(theirs.map((r) => [r.name, r.type])), expected);
				assert.deepStrictEqual(mine, theirs);
				assert.deepStrictEqual(planIds(myPlan.changesets), planIds(theirPlan.changesets));
				assert.deepStrictEqual(myPlan.preState?.mode, theirPlan.preState?.mode);
				assert.deepStrictEqual(myPlan.preState?.tag, theirPlan.preState?.tag);
			}),
		);
	}

	it.effect("leaves out the version-less package the oracle lists with no versions", () =>
		Effect.gen(function* () {
			const root = fixture("version-less");
			const theirs = project((yield* oracle(root)).releases);
			assert.deepStrictEqual(
				theirs.find((r) => r.name === "app"),
				{ name: "app", type: "none", oldVersion: undefined, newVersion: undefined, changesets: [] },
			);
			const mine = project((yield* ours(root)).releases);
			assert.deepStrictEqual(
				mine,
				theirs.filter((r) => r.oldVersion !== undefined),
			);
		}),
	);

	it.effect("rejects a changeset naming a package outside the workspace, as the oracle does", () =>
		Effect.gen(function* () {
			const root = fixture("unknown-package");
			const theirs = yield* Effect.exit(oracle(root));
			assert.isTrue(Exit.isFailure(theirs) && Cause.pretty(theirs.cause).includes("not in the workspace"));
			const mine = yield* Effect.flip(ours(root));
			assert.strictEqual(mine._tag, "UnknownPackageError");
		}),
	);

	// Outside any enclosing workspace: inside this repository the oracle climbs past
	// a root with no package patterns and answers about this repository instead.
	for (const [label, keepWorkspaceFile] of [
		["a catalog-only workspace file", true],
		["no workspace file", false],
	] as const) {
		it.effect(`plans the root as the only package with ${label}`, () =>
			Effect.acquireUseRelease(
				Effect.sync(() => {
					const root = mkdtempSync(join(tmpdir(), "release-plan-"));
					cpSync(fixture("single-package"), root, { recursive: true });
					if (!keepWorkspaceFile) rmSync(join(root, "pnpm-workspace.yaml"));
					return root;
				}),
				(root) =>
					Effect.gen(function* () {
						const theirs = project((yield* oracle(root)).releases);
						assert.deepStrictEqual(
							theirs.map((r) => [r.name, r.type]),
							[["solo", "minor"]],
						);
						assert.deepStrictEqual(project((yield* ours(root)).releases), theirs);
					}),
				(root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
			),
		);
	}

	it.effect("reports no workspace root for a directory with no package.json", () =>
		Effect.acquireUseRelease(
			Effect.sync(() => mkdtempSync(join(tmpdir(), "release-plan-"))),
			(root) =>
				Effect.gen(function* () {
					const error = yield* Effect.flip(ours(root));
					assert.strictEqual(error._tag, "WorkspaceRootNotFoundError");
				}),
			(root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
		),
	);

	it.effect("rejects a package in two fixed groups, as the oracle does", () =>
		Effect.gen(function* () {
			const root = fixture("fixed-duplicate");
			const theirs = yield* Effect.exit(oracle(root));
			assert.isTrue(Exit.isFailure(theirs) && Cause.pretty(theirs.cause).includes("multiple groups of fixed packages"));
			const mine = yield* Effect.flip(ours(root));
			assert.strictEqual(mine._tag, "ChangesetConfigError");
			assert.include(mine.message, "b is in more than one fixed group");
		}),
	);

	// The older pre.json layout lists consumed changesets by id. The oracle moves
	// them into .changeset/pre/ as it reads the file, after it has already read
	// the changesets, so only its second run answers for the layout it wrote.
	for (const [mode, firstNames, settledReleases] of [
		["pre", ["a", "b"], [["b", "patch", ["fresh"]]]],
		[
			"exit",
			["a", "b"],
			[
				["a", "major", ["pre/consumed"]],
				["b", "patch", ["fresh"]],
			],
		],
	] as const) {
		it.effect(`plans an older-layout pre.json in ${mode} mode as the oracle settles on, writing nothing`, () =>
			Effect.acquireUseRelease(
				Effect.sync(() => {
					const root = mkdtempSync(join(tmpdir(), "release-plan-"));
					cpSync(fixture("pre-legacy-layout"), root, { recursive: true });
					const preJson = join(root, ".changeset", "pre.json");
					writeFileSync(preJson, readFileSync(preJson, "utf8").replace('"mode": "pre"', `"mode": "${mode}"`));
					return root;
				}),
				(root) =>
					Effect.gen(function* () {
						const before = readFileSync(join(root, ".changeset", "pre.json"), "utf8");
						assert.include(before, `"mode": "${mode}"`);
						const myPlan = yield* ours(root);
						assert.strictEqual(readFileSync(join(root, ".changeset", "pre.json"), "utf8"), before);
						const first = project((yield* oracle(root)).releases);
						const settledPlan = yield* oracle(root);
						const settled = project(settledPlan.releases);
						assert.deepStrictEqual(
							first.map((r) => r.name),
							[...firstNames],
						);
						assert.deepStrictEqual(
							settled.map((r) => [r.name, r.type, r.changesets]),
							settledReleases.map(([name, type, files]) => [name, type, [...files]]),
						);
						assert.deepStrictEqual(project(myPlan.releases), settled);
						assert.deepStrictEqual(planIds(myPlan.changesets), planIds(settledPlan.changesets));
						assert.deepStrictEqual(project((yield* ours(root)).releases), settled);
					}),
				(root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
			),
		);
	}

	// A pre.json the oracle reads as pre mode but is malformed: it appends
	// `-undefined.0` for a missing tag and treats any mode but `exit` as `pre`.
	// Both are defects there, and here a typed failure.
	for (const [label, preJson, oracleVersion] of [
		["no tag", '{"mode":"pre"}', "1.0.1-undefined.0"],
		["an unknown mode", '{"mode":"enter","tag":"next"}', "1.0.1-next.0"],
	] as const) {
		it.effect(`fails typed on a pre.json with ${label}, where the oracle plans it`, () =>
			Effect.acquireUseRelease(
				Effect.sync(() => {
					const root = mkdtempSync(join(tmpdir(), "release-plan-"));
					cpSync(fixture("pre-mode"), root, { recursive: true });
					writeFileSync(join(root, ".changeset", "pre.json"), preJson);
					return root;
				}),
				(root) =>
					Effect.gen(function* () {
						const theirs = project((yield* oracle(root)).releases);
						assert.strictEqual(theirs.find((r) => r.name === "a")?.newVersion, oracleVersion);
						const mine = yield* Effect.flip(ours(root));
						assert.strictEqual(mine._tag, "ChangesetConfigError");
					}),
				(root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
			),
		);
	}

	it.effect("normalises a v-prefixed version as the oracle does, and fails typed on an =-prefixed one", () =>
		Effect.gen(function* () {
			for (const name of ["loose-v-pre", "loose-v-groups"]) {
				const theirs = project((yield* oracle(fixture(name))).releases);
				assert.isTrue(
					theirs.some((r) => r.oldVersion?.startsWith("v") === true),
					name,
				);
				assert.deepStrictEqual(project((yield* ours(fixture(name))).releases), theirs, name);
			}
			// The oracle crashes on `=1.2.0` in pre mode and in a releasing group,
			// and plans a bump of one with no new version at all.
			for (const name of ["loose-eq-pre", "loose-eq-group"]) {
				const theirs = yield* Effect.exit(oracle(fixture(name)));
				assert.isTrue(Exit.isFailure(theirs), name);
			}
			const bumped = project((yield* oracle(fixture("loose-eq-bump"))).releases);
			assert.deepStrictEqual(
				bumped.find((r) => r.name === "a"),
				{ name: "a", type: "minor", oldVersion: "=1.2.0", newVersion: null as unknown as string, changesets: ["one"] },
			);
			for (const name of ["loose-eq-pre", "loose-eq-group", "loose-eq-bump"]) {
				const mine = yield* Effect.flip(ours(fixture(name)));
				assert.isTrue(mine._tag === "InvalidVersionError" && mine.input === "=1.2.0", name);
			}
		}),
	);

	it.effect("keeps the root out when other packages exist", () =>
		Effect.gen(function* () {
			const mine = yield* ours(fixture("minor-ripple-0x"));
			assert.isFalse(mine.releases.some((r) => r.name === "minor-ripple-0x-root"));
			const unknown = yield* Effect.flip(ours(fixture("root-named-with-members")));
			assert.strictEqual(unknown._tag, "UnknownPackageError");
			const theirs = yield* Effect.exit(oracle(fixture("root-named-with-members")));
			assert.isTrue(Exit.isFailure(theirs) && Cause.pretty(theirs.cause).includes("not in the workspace"));
		}),
	);

	it.effect("plans the workspace at root, not the one the layer was built from", () =>
		Effect.gen(function* () {
			const root = fixture("single-patch");
			const mine = yield* ReleasePlan.read(root).pipe(Effect.provide(discovery(fixture("two-changesets-max"))));
			assert.deepStrictEqual(project(mine.releases), project((yield* oracle(root)).releases));
		}),
	);

	it.effect("the comparison can fail: a mutated newVersion does not pass", () =>
		Effect.gen(function* () {
			const root = fixture("minor-ripple-0x");
			const theirs = project((yield* oracle(root)).releases);
			const mine = project((yield* ours(root)).releases);
			assert.deepStrictEqual(mine, theirs);
			const mutated = theirs.map((r, index) => (index === 0 ? { ...r, newVersion: "9.9.9" } : r));
			assert.throws(() => assert.deepStrictEqual(mine, mutated));
		}),
	);
});

describe("ReleasePlan.read from inside the workspace", () => {
	// The oracle's `@manypkg/find-root` climbs from the directory it is given.
	for (const [name, subdirectory] of [
		["minor-ripple-0x", "packages/a"],
		["pre-mode", "packages/b"],
		["fixed-group", "packages"],
	] as const) {
		it.effect(`${name}: planned from ${subdirectory} as the oracle plans it, and as from the root`, () =>
			Effect.gen(function* () {
				const root = fixture(name);
				const from = join(root, subdirectory);
				const theirs = yield* oracle(from);
				assert.isAbove(theirs.releases.length, 0, "the oracle should plan from the subdirectory");
				const mine = yield* ReleasePlan.read(from).pipe(Effect.provide(discovery(from)));
				assert.deepStrictEqual(project(mine.releases), project(theirs.releases));
				assert.deepStrictEqual(planIds(mine.changesets), planIds(theirs.changesets));
				assert.deepStrictEqual(project(mine.releases), project((yield* ours(root)).releases));
			}),
		);
	}

	it.effect("a repository with no workspace file is planned from a directory below its package.json", () =>
		Effect.acquireUseRelease(
			Effect.sync(() => {
				const root = mkdtempSync(join(tmpdir(), "release-plan-"));
				cpSync(fixture("single-package"), root, { recursive: true });
				rmSync(join(root, "pnpm-workspace.yaml"));
				mkdirSync(join(root, "src", "deep"), { recursive: true });
				return root;
			}),
			(root) =>
				Effect.gen(function* () {
					const from = join(root, "src", "deep");
					const theirs = project((yield* oracle(from)).releases);
					assert.deepStrictEqual(
						theirs.map((r) => [r.name, r.type]),
						[["solo", "minor"]],
					);
					const context = yield* ReleasePlan.readWithContext(from).pipe(Effect.provide(discovery(from)));
					assert.deepStrictEqual(project(context.plan.releases), theirs);
					assert.strictEqual(context.root, root);
				}),
			(root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
		),
	);
});

describe("ReleasePlan.readWithContext", () => {
	it.effect("returns the plan read gives, with every package discovery lists and the config", () =>
		Effect.gen(function* () {
			const root = fixture("minor-ripple-0x");
			const context = yield* ReleasePlan.readWithContext(join(root, "packages", "b")).pipe(
				Effect.provide(discovery(root)),
			);
			assert.strictEqual(context.root, root);
			assert.deepStrictEqual(context.plan, yield* ours(root));
			const listed = yield* Effect.gen(function* () {
				return yield* (yield* WorkspaceDiscovery).listPackagesIn(root);
			}).pipe(Effect.provide(discovery(root)));
			assert.deepStrictEqual(context.packages, listed);
			assert.isTrue(context.packages.some((pkg) => pkg.isRootWorkspace));
			assert.deepStrictEqual(context.config, yield* ChangesetConfig.read(root).pipe(Effect.provide(discovery(root))));
		}),
	);

	it.effect("hands edits the root a lone package plans", () =>
		Effect.acquireUseRelease(
			Effect.sync(() => {
				const root = mkdtempSync(join(tmpdir(), "release-plan-"));
				cpSync(fixture("single-package"), root, { recursive: true });
				rmSync(join(root, "pnpm-workspace.yaml"));
				return root;
			}),
			(root) =>
				Effect.gen(function* () {
					const { plan, packages, config } = yield* ReleasePlan.readWithContext(root).pipe(
						Effect.provide(discovery(root)),
					);
					assert.deepStrictEqual(
						packages.map((pkg) => [pkg.name, pkg.relativePath]),
						[["solo", "."]],
					);
					assert.strictEqual(packages[0]?.manifestRecord.name, "solo");
					const edits = yield* Effect.fromResult(ReleasePlan.edits(plan, { packages, config }));
					assert.deepStrictEqual(
						edits.manifests.map((edit) => [edit.name, edit.version]),
						[["solo", plan.releases[0]?.newVersion]],
					);
				}),
			(root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
		),
	);
});
