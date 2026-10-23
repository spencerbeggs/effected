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
 * Win32 rows are omitted because core's `Path.layer` is posix-only, so xdg's
 * joins would not produce Windows separators here.
 */
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
						Path.layer,
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
});
