import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { NpmConfig, NpmRegistry, RegistryReadError } from "@effected/npm";
import { WorkspaceDiscovery, WorkspacePackage, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer, Option, Result } from "effect";
import { planPnpm } from "../src/internal/pnpmPlan.js";
import { PendingChangeset } from "../src/PendingChangesets.js";
import { RegistryVersions } from "../src/RegistryVersions.js";
import { ReleasePlan } from "../src/ReleasePlan.js";

// ReleasePlan.read with the registry seam: the public releases' manifest versions are probed, and
// the ones the registry lacks debut at their manifest version (pnpm's `unpublished_release_dirs`,
// crates/cli/src/cli_args/changelog.rs:251, probing exactly `package.versions.contains_key(current)`).
// No real registry is contacted: NpmRegistry is the seeded or stubbed double.

const manifest = (name: string, extra: Record<string, unknown> = {}) =>
	JSON.stringify({ name, version: "1.0.0", private: false, ...extra });

const SEED = {
	"/repo/package.json": JSON.stringify({ name: "root", private: true }),
	"/repo/pnpm-workspace.yaml": "packages:\n  - packages/*\n\nversioning:\n  lanes: {}\n",
	"/repo/packages/a/package.json": manifest("@p/a"),
	"/repo/packages/b/package.json": manifest("@p/b", { private: true }),
	"/repo/.changeset/one.md": '---\n"@p/a": minor\n"@p/b": minor\n---\n\nBoth.\n',
};

const files = WorkspaceDiscovery.layer().pipe(
	Layer.provide(WorkspaceRoot.layer),
	Layer.provideMerge(MemoryFileSystem.layerWithPath(SEED)),
);

const configOf = (npmrc: string) => {
	const result = NpmConfig.fromSourcesResult([{ text: npmrc }], {});
	assert.isTrue(Result.isSuccess(result));
	return Result.getOrThrow(result);
};

const registryOf = (registry: Layer.Layer<NpmRegistry>, npmrc = "") => {
	const config = configOf(npmrc);
	return RegistryVersions.layerFrom(config).pipe(Layer.provide(registry));
};

const seeded = (versions: Record<string, Record<string, object>>) =>
	registryOf(NpmRegistry.layerSeeded({ registries: { "https://registry.npmjs.org": versions } }));

const plan = (layer: Layer.Layer<RegistryVersions> | undefined) =>
	ReleasePlan.read("/repo").pipe(
		Effect.map((found) =>
			found.releases.map((release) => [release.name, release.oldVersion, release.newVersion, release.type]),
		),
		layer === undefined ? Effect.provide(files) : Effect.provide(Layer.merge(files, layer)),
	);

const RENAMED = {
	...SEED,
	"/repo/packages/a/package.json": manifest("@p/a", { publishConfig: { name: "published-a", access: "public" } }),
};

const planOf = (seed: Record<string, string>, layer: Layer.Layer<RegistryVersions>) =>
	ReleasePlan.read("/repo").pipe(
		Effect.map((found) => found.releases.map((release) => [release.name, release.oldVersion, release.newVersion])),
		Effect.provide(
			Layer.merge(
				WorkspaceDiscovery.layer().pipe(
					Layer.provide(WorkspaceRoot.layer),
					Layer.provideMerge(MemoryFileSystem.layerWithPath(seed)),
				),
				layer,
			),
		),
	);

