import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { Store, StoreShape } from "@effected/store";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { Cause, Context, Effect, Exit, Layer, Option, Path } from "effect";
import type { AppStoreOptions } from "../src/index.js";
import { AppStore } from "../src/index.js";
import { assertGuardExit, assertNotGuardExit, filenameGuardCases, subdirGuardCases } from "./filenameGuard.js";

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

class ExtraStore extends Context.Service<ExtraStore, StoreShape>()("app-test/ExtraStore") {}
class NotAStore extends Context.Service<NotAStore, { readonly name: string }>()("app-test/NotAStore") {}
class WiderStore extends Context.Service<WiderStore, StoreShape & { readonly extra: string }>()(
	"app-test/WiderStore",
) {}

const buildAs = (filename: string) =>
	Effect.exit(
		Effect.provide(
			Effect.void,
			AppStore.layerAs(ExtraStore, { migrations: [], filename }).pipe(Layer.provide(harness)),
		),
	);

describe("AppStore.layerAs", () => {
	describe("the filename guard", () => {
		filenameGuardCases(buildAs);

		it.effect("a plain filename passes the guard", () =>
			Effect.gen(function* () {
				assertNotGuardExit(yield* buildAs("extra.db"));
			}),
		);

		it.effect("the guard's die names AppStore.layerAs, not AppStore.layer", () =>
			Effect.gen(function* () {
				const exit = yield* buildAs("..");
				assertGuardExit(exit);
				const die = Option.getOrThrow(Exit.getCause(exit)).reasons.find(Cause.isDieReason);
				const defect = die?.defect;
				assert.instanceOf(defect, Error);
				assert.match(defect instanceof Error ? defect.message : "", /^AppStore\.layerAs: /);
			}),
		);
	});

	it("is typed by the consumer's key alone, with the inner Store kept out of the output", () => {
		// Compile-time: the output service is exactly the tag's identifier.
		const live = AppStore.layerAs(ExtraStore, { migrations: [], filename: "extra.db" });
		const asTag: Layer.Layer<ExtraStore, unknown, unknown> = live;
		// @ts-expect-error the inner Store service is provided internally, never output
		const asPrimary: Layer.Layer<Store | ExtraStore, unknown, unknown> = live;
		assert.isDefined(asTag);
		assert.isDefined(asPrimary);
	});

	it("rejects a key whose service is not StoreShape", () => {
		// @ts-expect-error a key over an unrelated shape is not a store key
		const unrelated = () => AppStore.layerAs(NotAStore, { migrations: [], filename: "x.db" });
		// @ts-expect-error a key over a WIDER shape would be handed a StoreShape missing its extra members
		const wider = () => AppStore.layerAs(WiderStore, { migrations: [], filename: "x.db" });
		assert.isFunction(unrelated);
		assert.isFunction(wider);
	});

	it("requires a filename", () => {
		// @ts-expect-error filename is required — a default would collide with AppStore.layer's file
		const missing = () => AppStore.layerAs(ExtraStore, { migrations: [] });
		assert.isFunction(missing);
	});
});

describe("AppStore subdir guard", () => {
	describe("on AppStore.layer", () => {
		subdirGuardCases((subdir) =>
			Effect.exit(Effect.provide(Effect.void, AppStore.layer({ migrations: [], subdir }).pipe(Layer.provide(harness)))),
		);

		it.effect("a nested relative subdir passes the guard", () =>
			Effect.gen(function* () {
				assertNotGuardExit(
					yield* Effect.exit(
						Effect.provide(
							Effect.void,
							AppStore.layer({ migrations: [], subdir: "projects/abc123" }).pipe(Layer.provide(harness)),
						),
					),
				);
			}),
		);
	});

	describe("on AppStore.layerAs", () => {
		subdirGuardCases((subdir) =>
			Effect.exit(
				Effect.provide(
					Effect.void,
					AppStore.layerAs(ExtraStore, { migrations: [], filename: "extra.db", subdir }).pipe(Layer.provide(harness)),
				),
			),
		);
	});
});

describe("AppStore.location", () => {
	// The same guard as the layers: location shares their derivation.
	filenameGuardCases((filename) =>
		Effect.exit(AppStore.location({ migrations: [], filename }).pipe(Effect.provide(harness))),
	);
	subdirGuardCases((subdir) =>
		Effect.exit(AppStore.location({ migrations: [], subdir }).pipe(Effect.provide(harness))),
	);
});
