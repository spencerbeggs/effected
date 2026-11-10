import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { applyReleasePlan } from "@changesets/apply-release-plan";
import { assembleReleasePlan } from "@changesets/assemble-release-plan";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it, vi } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer, Result, Schema } from "effect";
import { ChangesetConfig } from "../src/ChangesetConfig.js";
import { PreState } from "../src/PreState.js";
import type { ReleaseEdits } from "../src/ReleaseEdits.js";
import type { ReleaseSnapshot } from "../src/ReleasePlan.js";
import { PlannedRelease, ReleasePlan } from "../src/ReleasePlan.js";
import type { Any } from "./support/oracle.js";
import { sibling } from "./support/oracle.js";

/**
 * `@changesets/apply-release-plan` run for real on a temporary copy of each
 * fixture, against {@link ReleasePlan.edits} applied by hand to the files as
 * they were. The copy's config has `changelog: false`, so the oracle loads no
 * changelog module and reads no git history: CHANGELOG output is
 * `Changelog`'s test, and only manifests, changeset files and `pre.json` are
 * compared here.
 */
const fixture = (name: string): string => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

const NOW = new Date("2026-11-09T12:34:56.789Z");

interface Snapshot {
	readonly tag?: string;
}

/** Every file under `root` other than `node_modules`, relative, with its text. */
const tree = (root: string): Record<string, string> => {
	const files: Record<string, string> = {};
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (entry.name === "node_modules") continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else files[relative(root, path)] = readFileSync(path, "utf8");
		}
	};
	walk(root);
	return files;
};

/** The oracle's `changeset version`: its own reads, its planner, then `applyReleasePlan`. */
const runOracle = (root: string, snapshot: Snapshot | undefined, tweak: (plan: Any) => Any = (plan) => plan) =>
	Effect.promise(async () => {
		const { readConfig } = await sibling<Any>("@changesets/config");
		const { readPreState } = await sibling<Any>("@changesets/pre");
		const { readChangesets } = await sibling<Any>("@changesets/read");
		const { getPackages } = await sibling<Any>("@manypkg/get-packages");
		const original = console.error;
		console.error = () => {};
		vi.useFakeTimers({ toFake: ["Date"], now: NOW });
		try {
			const packages = await getPackages(root);
			const { config, errors } = await readConfig(packages.rootDir, packages);
			if (config === undefined) throw new Error(errors.join("\n"));
			const changesets = await readChangesets(packages.rootDir);
			const preState = await readPreState(packages.rootDir);
			const plan = tweak(assembleReleasePlan(changesets, packages, config, preState, snapshot));
			// `changeset version --snapshot <tag>` passes the tag, a bare one `true`.
			await applyReleasePlan(plan, packages, config, snapshot === undefined ? undefined : (snapshot.tag ?? true));
		} finally {
			vi.useRealTimers();
			console.error = original;
		}
	});

const discovery = (cwd: string) =>
	WorkspaceDiscovery.layer({ cwd }).pipe(
		Layer.provide(WorkspaceRoot.layer),
		Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
	);

const runOurs = (root: string, snapshot: Snapshot | undefined) =>
	Effect.gen(function* () {
		const options: { snapshot?: ReleaseSnapshot } =
			snapshot === undefined ? {} : { snapshot: { ...snapshot, timestamp: NOW } };
		const plan = yield* ReleasePlan.read(root, options);
		const packages = yield* (yield* WorkspaceDiscovery).listPackagesIn(root);
		const config = yield* ChangesetConfig.read(root);
		return yield* Effect.fromResult(ReleasePlan.edits(plan, { packages, config }));
	}).pipe(Effect.provide(discovery(root)));

