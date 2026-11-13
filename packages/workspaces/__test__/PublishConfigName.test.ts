import { assert, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Schema } from "effect";
import { WorkspaceDiscovery } from "../src/WorkspaceDiscovery.js";
import { PublishConfig } from "../src/WorkspacePackage.js";
import { WorkspaceRoot } from "../src/WorkspaceRoot.js";

// `publishConfig.name` is the name a package publishes under; pnpm probes the registry for it
// (`published_name`, crates/cli/src/cli_args/changelog.rs:270-273), so discovery must carry it.

it("PublishConfig keeps name and treats it as optional", () => {
	assert.strictEqual(Schema.decodeUnknownSync(PublishConfig)({ name: "published" }).name, "published");
	assert.strictEqual(Schema.decodeUnknownSync(PublishConfig)({}).name, undefined);
});

it.effect("discovery reads publishConfig.name from a manifest", () =>
	Effect.gen(function* () {
		const discovery = yield* WorkspaceDiscovery;
		const packages = yield* discovery.listPackagesIn("/repo");
		const renamed = packages.find((pkg) => pkg.name === "@p/a");
		assert.strictEqual(renamed?.publishConfig?.name, "published-a");
		assert.strictEqual(packages.find((pkg) => pkg.name === "@p/b")?.publishConfig, undefined);
	}).pipe(
		Effect.provide(
			WorkspaceDiscovery.layer().pipe(
				Layer.provide(WorkspaceRoot.layer),
				Layer.provideMerge(
					MemoryFileSystem.layerWithPath({
						"/repo/package.json": JSON.stringify({ name: "root", private: true }),
						"/repo/pnpm-workspace.yaml": "packages:\n  - packages/*\n",
						"/repo/packages/a/package.json": JSON.stringify({
							name: "@p/a",
							version: "1.0.0",
							publishConfig: { name: "published-a" },
						}),
						"/repo/packages/b/package.json": JSON.stringify({ name: "@p/b", version: "1.0.0" }),
					}),
				),
			),
		),
	),
);
