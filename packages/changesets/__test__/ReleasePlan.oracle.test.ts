import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getReleasePlan } from "@changesets/get-release-plan";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Cause, Effect, Exit, Layer } from "effect";
import { ReleasePlan } from "../src/ReleasePlan.js";

interface Projected {
	readonly name: string;
	readonly type: string;
	readonly oldVersion: string | undefined;
	readonly newVersion: string | undefined;
}

const fixture = (name: string): string => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

const project = (releases: ReadonlyArray<Projected>): ReadonlyArray<Projected> =>
	releases
		.map(({ name, type, oldVersion, newVersion }) => ({ name, type, oldVersion, newVersion }))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

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
};

describe("ReleasePlan against @changesets/get-release-plan", () => {
	for (const [name, expected] of Object.entries(cases)) {
		it.effect(name, () =>
			Effect.gen(function* () {
				const root = fixture(name);
				const theirs = project((yield* oracle(root)).releases);
				const mine = project((yield* ours(root)).releases);
				assert.deepStrictEqual(Object.fromEntries(theirs.map((r) => [r.name, r.type])), expected);
				assert.deepStrictEqual(mine, theirs);
			}),
		);
	}

	it.effect("leaves out the version-less package the oracle lists with no versions", () =>
		Effect.gen(function* () {
			const root = fixture("version-less");
			const theirs = project((yield* oracle(root)).releases);
			assert.deepStrictEqual(
				theirs.find((r) => r.name === "app"),
				{ name: "app", type: "none", oldVersion: undefined, newVersion: undefined },
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
