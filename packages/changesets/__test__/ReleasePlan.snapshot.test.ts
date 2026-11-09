import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assembleReleasePlan } from "@changesets/assemble-release-plan";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it, vi } from "@effect/vitest";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer } from "effect";
import type { ReleaseSnapshot } from "../src/ReleasePlan.js";
import { ReleasePlan } from "../src/ReleasePlan.js";

/**
 * The snapshot oracle is `@changesets/assemble-release-plan`'s fifth argument,
 * which `@changesets/get-release-plan` never passes. So this runs
 * `getReleasePlan`'s own reads (config, changesets, pre state, packages) from
 * the copies it resolves, then calls `assembleReleasePlan` with the snapshot,
 * as `changeset version --snapshot` does.
 */
const fixture = (name: string): string => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));

const getReleasePlanDir = realpathSync(
	fileURLToPath(new URL("../node_modules/@changesets/get-release-plan", import.meta.url)),
);

/** A dependency of `@changesets/get-release-plan`, loaded from beside it as it loads one. */
const sibling = async <A>(name: string): Promise<A> => {
	const dir = join(getReleasePlanDir, "..", "..", name);
	const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { exports: { ".": string } };
	return (await import(pathToFileURL(join(dir, manifest.exports["."])).href)) as A;
};

// biome-ignore lint/suspicious/noExplicitAny: the oracle's own shapes come from untyped dynamic imports
type Any = any;

const loadOracle = Effect.promise(async () => ({
	readConfig: (await sibling<Any>("@changesets/config")).readConfig,
	readPreState: (await sibling<Any>("@changesets/pre")).readPreState,
	readChangesets: (await sibling<Any>("@changesets/read")).readChangesets,
	getPackages: (await sibling<Any>("@manypkg/get-packages")).getPackages,
}));

const NOW = new Date("2026-11-09T12:34:56.789Z");

interface SnapshotCase {
	readonly tag?: string;
	readonly commit?: string;
	readonly useCalculatedVersion?: boolean;
	readonly prereleaseTemplate?: string;
}

/** The oracle's `name -> newVersion`, or the message it throws, with the clock held at {@link NOW}. */
const oracle = (name: string, snapshot: SnapshotCase) =>
	Effect.gen(function* () {
		const { readConfig, readPreState, readChangesets, getPackages } = yield* loadOracle;
		return yield* Effect.promise(async () => {
			const original = console.error;
			console.error = () => {};
			vi.useFakeTimers({ toFake: ["Date"], now: NOW });
			try {
				const packages = await getPackages(fixture(name));
				const { config } = await readConfig(packages.rootDir, packages);
				const releaseConfig = {
					...config,
					snapshot: {
						...config.snapshot,
						...(snapshot.useCalculatedVersion === undefined
							? {}
							: { useCalculatedVersion: snapshot.useCalculatedVersion }),
						...(snapshot.prereleaseTemplate === undefined ? {} : { prereleaseTemplate: snapshot.prereleaseTemplate }),
					},
				};
				const changesets = await readChangesets(packages.rootDir);
				const preState = await readPreState(packages.rootDir);
				const plan = assembleReleasePlan(changesets, packages, releaseConfig, preState, {
					...(snapshot.tag === undefined ? {} : { tag: snapshot.tag }),
					...(snapshot.commit === undefined ? {} : { commit: snapshot.commit }),
				});
				return {
					versions: Object.fromEntries(
						plan.releases.map((r) => [r.name, r.newVersion] as const).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
					) as Record<string, string | undefined>,
				};
			} catch (error) {
				return { throws: (error as Error).message };
			} finally {
				vi.useRealTimers();
				console.error = original;
			}
		});
	});

const discovery = (cwd: string) =>
	WorkspaceDiscovery.layer({ cwd }).pipe(
		Layer.provide(WorkspaceRoot.layer),
		Layer.provideMerge(Layer.merge(NodeFileSystem.layer, NodePath.layer)),
	);

const toSnapshot = (snapshot: SnapshotCase): ReleaseSnapshot => ({ ...snapshot, timestamp: NOW });

const ours = (name: string, snapshot: SnapshotCase) =>
	ReleasePlan.read(fixture(name), { snapshot: toSnapshot(snapshot) }).pipe(Effect.provide(discovery(fixture(name))));

const versions = (plan: ReleasePlan): Record<string, string> =>
	Object.fromEntries(plan.releases.map((r) => [r.name, r.newVersion]));

/**
 * Each case's `expected` is the oracle's answer, copied from a run with the
 * clock at {@link NOW}; never write one by hand. The test checks it against a
 * live oracle run too, so a table that drifts from the oracle fails.
 */
