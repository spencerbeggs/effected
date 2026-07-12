import { describe, it } from "@effect/vitest";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { Effect, FileSystem, Layer, Path } from "effect";
import type { AppStoreOptions } from "../src/index.js";
import { AppStore } from "../src/index.js";
import { assertNotGuardExit, filenameGuardCases } from "./filenameGuard.js";

const xdgPaths = XdgPaths.make({
	home: "/home/test",
	stateHome: "/home/test/.local/state",
	configDirs: ["/etc/xdg"],
	dataDirs: ["/usr/share"],
});

const base = Layer.mergeAll(Path.layer, FileSystem.layerNoop({}));
const harness = Layer.provideMerge(
	AppDirs.layer({ namespace: "myapp" }).pipe(Layer.provide(Xdg.layerFrom(xdgPaths)), Layer.provide(base)),
	base,
);

const build = (options: AppStoreOptions) =>
	Effect.exit(Effect.provide(Effect.void, AppStore.layer(options).pipe(Layer.provide(harness))));

describe("AppStore.layer", () => {
	describe("the filename guard", () => {
		filenameGuardCases((filename) => build({ migrations: [], filename }));

		it.effect("a plain filename passes the guard", () =>
			Effect.gen(function* () {
				// The noop FileSystem still dies past the guard (ensureState has no
				// real mkdir), but the defect must NOT be the guard's — that is the
				// proof the guard does not fire on good input. The success path is
				// proven against a real filesystem in the integration suite.
				assertNotGuardExit(yield* build({ migrations: [], filename: "store.db" }));
			}),
		);
	});
});
