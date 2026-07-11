import type { ConfigResolver } from "@effected/config-file";
import { Walker } from "@effected/walker";
import { Effect, FileSystem, Option, Path } from "effect";
import { AppDirs } from "./AppDirs.js";
import { NativeDirs } from "./NativeDirs.js";
import { CurrentPlatform, Xdg } from "./Xdg.js";

/**
 * Search the app's XDG config search path for `filename`.
 *
 * @remarks
 * Probes the app's own config directory first, then each `$XDG_CONFIG_DIRS`
 * entry namespaced — `~/.config/myapp/rc`, then `/etc/xdg/myapp/rc`. v3 probed
 * only the first of those; the system search path is half the XDG spec and it
 * was missing.
 *
 * The scan runs through `Walker.firstMatch`, so a failure on one candidate means
 * "this candidate did not match" and the search continues to the next. That is a
 * bug fixed, not a refactor: v3 wrapped the whole resolver in a single
 * `catchAll`, so an unreadable `/etc/xdg` aborted the probe and hid a perfectly
 * readable `~/.config`. Not-found and cannot-look stay indistinguishable to the
 * caller, which is the resolver contract — `resolve`'s error channel is `never`.
 *
 * Place it **before** `nativeResolver` in a chain, so an existing
 * `~/.config/<app>` still wins over the OS-native directory.
 *
 * @public
 */
const resolver = (options: {
	readonly filename: string;
}): ConfigResolver<AppDirs | FileSystem.FileSystem | Path.Path> => ({
	name: "xdg",
	resolve: Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;
		const candidates = appDirs.dirs.configSearchPath.map((dir) => path.join(dir, options.filename));
		return yield* Walker.firstMatch(candidates, (candidate) => fs.exists(candidate));
	}),
});

/**
 * Probe the OS-native config directory for `filename`.
 *
 * @remarks
 * Resolves the native config directory for `namespace`
 * (`~/Library/Application Support/<ns>` on macOS, `%APPDATA%\<ns>` on Windows)
 * and checks whether `filename` is there. On Linux and everywhere else
 * {@link NativeDirs.resolve} yields `Option.none()`, so this resolver returns
 * `Option.none()` without probing at all — the XDG resolver already owns
 * `~/.config` there.
 *
 * Takes `namespace` rather than reading it off {@link AppDirs}: the native
 * directory is a property of the OS convention, not of however the app happened
 * to configure its XDG directories, and a caller may well probe a *different*
 * namespace than the one their `AppDirs` was built for.
 *
 * @public
 */
const nativeResolver = (options: {
	readonly namespace: string;
	readonly filename: string;
}): ConfigResolver<Xdg | FileSystem.FileSystem | Path.Path> => ({
	name: "native",
	resolve: Effect.gen(function* () {
		const paths = yield* Xdg;
		const platform = yield* CurrentPlatform;
		const path = yield* Path.Path;
		const fs = yield* FileSystem.FileSystem;

		const native = NativeDirs.resolve({ platform, namespace: options.namespace, paths, path });
		if (Option.isNone(native)) return Option.none();

		// One candidate, but still through `firstMatch`: the absorption contract is
		// what `ConfigResolver` requires, and it lives in exactly one place.
		return yield* Walker.firstMatch([path.join(native.value.config, options.filename)], (candidate) =>
			fs.exists(candidate),
		);
	}),
});

/**
 * The default save target for a config file: `<app config dir>/<filename>`.
 *
 * @remarks
 * Drops straight into `ConfigFileOptions.defaultPath`, whose slot is typed
 * `Effect<string, never, RR>`. That infallible channel is the whole reason
 * {@link AppDirs} resolves at layer-construction time: with v3's per-access
 * resolution this could fail, and a consumer had to `orDie` it into the slot.
 *
 * It does **not** create the directory — `ConfigFile.save` already `mkdir -p`s
 * the parent of whatever path it is given.
 *
 * @example
 * ```ts
 * const layer = ConfigFile.layer(AppConfig, {
 * 	schema: AppShape,
 * 	codec: ConfigCodec.json,
 * 	strategy: MergeStrategy.firstMatch<AppShape>(),
 * 	resolvers: [XdgConfig.resolver({ filename: "config.json" })],
 * 	defaultPath: XdgConfig.savePath("config.json"),
 * });
 * ```
 *
 * @public
 */
const savePath = (filename: string): Effect.Effect<string, never, AppDirs | Path.Path> =>
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const path = yield* Path.Path;
		return path.join(appDirs.dirs.config, filename);
	});

/**
 * The bridge from XDG directories into `@effected/config-file`.
 *
 * @public
 */
export const XdgConfig = { resolver, nativeResolver, savePath } as const;