const cases: ReadonlyArray<{
	readonly label: string;
	readonly fixture: string;
	readonly snapshot: SnapshotCase;
	readonly expected: Record<string, string>;
}> = [
	{
		label: "a tag, no template: 0.0.0-<tag>-<datetime>",
		fixture: "minor-ripple-0x",
		snapshot: { tag: "canary" },
		expected: { a: "0.0.0-canary-20261109123456", b: "0.0.0-canary-20261109123456" },
	},
	{
		label: "useCalculatedVersion bases the snapshot on the planned version, dependents included",
		fixture: "minor-ripple-0x",
		snapshot: { tag: "canary", useCalculatedVersion: true },
		expected: { a: "0.24.0-canary-20261109123456", b: "1.0.1-canary-20261109123456" },
	},
	{
		label: "no tag, no template: 0.0.0-<datetime>",
		fixture: "minor-ripple-0x",
		snapshot: {},
		expected: { a: "0.0.0-20261109123456", b: "0.0.0-20261109123456" },
	},
	{
		label: "a template with {tag}, {commit-short} and {timestamp} over a fixed group",
		fixture: "fixed-group",
		snapshot: { tag: "pr", commit: "abcdef1234567", prereleaseTemplate: "{tag}-{commit-short}-{timestamp}" },
		expected: {
			a: "0.0.0-pr-abcdef1-1794227696789",
			b: "0.0.0-pr-abcdef1-1794227696789",
			c: "0.0.0-pr-abcdef1-1794227696789",
			d: "0.0.0-pr-abcdef1-1794227696789",
		},
	},
	{
		label: "a template with {commit} and {datetime}, calculated, no tag",
		fixture: "fixed-group",
		snapshot: { commit: "abcdef1234567", prereleaseTemplate: "{commit}.{datetime}", useCalculatedVersion: true },
		expected: {
			a: "1.3.0-abcdef1234567.20261109123456",
			b: "1.3.0-abcdef1234567.20261109123456",
			c: "1.3.0-abcdef1234567.20261109123456",
			d: "3.0.1-abcdef1234567.20261109123456",
		},
	},
	{
		label: "a none entry keeps its version",
		fixture: "dev-dependent-none",
		snapshot: { tag: "canary" },
		expected: { a: "0.0.0-canary-20261109123456", b: "1.0.0" },
	},
	{
		label: "exit mode plans a snapshot, calculated without a pre suffix",
		fixture: "pre-exit",
		snapshot: { tag: "canary", useCalculatedVersion: true },
		expected: { a: "1.0.1-canary-20261109123456", b: "1.1.0-canary-20261109123456" },
	},
	{
		label: "a tag value holding an earlier placeholder stays literal: {commit} is filled before {tag} puts it there",
		fixture: "minor-ripple-0x",
		snapshot: { tag: "{commit}", commit: "abcdef1234567", prereleaseTemplate: "{tag}" },
		expected: { a: "0.0.0-{commit}", b: "0.0.0-{commit}" },
	},
	{
		label: "a tag value holding a later placeholder is filled again, as the oracle fills in order",
		fixture: "minor-ripple-0x",
		snapshot: { tag: "{timestamp}", prereleaseTemplate: "{tag}" },
		expected: { a: "0.0.0-1794227696789", b: "0.0.0-1794227696789" },
	},
];