describe("ReleasePlan.read with a RegistryVersions", () => {
	it.effect("routes a scoped package to its own registry, where the default one would not have it", () =>
		Effect.gen(function* () {
			const npmrc = "@p:registry=https://npm.private.test\n";
			const privateOnly = NpmRegistry.layerSeeded({
				registries: { "https://npm.private.test": { "@p/a": { "1.0.0": {} } } },
			});
			// Routed by the npmrc: the private registry has 1.0.0, so a normal bump.
			const routed = yield* plan(registryOf(privateOnly, npmrc));
			assert.deepStrictEqual(routed[0], ["@p/a", "1.0.0", "1.1.0", "minor"]);
			// The same seed read through the default registry has nothing, so it debuts.
			const unrouted = yield* plan(registryOf(privateOnly));
			assert.deepStrictEqual(unrouted[0], ["@p/a", "1.0.0", "1.0.0", "minor"]);
		}),
	);

	it.effect("probes the published name of a renamed package, and keeps the manifest name in the plan", () =>
		Effect.gen(function* () {
			const asked: Array<string> = [];
			const layer = registryOf(
				NpmRegistry.layerTest({
					versions: (name) => {
						asked.push(name);
						return Effect.succeed(Option.some(name === "published-a" ? ["1.0.0"] : []));
					},
				}),
			);
			const found = yield* planOf(RENAMED, layer);
			assert.deepStrictEqual(asked, ["published-a"]);
			assert.deepStrictEqual(found[0], ["@p/a", "1.0.0", "1.1.0"]);
		}),
	);

	it.effect("treats an empty publishConfig.name as no rename", () =>
		Effect.gen(function* () {
			const asked: Array<string> = [];
			const layer = registryOf(
				NpmRegistry.layerTest({
					versions: (name) => {
						asked.push(name);
						return Effect.succeed(Option.some(["1.0.0"]));
					},
				}),
			);
			const seed = { ...SEED, "/repo/packages/a/package.json": manifest("@p/a", { publishConfig: { name: "" } }) };
			yield* planOf(seed, layer);
			assert.deepStrictEqual(asked, ["@p/a"]);
		}),
	);

	it.effect("plans a normal bump when the registry has the manifest version", () =>
		Effect.gen(function* () {
			const found = yield* plan(seeded({ "@p/a": { "1.0.0": {} } }));
			assert.deepStrictEqual(found, [
				["@p/a", "1.0.0", "1.1.0", "minor"],
				["@p/b", "1.0.0", "1.1.0", "minor"],
			]);
		}),
	);

	it.effect("debuts a package the registry does not know at its manifest version", () =>
		Effect.gen(function* () {
			const found = yield* plan(seeded({}));
			// The first release keeps its manifest version and reports the intent's bump; the private
			// project is never probed, so it bumps normally.
			assert.deepStrictEqual(found, [
				["@p/a", "1.0.0", "1.0.0", "minor"],
				["@p/b", "1.0.0", "1.1.0", "minor"],
			]);
		}),
	);

	it.effect("probes the exact manifest version: a newer published latest does not count", () =>
		Effect.gen(function* () {
			const found = yield* plan(seeded({ "@p/a": { "2.0.0": {} } }));
			assert.deepStrictEqual(found[0], ["@p/a", "1.0.0", "1.0.0", "minor"]);
		}),
	);

	it.effect("asks the registry about public releases only", () =>
		Effect.gen(function* () {
			const asked: Array<string> = [];
			const layer = registryOf(
				NpmRegistry.layerTest({
					versions: (name) => {
						asked.push(name);
						return Effect.succeed(Option.some(["1.0.0"]));
					},
				}),
			);
			yield* plan(layer);
			assert.deepStrictEqual(asked, ["@p/a"]);
		}),
	);

	it.effect("fails RegistryReadError on a transport failure instead of reading it as unpublished", () =>
		Effect.gen(function* () {
			const layer = registryOf(
				NpmRegistry.layerTest({
					versions: (name) => Effect.fail(new RegistryReadError({ kind: "transport", package: name, registry: "r" })),
				}),
			);
			const error = yield* Effect.flip(plan(layer));
			assert.strictEqual(error._tag, "RegistryReadError");
		}),
	);

	it.effect("asks nothing, and plans no first release, without the service", () =>
		Effect.gen(function* () {
			const found = yield* plan(undefined);
			assert.deepStrictEqual(found[0], ["@p/a", "1.0.0", "1.1.0", "minor"]);
		}),
	);
});

describe("planPnpm with unpublished (the seam read uses)", () => {
	it("plans the given directories as first releases in one pass, ahead of published", () => {
		const a = WorkspacePackage.make({
			name: "@p/a",
			version: "1.0.0",
			path: "/ws/a",
			packageJsonPath: "/ws/a/package.json",
			relativePath: "a",
			workspaceRoot: "/ws",
		});
		const result = planPnpm({
			packages: [a],
			changesets: [PendingChangeset.make({ file: "x.md", releases: new Map([["@p/a", "minor"]]), summary: "S." })],
			unpublished: new Set(["a"]),
			published: new Set(["a"]),
		});
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result)) {
			assert.deepStrictEqual(
				result.success.releases.map((r) => [r.name, r.oldVersion, r.newVersion, r.type]),
				[["@p/a", "1.0.0", "1.0.0", "minor"]],
			);
		}
	});
});
