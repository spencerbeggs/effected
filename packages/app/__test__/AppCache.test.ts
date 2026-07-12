import { describe, it } from "@effect/vitest";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { Effect, FileSystem, Layer, Path } from "effect";
import type { AppCacheOptions } from "../src/index.js";
import { AppCache } from "../src/index.js";
import { assertNotGuardExit, filenameGuardCases } from "./filenameGuard.js";

const xdgPaths = XdgPaths.make({
	home: "/home/test",
	cacheHome: "/home/test/.cache",
	configDirs: ["/etc/xdg"],
	dataDirs: ["/usr/share"],
});

const base = Layer.mergeAll(Path.layer, FileSystem.layerNoop({}));
const harness = Layer.provideMerge(
	AppDirs.layer({ namespace: "myapp" }).pipe(Layer.provide(Xdg.layerFrom(xdgPaths)), Layer.provide(base)),
	base,
);

const build = (options?: AppCacheOptions) =>
	Effect.exit(Effect.provide(Effect.void, AppCache.layer(options).pipe(Layer.provide(harness))));

describe("AppCache.layer", () => {
	describe("the filename guard", () => {
		filenameGuardCases((filename) => build({ filename }));

		it.effect("omitted options pass the guard with the default filename", () =>
			Effect.gen(function* () {
				// The noop FileSystem still dies past the guard (ensureCache has no
				// real mkdir), but the defect must NOT be the guard's. The success
				// path is proven against a real filesystem in the integration suite.
				assertNotGuardExit(yield* build());
			}),
		);
	});
});