describe("ReleasePlan snapshot against @changesets/assemble-release-plan", () => {
	for (const { label, fixture: name, snapshot, expected } of cases) {
		it.effect(label, () =>
			Effect.gen(function* () {
				const theirs = yield* oracle(name, snapshot);
				assert.deepStrictEqual(theirs, { versions: expected });
				assert.deepStrictEqual(versions(yield* ours(name, snapshot)), expected);
			}),
		);
	}

	it.effect("the comparison can fail: a different timestamp does not match the table", () =>
		Effect.gen(function* () {
			const plan = yield* ReleasePlan.read(fixture("minor-ripple-0x"), {
				snapshot: { tag: "canary", timestamp: new Date("2020-01-01T00:00:00Z") },
			}).pipe(Effect.provide(discovery(fixture("minor-ripple-0x"))));
			assert.notDeepEqual(versions(plan), { a: "0.0.0-canary-20261109123456", b: "0.0.0-canary-20261109123456" });
			assert.deepStrictEqual(versions(plan), { a: "0.0.0-canary-20200101000000", b: "0.0.0-canary-20200101000000" });
		}),
	);

	for (const [label, snapshot, placeholder, kind, thrown] of [
		[
			"a tag with no {tag} in the template",
			{ tag: "canary", prereleaseTemplate: "snap" },
			"tag",
			"missingPlaceholder",
			`Failed to compose snapshot version: "{tag}" placeholder is missing, but the snapshot parameter is defined (value: 'canary')`,
		],
		[
			"{tag} with no tag",
			{ prereleaseTemplate: "{tag}-x" },
			"tag",
			"missingValue",
			`Failed to compose snapshot version: "{tag}" placeholder is used without having a value defined!`,
		],
		[
			"{commit} with no commit",
			{ tag: "canary", prereleaseTemplate: "{tag}-{commit}" },
			"commit",
			"missingValue",
			`Failed to compose snapshot version: "{commit}" placeholder is used without having a value defined!`,
		],
	] as const) {
		it.effect(`fails SnapshotTemplateError on ${label}, where the oracle throws`, () =>
			Effect.gen(function* () {
				assert.deepStrictEqual(yield* oracle("minor-ripple-0x", snapshot), { throws: thrown });
				const error = yield* Effect.flip(ours("minor-ripple-0x", snapshot));
				assert.strictEqual(error._tag, "SnapshotTemplateError");
				if (error._tag === "SnapshotTemplateError") {
					assert.strictEqual(error.placeholder, placeholder);
					assert.strictEqual(error.kind, kind);
				}
			}),
		);
	}

	it.effect("fails SnapshotPreModeError in pre mode, as changeset version does, though the oracle plans one", () =>
		Effect.gen(function* () {
			const theirs = yield* oracle("pre-mode", { tag: "canary" });
			assert.deepStrictEqual(theirs, {
				versions: {
					a: "0.0.0-canary-20261109123456",
					b: "0.0.0-canary-20261109123456",
					c: "0.0.0-canary-20261109123456",
				},
			});
			const error = yield* Effect.flip(ours("pre-mode", { tag: "canary" }));
			assert.strictEqual(error._tag, "SnapshotPreModeError");
			if (error._tag === "SnapshotPreModeError") assert.strictEqual(error.preTag, "next");
			// Pre mode with no snapshot still plans.
			const plain = yield* ReleasePlan.read(fixture("pre-mode")).pipe(Effect.provide(discovery(fixture("pre-mode"))));
			assert.isAbove(plain.releases.length, 0);
		}),
	);

	describe("an empty tag is no tag", () => {
		it.effect('with no template, as the oracle answers for both "" and no tag', () =>
			Effect.gen(function* () {
				const empty = yield* oracle("minor-ripple-0x", { tag: "" });
				const absent = yield* oracle("minor-ripple-0x", {});
				assert.deepStrictEqual(empty, absent);
				assert.deepStrictEqual(empty, { versions: { a: "0.0.0-20261109123456", b: "0.0.0-20261109123456" } });
				assert.deepStrictEqual(versions(yield* ours("minor-ripple-0x", { tag: "" })), { ...(empty.versions ?? {}) });
			}),
		);

		it.effect("with a template using {tag}: missingValue, where the oracle fills in nothing", () =>
			Effect.gen(function* () {
				const snapshot = { tag: "", prereleaseTemplate: "{tag}-x" };
				assert.deepStrictEqual(yield* oracle("minor-ripple-0x", snapshot), {
					versions: { a: "0.0.0--x", b: "0.0.0--x" },
				});
				const error = yield* Effect.flip(ours("minor-ripple-0x", snapshot));
				assert.isTrue(error._tag === "SnapshotTemplateError" && error.kind === "missingValue");
			}),
		);

		it.effect("with a template lacking {tag}: planned, where the oracle refuses", () =>
			Effect.gen(function* () {
				const snapshot = { tag: "", prereleaseTemplate: "snap" };
				const theirs = yield* oracle("minor-ripple-0x", snapshot);
				assert.isDefined(theirs.throws);
				assert.deepStrictEqual(versions(yield* ours("minor-ripple-0x", snapshot)), {
					a: "0.0.0-snap",
					b: "0.0.0-snap",
				});
			}),
		);
	});

	it.effect("an empty commit is no commit: missingValue, where the oracle's empty suffix plans plain versions", () =>
		Effect.gen(function* () {
			const snapshot = { commit: "", prereleaseTemplate: "{commit}" };
			assert.deepStrictEqual(yield* oracle("minor-ripple-0x", snapshot), { versions: { a: "0.24.0", b: "1.0.1" } });
			const error = yield* Effect.flip(ours("minor-ripple-0x", snapshot));
			assert.isTrue(
				error._tag === "SnapshotTemplateError" && error.kind === "missingValue" && error.placeholder === "commit",
			);
		}),
	);
});
