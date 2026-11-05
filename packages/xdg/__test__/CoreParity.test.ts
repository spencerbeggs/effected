import { win32 } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { ConfigProvider, Effect, Layer, Path } from "effect";
import { UserDirectories } from "effect/persistence";
import type { XdgPlatform } from "../src/index.js";
import { AppDirs, CurrentPlatform, Xdg } from "../src/index.js";

/**
 * A differential oracle against core's `UserDirectories`, over the subset where
 * the two are AGREED to resolve the same directories: an absolute `XDG_*_HOME`
 * on any platform, and the darwin native directories with `native: true`.
 *
 * Tracks a module core marks `@stability unstable`. A failure here means core
 * moved, not necessarily that xdg is wrong — read the change, then update this
 * oracle or xdg on purpose. Where the two deliberately differ (xdg's `~/.<ns>`
 * floor on Linux, its eager failure on a missing home, its `*_DIRS` search
 * paths) there is no row: see the okf decision
 * `xdg-stays-independent-of-core-userdirectories`.
 *
 * Core ships no win32 `Path` layer, so the win32 rows build one from
 * `node:path`'s `win32` functions with `Path.make`. Resolution never reaches
 * `fromFileUrl` or `toFileUrl`, so those die if called.
 */
const win32Path = Path.make({
	sep: win32.sep,
	basename: win32.basename,
	dirname: win32.dirname,
	extname: win32.extname,
	format: win32.format,
	fromFileUrl: () => Effect.die("fromFileUrl is not part of resolution"),
	isAbsolute: win32.isAbsolute,
	join: win32.join,
	normalize: win32.normalize,
	parse: win32.parse,
	relative: win32.relative,
	resolve: win32.resolve,
	toFileUrl: () => Effect.die("toFileUrl is not part of resolution"),
	toNamespacedPath: win32.toNamespacedPath,
});

const compare = (platform: XdgPlatform, env: Record<string, string>) =>
	Effect.gen(function* () {
		const core = UserDirectories.make({ platform });
		const coreDirs = {
			config: yield* core.config("myapp"),
			data: yield* core.data("myapp"),
			cache: yield* core.cache("myapp"),
			state: yield* core.state("myapp"),
		};
		const xdg = (yield* AppDirs).dirs;
		return { coreDirs, xdgDirs: { config: xdg.config, data: xdg.data, cache: xdg.cache, state: xdg.state } };
	}).pipe(
		Effect.provide(
			AppDirs.layer({ namespace: "myapp", native: true }).pipe(
				Layer.provide(Xdg.layer),
				Layer.provide(
					Layer.mergeAll(
						platform === "win32" ? Layer.succeed(Path.Path, win32Path) : Path.layer,
						MemoryFileSystem.layer,
						ConfigProvider.layer(ConfigProvider.fromUnknown(env)),
						Layer.succeed(CurrentPlatform, platform),
					),
				),
			),
		),
		// Core reads the environment per call, from the program's own provider —
		// the one inside the layer stack above is not visible out here.
		Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env))),
	);

describe("parity with core UserDirectories (unstable core module)", () => {
	it.effect("darwin native directories agree for every kind", () =>
		Effect.gen(function* () {
			const { coreDirs, xdgDirs } = yield* compare("darwin", { HOME: "/Users/ada" });
			assert.deepStrictEqual(xdgDirs, coreDirs);
			// Non-vacuity: cache is the kind that differs from the other three.
			assert.notStrictEqual(xdgDirs.cache, xdgDirs.config);
		}),
	);

	it.effect("absolute XDG_*_HOME values agree on linux for every kind", () =>
		Effect.gen(function* () {
			const { coreDirs, xdgDirs } = yield* compare("linux", {
				HOME: "/home/ada",
				XDG_CONFIG_HOME: "/x/cfg",
				XDG_DATA_HOME: "/x/data",
				XDG_CACHE_HOME: "/x/cache",
				XDG_STATE_HOME: "/x/state",
			});
			assert.deepStrictEqual(xdgDirs, coreDirs);
		}),
	);

	it.effect("a relative XDG_CONFIG_HOME is ignored by both on darwin", () =>
		Effect.gen(function* () {
			const { coreDirs, xdgDirs } = yield* compare("darwin", { HOME: "/Users/ada", XDG_CONFIG_HOME: "rel/cfg" });
			assert.strictEqual(xdgDirs.config, coreDirs.config);
			assert.strictEqual(xdgDirs.config, "/Users/ada/Library/Application Support/myapp");
		}),
	);

	const winHome = {
		USERPROFILE: "C:\\Users\\ada",
		APPDATA: "C:\\Users\\ada\\AppData\\Roaming",
		LOCALAPPDATA: "C:\\Users\\ada\\AppData\\Local",
	};

	it.effect("win32 native directories agree for every kind", () =>
		Effect.gen(function* () {
			const { coreDirs, xdgDirs } = yield* compare("win32", winHome);
			assert.deepStrictEqual(xdgDirs, coreDirs);
			// Non-vacuity: Windows separators, and cache is not config.
			assert.include(xdgDirs.config, "\\");
			assert.notStrictEqual(xdgDirs.cache, xdgDirs.config);
		}),
	);

	it.effect("win32 agrees on the home-derived fallback with APPDATA and LOCALAPPDATA unset", () =>
		Effect.gen(function* () {
			const { coreDirs, xdgDirs } = yield* compare("win32", { USERPROFILE: "C:\\Users\\ada" });
			assert.deepStrictEqual(xdgDirs, coreDirs);
			assert.include(xdgDirs.config, "\\");
			assert.notStrictEqual(xdgDirs.cache, xdgDirs.config);
		}),
	);

	it.effect("a relative APPDATA is ignored by both on win32", () =>
		Effect.gen(function* () {
			const { coreDirs, xdgDirs } = yield* compare("win32", { ...winHome, APPDATA: "rel\\roaming" });
			assert.deepStrictEqual(xdgDirs, coreDirs);
			assert.include(xdgDirs.config, "\\");
			assert.notInclude(xdgDirs.config, "rel");
		}),
	);
});
