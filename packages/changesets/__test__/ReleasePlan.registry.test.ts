import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { NpmRegistry, RegistryReadError } from "@effected/npm";
import { WorkspaceDiscovery, WorkspaceRoot } from "@effected/workspaces";
import { Effect, Layer, Option } from "effect";
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

const registryOf = (registry: Layer.Layer<NpmRegistry>) => RegistryVersions.layer.pipe(Layer.provide(registry));

const seeded = (versions: Record<string, Record<string, object>>) =>
	registryOf(NpmRegistry.layerSeeded({ registries: { "https://registry.npmjs.org": versions } }));

const plan = (layer: Layer.Layer<RegistryVersions> | undefined) =>
	ReleasePlan.read("/repo").pipe(
		Effect.map((found) =>
			found.releases.map((release) => [release.name, release.oldVersion, release.newVersion, release.type]),
		),
		layer === undefined ? Effect.provide(files) : Effect.provide(Layer.merge(files, layer)),
	);

describe("ReleasePlan.read with a RegistryVersions", () => {
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