/** The tree `edits` describe, applied to `before`: what the oracle should leave. */
const applied = (root: string, before: Record<string, string>, edits: ReleaseEdits): Record<string, unknown> => {
	const after: Record<string, unknown> = {};
	for (const [file, text] of Object.entries(before)) after[file] = file.endsWith(".json") ? JSON.parse(text) : text;
	for (const manifest of edits.manifests) {
		const json = after[relative(root, manifest.packageJsonPath)] as Record<string, Record<string, string> | string>;
		if (manifest.version !== undefined) json.version = manifest.version;
		for (const edit of manifest.ranges) (json[edit.kind] as Record<string, string>)[edit.dependency] = edit.to;
	}
	for (const file of edits.deleteChangesets) delete after[join(".changeset", file)];
	for (const { from, to } of edits.moveChangesets) {
		after[join(".changeset", to)] = after[join(".changeset", from)];
		delete after[join(".changeset", from)];
	}
	const preJson = join(".changeset", "pre.json");
	if (edits.preState === undefined) delete after[preJson];
	else after[preJson] = Schema.encodeSync(PreState)(edits.preState);
	return after;
};

const parsed = (files: Record<string, string>): Record<string, unknown> =>
	Object.fromEntries(
		Object.entries(files).map(([file, text]) => [file, file.endsWith(".json") ? JSON.parse(text) : text]),
	);

/** A temporary copy of a fixture, its config switched to `changelog: false`. */
const withCopy = <A, E, R>(name: string, use: (root: string) => Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const root = mkdtempSync(join(tmpdir(), "release-edits-"));
			cpSync(fixture(name), root, { recursive: true });
			const configPath = join(root, ".changeset", "config.json");
			const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;
			writeFileSync(configPath, `${JSON.stringify({ ...config, changelog: false }, null, 2)}\n`);
			return root;
		}),
		use,
		(root) => Effect.sync(() => rmSync(root, { recursive: true, force: true })),
	);

/** Our edits, then the oracle on the same copy; returns both trees and the edits. */
const compare = (name: string, snapshot?: Snapshot) =>
	withCopy(name, (root) =>
		Effect.gen(function* () {
			const before = tree(root);
			const edits = yield* runOurs(root, snapshot);
			yield* runOracle(root, snapshot);
			const theirs = parsed(tree(root));
			return { before: parsed(before), theirs, mine: applied(root, before, edits), edits, root };
		}),
	);

const planFixtures = [
	"single-patch",
	"minor-ripple-0x",
	"minor-no-ripple-1x",
	"workspace-star-pin",
	"dev-dependent-none",
	"ignored-package",
	"private-no-version",
	"two-changesets-max",
	"private-default",
	"private-boolean",
	"update-internal-minor",
	"ignored-glob",
	"ignored-dependent-none",
	"specifier-forms",
	"kinds",
	"reader-skips",
	"workspace-protocol-only",
	"update-always",
	"none-no-ripple-missed-range",
	"none-no-ripple-caret",
	"none-no-ripple-always",
	"explicit-none",
	"explicit-none-loses-to-bump",
	"explicit-none-rippled",
	"prerelease-versions",
	"fixed-group",
	"fixed-glob",
	"fixed-ripple",
	"fixed-skipped-member",
	"linked-group",
	"linked-ripple",
	"linked-none",
	"pre-mode",
	"pre-exit",
	"pre-groups",
	"range-edits",
	"range-edits-gated",
	"range-edits-peer",
	"range-edits-peer-held",
	"range-edits-protocol-only",
];

