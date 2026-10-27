import { assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Context, Effect, Layer } from "effect";
import type { XdgPlatform } from "../src/index.js";
import { CurrentPlatform, Xdg, XdgEnvError } from "../src/index.js";

/** `Xdg`'s resolved paths, from context. */
const xdgPaths = Effect.gen(function* () {
	return yield* Xdg;
});

const on = (platform: XdgPlatform) => Layer.succeed(CurrentPlatform, platform);

/** Read `Xdg` from `layer`, with the platform pinned. */
const read = (layer: Layer.Layer<Xdg, XdgEnvError>, platform: XdgPlatform = "linux") =>
	Effect.provide(xdgPaths, Layer.provide(layer, on(platform)));

describe("Xdg.layerFromEnv", () => {
	it.effect("resolves a record exactly as Xdg.layer resolves the same variables", () =>
		Effect.gen(function* () {
			const vars = {
				HOME: "/home/ada",
				XDG_CONFIG_HOME: "/home/ada/.config",
				XDG_DATA_HOME: "relative/ignored",
				XDG_CONFIG_DIRS: "/etc/a:rel:/etc/b",
			};
			const fromRecord = yield* read(Xdg.layerFromEnv(vars));
			const ambient = yield* read(Layer.provide(Xdg.layer, ConfigProvider.layer(ConfigProvider.fromEnvRecord(vars))));
			assert.deepStrictEqual(fromRecord, ambient);
			assert.strictEqual(fromRecord.home, "/home/ada");
			assert.isUndefined(fromRecord.dataHome);
			assert.deepStrictEqual(fromRecord.configDirs, ["/etc/a", "/etc/b"]);
		}),
	);

	it.effect("a ConfigProvider is provided beneath Xdg.layer, not passed in", () =>
		Effect.gen(function* () {
			const paths = yield* read(
				Layer.provide(Xdg.layer, ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: "/home/grace" }))),
			);
			assert.strictEqual(paths.home, "/home/grace");
			// @ts-expect-error layerFromEnv takes a record only
			Xdg.layerFromEnv(ConfigProvider.fromUnknown({ HOME: "/home/grace" }));
		}),
	);

	it.effect("never reads the ambient provider", () =>
		Effect.gen(function* () {
			const paths = yield* read(Xdg.layerFromEnv({ HOME: "/home/explicit" })).pipe(
				Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ HOME: "/home/ambient" }))),
			);
			assert.strictEqual(paths.home, "/home/explicit");
		}),
	);

	it.effect("resolves two sources in one graph independently, where the shared static does not", () =>
		Effect.gen(function* () {
			class HomeA extends Context.Service<HomeA, string>()("test/HomeA") {}
			class HomeB extends Context.Service<HomeB, string>()("test/HomeB") {}
			const homeOf = <I>(key: Context.Key<I, string>, xdg: Layer.Layer<Xdg, XdgEnvError>) =>
				Layer.effect(
					key,
					Effect.map(xdgPaths, (paths) => paths.home),
				).pipe(Layer.provide(xdg));
			const both = Effect.gen(function* () {
				return [yield* HomeA, yield* HomeB] as const;
			});

			const fresh = yield* both.pipe(
				Effect.provide(
					Layer.mergeAll(
						homeOf(HomeA, Xdg.layerFromEnv({ HOME: "/home/a" })),
						homeOf(HomeB, Xdg.layerFromEnv({ HOME: "/home/b" })),
					),
				),
			);
			assert.deepStrictEqual(fresh, ["/home/a", "/home/b"]);

			// The control: the same graph over the memoized static shares its first build.
			const viaStatic = (home: string) =>
				Layer.provide(Xdg.layer, ConfigProvider.layer(ConfigProvider.fromEnvRecord({ HOME: home })));
			const shared = yield* both.pipe(
				Effect.provide(Layer.mergeAll(homeOf(HomeA, viaStatic("/home/a")), homeOf(HomeB, viaStatic("/home/b")))),
			);
			assert.strictEqual(shared[0], shared[1]);
		}),
	);

	it.effect("re-reads its source on every use, even a nested provide of the same layer value", () =>
		Effect.gen(function* () {
			// One layer value, used twice: once by the outer provide and again by a
			// nested one. A nested provide reuses what the enclosing one built unless
			// the layer is fresh, so the inner read would see the first build's home.
			const env: Record<string, string | undefined> = { HOME: "/home/first" };
			const XdgLive = Xdg.layerFromEnv(env);
			const [outer, inner] = yield* Effect.gen(function* () {
				const outerPaths = yield* Xdg;
				env.HOME = "/home/second";
				const innerPaths = yield* Effect.provide(xdgPaths, XdgLive);
				return [outerPaths.home, innerPaths.home] as const;
			}).pipe(Effect.provide(XdgLive), Effect.provideService(CurrentPlatform, "linux"));
			assert.strictEqual(outer, "/home/first");
			assert.strictEqual(inner, "/home/second");
		}),
	);

	it.effect("reads an empty HOME as unset, failing typed and naming the variable", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(read(Xdg.layerFromEnv({ HOME: "", USERPROFILE: "/Users/ada" })));
			assert.instanceOf(error, XdgEnvError);
			assert.strictEqual(error.variable, "HOME");
		}),
	);

	it.effect("keeps the win32 home order: USERPROFILE, then HOME", () =>
		Effect.gen(function* () {
			const both = yield* read(Xdg.layerFromEnv({ USERPROFILE: "C:\\Users\\ada", HOME: "C:\\msys\\ada" }), "win32");
			assert.strictEqual(both.home, "C:\\Users\\ada");
			const homeOnly = yield* read(Xdg.layerFromEnv({ HOME: "C:\\msys\\ada" }), "win32");
			assert.strictEqual(homeOnly.home, "C:\\msys\\ada");
		}),
	);

	it.effect("does not fall back to USERPROFILE off Windows", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(read(Xdg.layerFromEnv({ USERPROFILE: "/Users/ada" })));
			assert.strictEqual(error.variable, "HOME");
		}),
	);
});
