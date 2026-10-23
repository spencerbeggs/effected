import { assert, describe, it } from "@effect/vitest";
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from "effect";
import type { XdgPlatform } from "../src/index.js";
import { CurrentPlatform, Xdg, XdgEnvError, XdgPaths } from "../src/index.js";

/** Drive `Config` from a record instead of mutating the real environment. */
const env = (vars: Record<string, string>) =>
	Layer.provide(Xdg.layer, ConfigProvider.layer(ConfigProvider.fromUnknown(vars)));

/** The same, with the platform pinned so the answer never depends on the host. */
const envOn = (platform: XdgPlatform, vars: Record<string, string>) =>
	Layer.provide(
		Xdg.layer,
		Layer.mergeAll(ConfigProvider.layer(ConfigProvider.fromUnknown(vars)), Layer.succeed(CurrentPlatform, platform)),
	);

describe("Xdg", () => {
	describe("layer", () => {
		it.effect("reads every XDG variable from the environment", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.strictEqual(paths.home, "/home/ada");
				assert.strictEqual(paths.configHome, "/home/ada/.config");
				assert.strictEqual(paths.dataHome, "/home/ada/.local/share");
				assert.strictEqual(paths.cacheHome, "/home/ada/.cache");
				assert.strictEqual(paths.stateHome, "/home/ada/.local/state");
				assert.strictEqual(paths.runtimeDir, "/run/user/1000");
				assert.strictEqual(paths.appData, "C:\\Users\\ada\\AppData\\Roaming");
				assert.strictEqual(paths.localAppData, "C:\\Users\\ada\\AppData\\Local");
			}).pipe(
				Effect.provide(
					env({
						HOME: "/home/ada",
						XDG_CONFIG_HOME: "/home/ada/.config",
						XDG_DATA_HOME: "/home/ada/.local/share",
						XDG_CACHE_HOME: "/home/ada/.cache",
						XDG_STATE_HOME: "/home/ada/.local/state",
						XDG_RUNTIME_DIR: "/run/user/1000",
						APPDATA: "C:\\Users\\ada\\AppData\\Roaming",
						LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local",
					}),
				),
			),
		);

		it.effect("leaves an unset variable as an absent key, not undefined", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.isFalse("configHome" in paths);
				assert.isFalse("runtimeDir" in paths);
				assert.isUndefined(paths.configHome);
			}).pipe(Effect.provide(env({ HOME: "/home/ada" }))),
		);

		it.effect("fails with XdgEnvError, not a raw ConfigError, when HOME is unset", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Effect.provide(Effect.void, envOn("linux", {})));
				assert.instanceOf(error, XdgEnvError);
				assert.strictEqual(error._tag, "XdgEnvError");
				assert.strictEqual(error.variable, "HOME");
				assert.include(error.message, "HOME");
				// The ConfigError is preserved structurally rather than stringified.
				assert.strictEqual((error.cause as { _tag?: string })._tag, "ConfigError");
			}),
		);

		it.effect("HOME being unset is a typed failure, never a defect", () =>
			Effect.gen(function* () {
				const exit = yield* Effect.exit(Effect.provide(Effect.void, envOn("linux", {})));
				const cause = Exit.getCause(exit);
				assert.isTrue(Option.isSome(cause));
				const reasons = Option.getOrThrow(cause).reasons;
				assert.isTrue(reasons.some(Cause.isFailReason));
				assert.isFalse(reasons.some(Cause.isDieReason));
			}),
		);
	});

	describe("search paths", () => {
		it.effect("splits XDG_CONFIG_DIRS and XDG_DATA_DIRS on the colon", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.deepStrictEqual([...paths.configDirs], ["/etc/xdg", "/opt/xdg"]);
				assert.deepStrictEqual([...paths.dataDirs], ["/opt/share", "/usr/share"]);
			}).pipe(
				Effect.provide(
					envOn("linux", {
						HOME: "/home/ada",
						XDG_CONFIG_DIRS: "/etc/xdg:/opt/xdg",
						XDG_DATA_DIRS: "/opt/share:/usr/share",
					}),
				),
			),
		);

		it.effect("defaults the system search paths per the spec when unset", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.deepStrictEqual([...paths.configDirs], ["/etc/xdg"]);
				assert.deepStrictEqual([...paths.dataDirs], ["/usr/local/share", "/usr/share"]);
			}).pipe(Effect.provide(env({ HOME: "/home/ada" }))),
		);

		it.effect("treats an EMPTY XDG_CONFIG_DIRS as unset, per the spec", () =>
			Effect.gen(function* () {
				// The spec is explicit: an empty value takes the default, it does not
				// mean "no system directories". A naive `split(":")` would yield [""].
				const paths = yield* Xdg;
				assert.deepStrictEqual([...paths.configDirs], ["/etc/xdg"]);
			}).pipe(Effect.provide(env({ HOME: "/home/ada", XDG_CONFIG_DIRS: "" }))),
		);

		it.effect("drops empty entries from a partially-empty list", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.deepStrictEqual([...paths.configDirs], ["/a", "/b"]);
			}).pipe(Effect.provide(envOn("linux", { HOME: "/home/ada", XDG_CONFIG_DIRS: "/a::/b:" }))),
		);
	});

	describe("relative values are ignored, per the XDG spec", () => {
		it.effect("drops a relative XDG_*_HOME and XDG_RUNTIME_DIR to an absent key", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				// Each kind is relative but one, so a check wired to only the first
				// variable (or to none) is caught by the kinds after it.
				assert.isFalse("configHome" in paths);
				assert.isFalse("dataHome" in paths);
				assert.isFalse("cacheHome" in paths);
				assert.strictEqual(paths.stateHome, "/abs/state");
				assert.isFalse("runtimeDir" in paths);
			}).pipe(
				Effect.provide(
					envOn("linux", {
						HOME: "/home/ada",
						XDG_CONFIG_HOME: "rel/cfg",
						XDG_DATA_HOME: "./data",
						XDG_CACHE_HOME: "cache",
						XDG_STATE_HOME: "/abs/state",
						XDG_RUNTIME_DIR: "run",
					}),
				),
			),
		);

		it.effect("drops relative entries from XDG_CONFIG_DIRS and XDG_DATA_DIRS", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.deepStrictEqual([...paths.configDirs], ["/etc/xdg"]);
				assert.deepStrictEqual([...paths.dataDirs], ["/opt/share"]);
			}).pipe(
				Effect.provide(
					envOn("linux", { HOME: "/home/ada", XDG_CONFIG_DIRS: "rel:/etc/xdg", XDG_DATA_DIRS: "/opt/share:share" }),
				),
			),
		);

		it.effect("an all-relative search path takes the spec default, as an empty one does", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.deepStrictEqual([...paths.configDirs], ["/etc/xdg"]);
				assert.deepStrictEqual([...paths.dataDirs], ["/usr/local/share", "/usr/share"]);
			}).pipe(Effect.provide(envOn("linux", { HOME: "/home/ada", XDG_CONFIG_DIRS: "rel", XDG_DATA_DIRS: "a:b" }))),
		);

		it.effect("judges XDG_* by the platform rule: a drive path is relative on linux", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.isFalse("configHome" in paths);
				assert.strictEqual(paths.cacheHome, "/xdg/cache");
			}).pipe(
				Effect.provide(envOn("linux", { HOME: "/home/ada", XDG_CONFIG_HOME: "C:\\x", XDG_CACHE_HOME: "/xdg/cache" })),
			),
		);

		it.effect("judges XDG_* by the platform rule: drive and rooted paths are absolute on win32", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.strictEqual(paths.configHome, "D:\\xdg");
				assert.strictEqual(paths.cacheHome, "/xdg");
				assert.strictEqual(paths.stateHome, "\\xdg\\state");
				assert.isFalse("dataHome" in paths);
			}).pipe(
				Effect.provide(
					envOn("win32", {
						USERPROFILE: "C:\\Users\\ada",
						XDG_CONFIG_HOME: "D:\\xdg",
						XDG_CACHE_HOME: "/xdg",
						XDG_STATE_HOME: "\\xdg\\state",
						XDG_DATA_HOME: "xdg\\data",
					}),
				),
			),
		);

		it.effect("judges APPDATA and LOCALAPPDATA by the Windows rule on every host", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				// Pinned to linux: a Windows drive path still survives here, because
				// only the win32 native rung reads these, and a relative one is dropped.
				assert.strictEqual(paths.appData, "C:\\Users\\ada\\AppData\\Roaming");
				assert.isFalse("localAppData" in paths);
			}).pipe(
				Effect.provide(
					envOn("linux", { HOME: "/home/ada", APPDATA: "C:\\Users\\ada\\AppData\\Roaming", LOCALAPPDATA: "Local" }),
				),
			),
		);

		it.effect("drops a relative APPDATA on win32", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.isFalse("appData" in paths);
				assert.strictEqual(paths.localAppData, "C:\\Users\\ada\\AppData\\Local");
			}).pipe(
				Effect.provide(
					envOn("win32", {
						USERPROFILE: "C:\\Users\\ada",
						APPDATA: "Roaming",
						LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local",
					}),
				),
			),
		);

		it.effect("leaves the home directory unvalidated", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.strictEqual(paths.home, "relative/home");
			}).pipe(Effect.provide(envOn("linux", { HOME: "relative/home" }))),
		);
	});

	describe("win32 search paths", () => {
		it.effect("splits on ';' so a drive-letter entry survives whole", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.deepStrictEqual([...paths.configDirs], ["C:\\ProgramData\\xdg", "D:\\etc\\xdg"]);
				assert.deepStrictEqual([...paths.dataDirs], ["C:\\ProgramData\\share"]);
			}).pipe(
				Effect.provide(
					envOn("win32", {
						USERPROFILE: "C:\\Users\\ada",
						XDG_CONFIG_DIRS: "C:\\ProgramData\\xdg;D:\\etc\\xdg",
						XDG_DATA_DIRS: "rel;C:\\ProgramData\\share",
					}),
				),
			),
		);

		it.effect("still splits on ':' everywhere else", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.deepStrictEqual([...paths.configDirs], ["/a", "/b"]);
			}).pipe(Effect.provide(envOn("darwin", { HOME: "/Users/ada", XDG_CONFIG_DIRS: "/a:/b" }))),
		);
	});

	describe("the home directory", () => {
		it.effect("reads USERPROFILE on win32 when HOME is unset", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.strictEqual(paths.home, "C:\\Users\\ada");
			}).pipe(Effect.provide(envOn("win32", { USERPROFILE: "C:\\Users\\ada" }))),
		);

		it.effect("prefers USERPROFILE over HOME on win32", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.strictEqual(paths.home, "C:\\Users\\ada");
			}).pipe(Effect.provide(envOn("win32", { USERPROFILE: "C:\\Users\\ada", HOME: "/c/Users/msys" }))),
		);

		it.effect("falls back to HOME on win32 when USERPROFILE is unset", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.strictEqual(paths.home, "/c/Users/ada");
			}).pipe(Effect.provide(envOn("win32", { HOME: "/c/Users/ada" }))),
		);

		it.effect("fails naming USERPROFILE on win32 when neither variable is set", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Effect.provide(Effect.void, envOn("win32", {})));
				assert.instanceOf(error, XdgEnvError);
				assert.strictEqual(error.variable, "USERPROFILE");
				assert.strictEqual(error.message, "Neither the USERPROFILE nor the HOME environment variable is set");
			}),
		);

		it.effect("never reads USERPROFILE off win32", () =>
			Effect.gen(function* () {
				const error = yield* Effect.flip(Effect.provide(Effect.void, envOn("linux", { USERPROFILE: "/home/ada" })));
				assert.strictEqual(error.variable, "HOME");
				assert.strictEqual(error.message, "The HOME environment variable is not set");
			}),
		);

		it.effect("prefers HOME over USERPROFILE off win32 (control for the win32 order)", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.strictEqual(paths.home, "/home/ada");
			}).pipe(Effect.provide(envOn("darwin", { HOME: "/home/ada", USERPROFILE: "/elsewhere" }))),
		);
	});

	describe("layerFrom", () => {
		it.effect("serves fixed paths without reading the environment at all", () =>
			Effect.gen(function* () {
				const paths = yield* Xdg;
				assert.strictEqual(paths.home, "/fixture");
				assert.deepStrictEqual([...paths.configDirs], ["/etc/xdg"]);
			}).pipe(
				Effect.provide(
					Xdg.layerFrom(XdgPaths.make({ home: "/fixture", configDirs: ["/etc/xdg"], dataDirs: ["/usr/share"] })),
				),
			),
		);
	});
});
