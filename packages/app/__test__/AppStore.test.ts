import { describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { Effect, Layer, Path } from "effect";
import type { AppStoreOptions } from "../src/index.js";
import { AppStore } from "../src/index.js";
import { assertNotGuardExit, filenameGuardCases } from "./filenameGuard.js";

const xdgPaths = XdgPaths.make({
	home: "/home/test",
	stateHome: "/home/test/.local/state",
	configDirs: ["/etc/xdg"],
	dataDirs: ["/usr/share"],
});

/**
 * An empty volume whose `makeDirectory` DIES. Construction must stop at
 * `ensureState`, before the native SQLite binding opens a file: that binding
 * never touches the `FileSystem` service, so a real mkdir here would let the
 * layer open a database on the HOST disk. The defect is the stop sign the
 * guard tests below read past — it must not be the guard's own.
 */
const base = Layer.mergeAll(
	Path.layer,
	MemoryFileSystem.layerWith(
		{},
		{
			faults: {
				makeDirectory: MemoryFileSystem.die(new Error("test harness: state directory creation is not provided")),
			},
		},
	),
);
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
				// The harness volume still dies past the guard (ensureState has no
				// real mkdir), but the defect must NOT be the guard's — that is the
				// proof the guard does not fire on good input. The success path is
				// proven against a real filesystem in the integration suite.
				assertNotGuardExit(yield* build({ migrations: [], filename: "store.db" }));
			}),
		);
	});
});
