import { assert, describe, it } from "@effect/vitest";
import { Cause, ConfigProvider, Effect, Exit, Layer } from "effect";
import type { XdgEnvOptions, XdgPlatform } from "../src/index.js";
import { CurrentPlatform, Xdg, XdgEnvError } from "../src/index.js";

const xdgPaths = Effect.gen(function* () {
	return yield* Xdg;
});

/** Read `Xdg` from `layer`, with the platform pinned. */
const read = (layer: Layer.Layer<Xdg, XdgEnvError>, platform: XdgPlatform = "linux") =>
	Effect.provide(xdgPaths, Layer.provide(layer, Layer.succeed(CurrentPlatform, platform)));

/** `Xdg.layerWith(options)` over an ambient provider built from `env`. */
const withAmbient = (env: Record<string, string>, options: XdgEnvOptions) =>
	Layer.provide(Xdg.layerWith(options), ConfigProvider.layer(ConfigProvider.fromEnvRecord(env)));

/** A home fallback that counts its calls. */
const counted = (home: string) => {
	const calls = { count: 0 };
	const fallback = () => {
		calls.count++;
		return home;
	};
	return { calls, fallback };
};

const RELATIVE = {
	HOME: "/home/ada",
	XDG_CONFIG_HOME: "rel/config",
	XDG_DATA_HOME: "./data",
	XDG_CACHE_HOME: "/abs/cache",
	XDG_STATE_HOME: "rel/state",
	XDG_RUNTIME_DIR: "rel/run",
	XDG_CONFIG_DIRS: "rel:/etc/a",
};

describe("XdgEnvOptions: the defaults are the specification", () => {
	it.effect("layerWith({}) and layerFromEnv(env, {}) resolve what Xdg.layer resolves", () =>
		Effect.gen(function* () {
			const spec = yield* read(Layer.provide(Xdg.layer, ConfigProvider.layer(ConfigProvider.fromEnvRecord(RELATIVE))));
			assert.deepStrictEqual(yield* read(withAmbient(RELATIVE, {})), spec);
			assert.deepStrictEqual(yield* read(Xdg.layerFromEnv(RELATIVE, {})), spec);
			assert.deepStrictEqual(yield* read(withAmbient(RELATIVE, { relativeHomes: "ignore" })), spec);
			assert.isUndefined(spec.configHome);
			assert.strictEqual(spec.cacheHome, "/abs/cache");
		}),
	);

	it.effect("without a fallback, a missing home still fails", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(read(Xdg.layerFromEnv({}, {})));
			assert.instanceOf(error, XdgEnvError);
			assert.strictEqual(error.variable, "HOME");
		}),
	);
});

describe("XdgEnvOptions.relativeHomes", () => {
	it.effect('"keep" uses a relative XDG_*_HOME as given, on both reading layers', () =>
		Effect.gen(function* () {
			for (const layer of [
				withAmbient(RELATIVE, { relativeHomes: "keep" }),
				Xdg.layerFromEnv(RELATIVE, { relativeHomes: "keep" }),
			]) {
				const paths = yield* read(layer);
				assert.strictEqual(paths.configHome, "rel/config");
				assert.strictEqual(paths.dataHome, "./data");
				assert.strictEqual(paths.cacheHome, "/abs/cache");
				assert.strictEqual(paths.stateHome, "rel/state");
			}
		}),
	);

	it.effect('"keep" leaves XDG_RUNTIME_DIR and the search paths to the specification', () =>
		Effect.gen(function* () {
			const paths = yield* read(Xdg.layerFromEnv(RELATIVE, { relativeHomes: "keep" }));
			assert.isUndefined(paths.runtimeDir);
			assert.deepStrictEqual(paths.configDirs, ["/etc/a"]);
		}),
	);

	it.effect('"keep" still reads an empty value as unset, as a shell :- does', () =>
		Effect.gen(function* () {
			const paths = yield* read(Xdg.layerFromEnv({ HOME: "/h", XDG_STATE_HOME: "" }, { relativeHomes: "keep" }));
			assert.isUndefined(paths.stateHome);
		}),
	);

	it.effect('"keep" on win32 keeps a drive-relative value the win32 rule would drop', () =>
		Effect.gen(function* () {
			const env = { USERPROFILE: "C:\\Users\\ada", XDG_STATE_HOME: "state" };
			assert.isUndefined((yield* read(Xdg.layerFromEnv(env), "win32")).stateHome);
			assert.strictEqual((yield* read(Xdg.layerFromEnv(env, { relativeHomes: "keep" }), "win32")).stateHome, "state");
		}),
	);
});

