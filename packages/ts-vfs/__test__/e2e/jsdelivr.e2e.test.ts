/**
 * Opt-in real-network suite against the live jsDelivr CDN. Enable with
 * `TS_VFS_E2E=1 pnpm vitest run packages/ts-vfs`. Network-tolerant: skipped
 * by default so CI never depends on CDN availability.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { Cache } from "@effected/store";
import { Effect, Layer, Option, Path } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { PackageFetcher, PackageSpec, TypeCache, TypeRegistry } from "../../src/index.js";

const LiveLayer = TypeRegistry.layer.pipe(
	Layer.provideMerge(
		Layer.mergeAll(TypeCache.layer({ cacheDir: mkdtempSync(join(tmpdir(), "ts-vfs-e2e-")) }), PackageFetcher.layer),
	),
	Layer.provide(Layer.mergeAll(Cache.layerTest(), NodeFileSystem.layer, Path.layer, FetchHttpClient.layer)),
);

describe.skipIf(process.env.TS_VFS_E2E === undefined)("jsdelivr e2e", () => {
	it.live(
		"resolves, fetches and rebuilds zod from the live CDN",
		() =>
			Effect.gen(function* () {
				const registry = yield* TypeRegistry;
				const version = yield* registry.resolveVersion("zod", "^3.23.0");
				assert.match(version, /^3\.\d+\.\d+$/);
				const pkg = PackageSpec.make({ name: "zod", version });
				const vfs = yield* registry.getPackageVfs(pkg);
				assert.isTrue(vfs.size > 0);
				assert.isTrue([...vfs.keys()].every((key) => key.startsWith("node_modules/zod/")));
				const entry = yield* registry.resolveImport(pkg, "zod");
				assert.isTrue(Option.isSome(entry));
			}).pipe(Effect.provide(LiveLayer)),
		120_000,
	);
});
