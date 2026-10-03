import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { Cache, CacheShape } from "@effected/store";
import { AppDirs, Xdg, XdgPaths } from "@effected/xdg";
import { Cause, Context, Effect, Exit, Layer, Option, Path } from "effect";
import type { AppCacheOptions } from "../src/index.js";
import { AppCache } from "../src/index.js";
import { assertGuardExit, assertNotGuardExit, filenameGuardCases, subdirGuardCases } from "./filenameGuard.js";

const xdgPaths = XdgPaths.make({
	home: "/home/test",
	cacheHome: "/home/test/.cache",
	configDirs: ["/etc/xdg"],
	dataDirs: ["/usr/share"],
});

/**
 * An empty volume whose `makeDirectory` DIES. Construction must stop at
 * `ensureCache`, before the native SQLite binding opens a file: that binding
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
				makeDirectory: MemoryFileSystem.die(new Error("test harness: cache directory creation is not provided")),
			},
		},
	),
);
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
				// The harness volume still dies past the guard (ensureCache has no
				// real mkdir), but the defect must NOT be the guard's. The success
				// path is proven against a real filesystem in the integration suite.
				assertNotGuardExit(yield* build());
			}),
		);
	});
});

class ExtraCache extends Context.Service<ExtraCache, CacheShape>()("app-test/ExtraCache") {}
class NotACache extends Context.Service<NotACache, { readonly name: string }>()("app-test/NotACache") {}
class WiderCache extends Context.Service<WiderCache, CacheShape & { readonly extra: string }>()(
	"app-test/WiderCache",
) {}

const buildAs = (filename: string) =>
	Effect.exit(Effect.provide(Effect.void, AppCache.layerAs(ExtraCache, { filename }).pipe(Layer.provide(harness))));

describe("AppCache.layerAs", () => {
	describe("the filename guard", () => {
		filenameGuardCases(buildAs);

		it.effect("a plain filename passes the guard", () =>
			Effect.gen(function* () {
				assertNotGuardExit(yield* buildAs("extra.db"));
			}),
		);

		it.effect("the guard's die names AppCache.layerAs, not AppCache.layer", () =>
			Effect.gen(function* () {
				const exit = yield* buildAs("..");
				assertGuardExit(exit);
				const die = Option.getOrThrow(Exit.getCause(exit)).reasons.find(Cause.isDieReason);
				const defect = die?.defect;
				assert.instanceOf(defect, Error);
				assert.match(defect instanceof Error ? defect.message : "", /^AppCache\.layerAs: /);
			}),
		);
	});

	it("is typed by the consumer's key alone, with the inner Cache kept out of the output", () => {
		// Compile-time: the output service is exactly the tag's identifier.
		const live = AppCache.layerAs(ExtraCache, { filename: "extra.db" });
		const asTag: Layer.Layer<ExtraCache, unknown, unknown> = live;
		// @ts-expect-error the inner Cache service is provided internally, never output
		const asPrimary: Layer.Layer<Cache | ExtraCache, unknown, unknown> = live;
		assert.isDefined(asTag);
		assert.isDefined(asPrimary);
	});

	it("rejects a key whose service is not CacheShape", () => {
		// @ts-expect-error a key over an unrelated shape is not a cache key
		const unrelated = () => AppCache.layerAs(NotACache, { filename: "x.db" });
		// @ts-expect-error a key over a WIDER shape would be handed a CacheShape missing its extra members
		const wider = () => AppCache.layerAs(WiderCache, { filename: "x.db" });
		assert.isFunction(unrelated);
		assert.isFunction(wider);
	});

	it("requires a filename", () => {
		// @ts-expect-error filename is required — a default would collide with AppCache.layer's file
		const missing = () => AppCache.layerAs(ExtraCache, {});
		assert.isFunction(missing);
	});
});

describe("AppCache subdir guard", () => {
	describe("on AppCache.layer", () => {
		subdirGuardCases((subdir) =>
			Effect.exit(Effect.provide(Effect.void, AppCache.layer({ subdir }).pipe(Layer.provide(harness)))),
		);

		it.effect("a nested relative subdir passes the guard", () =>
			Effect.gen(function* () {
				assertNotGuardExit(
					yield* Effect.exit(
						Effect.provide(Effect.void, AppCache.layer({ subdir: "projects/abc123" }).pipe(Layer.provide(harness))),
					),
				);
			}),
		);
	});

	describe("on AppCache.layerAs", () => {
		subdirGuardCases((subdir) =>
			Effect.exit(
				Effect.provide(
					Effect.void,
					AppCache.layerAs(ExtraCache, { filename: "extra.db", subdir }).pipe(Layer.provide(harness)),
				),
			),
		);
	});
});

describe("AppCache.location", () => {
	// The same guard as the layers: location shares their derivation.
	filenameGuardCases((filename) => Effect.exit(AppCache.location({ filename }).pipe(Effect.provide(harness))));
	subdirGuardCases((subdir) => Effect.exit(AppCache.location({ subdir }).pipe(Effect.provide(harness))));
});