describe("ReleaseEdits against @changesets/apply-release-plan", () => {
	for (const name of planFixtures) {
		it.effect(name, () =>
			Effect.gen(function* () {
				const { theirs, mine, before } = yield* compare(name);
				assert.deepStrictEqual(mine, theirs);
				assert.notDeepEqual(theirs, before, "the release should change something");
			}),
		);
	}

	for (const [name, snapshot] of [
		["minor-ripple-0x", { tag: "canary" }],
		["range-edits", { tag: "canary" }],
		["range-edits", {}],
		["pre-exit", { tag: "canary" }],
	] as const) {
		it.effect(`${name} as a snapshot ${JSON.stringify(snapshot)}`, () =>
			Effect.gen(function* () {
				const { theirs, mine } = yield* compare(name, snapshot);
				assert.deepStrictEqual(mine, theirs);
			}),
		);
	}

	it.effect("range-edits: the rewritten ranges, as the oracle wrote them", () =>
		Effect.gen(function* () {
			const { edits, theirs } = yield* compare("range-edits");
			const ranges = Object.fromEntries(
				edits.manifests.flatMap((m) => m.ranges.map((r) => [`${m.name} ${r.kind}`, r.to] as const)),
			);
			// Copied from the oracle's written manifests; the comparison above holds them to it.
			assert.deepStrictEqual(ranges, {
				"caret dependencies": "^1.3.0",
				"tilde dependencies": "~1.3.0",
				"gte-lt dependencies": ">=1.3.0 <2.0.0",
				"lt-gte dependencies": "<2.0.0 >=1.3.0",
				"tight dependencies": ">=1.3.0 <1.4.0",
				"tight-reversed dependencies": "<1.4.0 >=1.3.0",
				"xrange dependencies": "1.3.0",
				"union dependencies": "^1.3.0",
				"exact dependencies": "1.3.0",
				"hyphen dependencies": "1.3.0",
				"gt dependencies": ">1.3.0",
				"v-range dependencies": "^1.3.0",
				"ws-range dependencies": "workspace:^1.3.0",
				"peer peerDependencies": "^1.3.0",
				"dev devDependencies": "^1.3.0",
				"optional optionalDependencies": "^1.3.0",
				"multi dependencies": "^1.3.0",
				"multi devDependencies": "~1.3.0",
				"multi peerDependencies": ">=1.3.0",
				"lte dependencies": "<=1.3.0",
				"range-edits-root dependencies": "^1.3.0",
				"range-edits-root devDependencies": "workspace:^1.3.0",
			});
			assert.strictEqual(
				(theirs["packages/held/package.json"] as { dependencies: Record<string, string> }).dependencies.a,
				"^1.0.0",
			);
		}),
	);

	// Each value is the range the oracle wrote, copied from its run; the
	// whole-tree comparison above holds ours to the same run.
	for (const [name, expected] of [
		// A minor minimum holds a patch's in-range dependency, but not an
		// in-range peer while onlyUpdatePeerDependentsWhenOutOfRange is off.
		["range-edits-peer", { "held dependencies": "^1.0.0", "peer peerDependencies": "^1.2.1" }],
		// With the peer option on, an in-range peer is held even at the minimum.
		["range-edits-peer-held", { "plain dependencies": "^1.2.1", "peer peerDependencies": "^1.0.0" }],
		// bumpVersionsWithWorkspaceProtocolOnly leaves a plain range alone.
		["range-edits-protocol-only", { "plain dependencies": "^1.0.0", "protocol dependencies": "workspace:^1.3.0" }],
	] as const) {
		it.effect(`${name}: the ranges the oracle wrote`, () =>
			Effect.gen(function* () {
				const { theirs, mine } = yield* compare(name);
				const written = (tree: Record<string, unknown>) =>
					Object.fromEntries(
						Object.keys(expected).map((key) => {
							const [pkg, kind] = key.split(" ") as [string, string];
							const json = tree[`packages/${pkg}/package.json`] as Record<string, Record<string, string>>;
							return [key, json[kind]?.a];
						}),
					);
				assert.deepStrictEqual(written(theirs), expected);
				assert.deepStrictEqual(written(mine), expected);
			}),
		);
	}

	it.effect("a snapshot pins every rewritten range to the exact snapshot version", () =>
		Effect.gen(function* () {
			const { edits } = yield* compare("range-edits", { tag: "canary" });
			const caret = edits.manifests.find((m) => m.name === "caret");
			assert.deepStrictEqual(
				caret?.ranges.map((r) => r.to),
				["0.0.0-canary-20261109123456"],
			);
			// `*` takes a prerelease, so a snapshot rewrites it too.
			const star = edits.manifests.find((m) => m.name === "star");
			assert.deepStrictEqual(
				star?.ranges.map((r) => r.to),
				["0.0.0-canary-20261109123456"],
			);
		}),
	);

	it.effect("pre mode moves the consumed changesets and leaves pre.json as it is", () =>
		Effect.gen(function* () {
			const { edits, theirs, before } = yield* compare("pre-mode");
			assert.isAbove(edits.moveChangesets.length, 0);
			assert.deepStrictEqual(edits.deleteChangesets, []);
			assert.deepStrictEqual(theirs[".changeset/pre.json"], before[".changeset/pre.json"]);
			for (const { to } of edits.moveChangesets) assert.isDefined(theirs[join(".changeset", to)]);
		}),
	);

	it.effect("exit mode deletes pre.json, and a snapshot in exit mode keeps it", () =>
		Effect.gen(function* () {
			const exit = yield* compare("pre-exit");
			assert.isUndefined(exit.edits.preState);
			assert.isUndefined(exit.theirs[".changeset/pre.json"]);
			assert.isTrue(exit.edits.deleteChangesets.some((file) => file.startsWith("pre/")));
			const snapshot = yield* compare("pre-exit", { tag: "canary" });
			assert.isDefined(snapshot.edits.preState);
			assert.isDefined(snapshot.theirs[".changeset/pre.json"]);
		}),
	);

	it.effect("a changeset naming only a skipped package is left in place", () =>
		Effect.gen(function* () {
			const { edits, theirs, before } = yield* compare("ignored-package");
			const kept = Object.keys(before).filter((f) => f.startsWith(".changeset/") && f.endsWith(".md"));
			const remaining = kept.filter((f) => theirs[f] !== undefined);
			assert.isAbove(remaining.length, 0);
			for (const file of remaining) assert.notInclude(edits.deleteChangesets, file.replace(".changeset/", ""));
		}),
	);

	it.effect("the comparison can fail: a dropped range edit does not match the oracle", () =>
		Effect.gen(function* () {
			const result = yield* withCopy("range-edits", (root) =>
				Effect.gen(function* () {
					const before = tree(root);
					const edits = yield* runOurs(root, undefined);
					const tampered = {
						...edits,
						manifests: edits.manifests.map((m) => (m.name === "caret" ? { ...m, ranges: [] } : m)),
					} as unknown as ReleaseEdits;
					yield* runOracle(root, undefined);
					return { mine: applied(root, before, tampered), theirs: parsed(tree(root)) };
				}),
			);
			assert.notDeepEqual(result.mine, result.theirs);
		}),
	);

	// No plan assemble makes has a `none` entry whose version moves, so both
	// sides are handed one: the oracle writes a `none` entry's newVersion too.
	it.effect("a none entry's newVersion is written when it differs from the manifest, as the oracle writes it", () =>
		Effect.gen(function* () {
			const result = yield* withCopy("dev-dependent-none", (root) =>
				Effect.gen(function* () {
					const before = tree(root);
					const { plan, packages, config } = yield* Effect.gen(function* () {
						return {
							plan: yield* ReleasePlan.read(root),
							packages: yield* (yield* WorkspaceDiscovery).listPackagesIn(root),
							config: yield* ChangesetConfig.read(root),
						};
					}).pipe(Effect.provide(discovery(root)));
					assert.strictEqual(plan.releases.find((r) => r.name === "b")?.type, "none");
					const crafted = ReleasePlan.make({
						...plan,
						releases: plan.releases.map((r) =>
							r.name === "b" ? PlannedRelease.make({ ...r, newVersion: "1.0.0-crafted" }) : r,
						),
					});
					const edits = yield* Effect.fromResult(ReleasePlan.edits(crafted, { packages, config }));
					yield* runOracle(root, undefined, (theirs) => ({
						...theirs,
						releases: theirs.releases.map((r: Any) => (r.name === "b" ? { ...r, newVersion: "1.0.0-crafted" } : r)),
					}));
					return { mine: applied(root, before, edits), theirs: parsed(tree(root)) };
				}),
			);
			assert.strictEqual((result.theirs["packages/b/package.json"] as { version: string }).version, "1.0.0-crafted");
			assert.deepStrictEqual(result.mine, result.theirs);
		}),
	);

	it("fails MissingPackageError when the plan releases a package not given", () => {
		const plan = ReleasePlan.make({
			releases: [
				PlannedRelease.make({ name: "ghost", type: "patch", oldVersion: "1.0.0", newVersion: "1.0.1", changesets: [] }),
			],
			changesets: [],
		});
		const result = ReleasePlan.edits(plan, {
			packages: [],
			config: Schema.decodeUnknownSync(ChangesetConfig)({}),
		});
		assert.isTrue(Result.isFailure(result) && result.failure._tag === "MissingPackageError");
	});
});
