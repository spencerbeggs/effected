import { assert, describe, it } from "@effect/vitest";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { Cause, Effect, Exit, FileSystem, Layer, Option, Path } from "effect";
import type { AppStoreOptions } from "../src/index.js";
import { AppStore } from "../src/index.js";

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

/** The guard's own words — what discriminates a filename die from any other die. */
const guardMessage = /`filename` must/;

const assertGuardDefect = (name: string, filename: string) =>
	it.effect(name, () =>
		Effect.gen(function* () {
			const exit = yield* build({ migrations: [], filename });
			const cause = Exit.getCause(exit);
			assert.isTrue(Option.isSome(cause));
			const reasons = Option.getOrThrow(cause).reasons;
			// A DEFECT, never a typed failure: a bad filename is wiring, not input.
			assert.isFalse(reasons.some(Cause.isFailReason));
			const die = reasons.find(Cause.isDieReason);
			assert.instanceOf(die?.defect, Error);
			assert.match((die?.defect as Error).message, guardMessage);
		}),
	);

describe("AppStore.layer", () => {
	describe("the filename guard", () => {
		assertGuardDefect("an empty filename dies at construction", "");
		assertGuardDefect("a filename with a forward slash dies at construction", "state/store.db");
		assertGuardDefect("a filename with a backslash dies at construction", "state\\store.db");
		assertGuardDefect("a traversal filename dies at construction", "..");

		it.effect("a plain filename passes the guard", () =>
			Effect.gen(function* () {
				// The noop FileSystem still dies past the guard (ensureState has no
				// real mkdir), but the defect must NOT be the guard's — that is the
				// proof the guard does not fire on good input. The success path is
				// proven against a real filesystem in the integration suite.
				const exit = yield* build({ migrations: [], filename: "store.db" });
				const cause = Exit.getCause(exit);
				assert.isTrue(Option.isSome(cause));
				for (const reason of Option.getOrThrow(cause).reasons) {
					if (Cause.isDieReason(reason) && reason.defect instanceof Error) {
						assert.notMatch(reason.defect.message, guardMessage);
					}
				}
			}),
		);
	});
});