describe("XdgEnvOptions.homeFallback", () => {
	it.effect("an unset HOME takes the fallback, on both reading layers", () =>
		Effect.gen(function* () {
			const { calls, fallback } = counted("/os/home");
			assert.strictEqual((yield* read(Xdg.layerFromEnv({}, { homeFallback: fallback }))).home, "/os/home");
			assert.strictEqual((yield* read(withAmbient({}, { homeFallback: fallback }))).home, "/os/home");
			assert.strictEqual(calls.count, 2);
		}),
	);

	it.effect("an empty HOME takes the fallback too", () =>
		Effect.gen(function* () {
			const { fallback } = counted("/os/home");
			assert.strictEqual((yield* read(Xdg.layerFromEnv({ HOME: "" }, { homeFallback: fallback }))).home, "/os/home");
		}),
	);

	it.effect("a set HOME wins, even a relative one, and the fallback is never called", () =>
		Effect.gen(function* () {
			const { calls, fallback } = counted("/os/home");
			assert.strictEqual(
				(yield* read(Xdg.layerFromEnv({ HOME: "/home/ada" }, { homeFallback: fallback }))).home,
				"/home/ada",
			);
			assert.strictEqual((yield* read(Xdg.layerFromEnv({ HOME: "rel" }, { homeFallback: fallback }))).home, "rel");
			assert.strictEqual(calls.count, 0);
		}),
	);

	it.effect("on win32 the fallback replaces only a missing USERPROFILE and HOME", () =>
		Effect.gen(function* () {
			const { calls, fallback } = counted("C:\\os\\home");
			const viaHome = yield* read(Xdg.layerFromEnv({ HOME: "/c/Users/ada" }, { homeFallback: fallback }), "win32");
			assert.strictEqual(viaHome.home, "/c/Users/ada");
			assert.strictEqual(calls.count, 0);
			assert.strictEqual((yield* read(Xdg.layerFromEnv({}, { homeFallback: fallback }), "win32")).home, "C:\\os\\home");
			assert.strictEqual(calls.count, 1);
		}),
	);

	it.effect("an empty fallback fails with the variable's own XdgEnvError", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(read(Xdg.layerFromEnv({}, { homeFallback: () => "" })));
			assert.instanceOf(error, XdgEnvError);
			assert.strictEqual(error.variable, "HOME");
			const win = yield* Effect.flip(read(Xdg.layerFromEnv({}, { homeFallback: () => "" }), "win32"));
			assert.strictEqual(win.variable, "USERPROFILE");
		}),
	);

	it.effect("a fallback that throws is a defect, not a typed failure", () =>
		Effect.gen(function* () {
			const boom = new Error("no home");
			const exit = yield* Effect.exit(
				read(
					Xdg.layerFromEnv(
						{},
						{
							homeFallback: () => {
								throw boom;
							},
						},
					),
				),
			);
			if (Exit.isFailure(exit)) {
				assert.isFalse(exit.cause.reasons.some(Cause.isFailReason));
				assert.deepStrictEqual(
					exit.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect),
					[boom],
				);
			} else {
				assert.fail("expected a defect, but the layer built");
			}
		}),
	);

	it.effect("a provider that cannot be read still fails typed: the fallback replaces a missing home only", () =>
		Effect.gen(function* () {
			const { calls, fallback } = counted("/os/home");
			const broken = ConfigProvider.make(() => Effect.fail(new ConfigProvider.SourceError({ message: "unreadable" })));
			const error = yield* Effect.flip(
				read(Layer.provide(Xdg.layerWith({ homeFallback: fallback }), ConfigProvider.layer(broken))),
			);
			assert.instanceOf(error, XdgEnvError);
			assert.strictEqual(error.variable, "HOME");
			assert.strictEqual(calls.count, 0);
		}),
	);
});
