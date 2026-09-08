import { assert, describe, it } from "@effect/vitest";
import { ConfigFile, ConfigFileNotFoundError, ConfigResolver, JsonCodec } from "@effected/config-file";
import { MemoryFileSystem } from "@effected/memfs";
import { AppDirs, CurrentPlatform, Xdg, XdgPaths } from "@effected/xdg";
import type { FileSystem } from "effect";
import { Effect, Layer, Path, Schema } from "effect";
import type { AppConfigOptions } from "../src/index.js";
import { AppConfig } from "../src/index.js";

class Shape extends Schema.Class<Shape>("Shape")({ from: Schema.String }) {}
class ChainConfig extends ConfigFile.Service<ChainConfig, Shape>()("app-test/ChainConfig") {}

const xdgPaths = XdgPaths.make({
	home: "/home/test",
	configHome: "/home/test/.config",
	configDirs: ["/etc/xdg"],
	dataDirs: ["/usr/share"],
});

const doc = (from: string): string => JSON.stringify({ from });

/** A real in-memory volume seeded with whole files, plus the xdg services. */
const harness = (files: Record<string, string>, platform: "linux" | "darwin" = "linux") =>
	Layer.provideMerge(
		AppDirs.layer({ namespace: "myapp" }),
		Layer.mergeAll(
			Path.layer,
			MemoryFileSystem.layerWith(files),
			Layer.succeed(CurrentPlatform, platform),
			Xdg.layerFrom(xdgPaths),
		),
	);

/** The caller-resolver requirements every chain here uses: the platform pair. */
type ChainOptions = AppConfigOptions<Shape, { readonly from: string }, FileSystem.FileSystem | Path.Path>;

const chain = (options: ChainOptions) => AppConfig.layer(ChainConfig, options);

const loadWith = (options: ChainOptions, files: Record<string, string>, platform: "linux" | "darwin" = "linux") =>
	Effect.gen(function* () {
		const config = yield* ChainConfig;
		return yield* config.load;
	}).pipe(Effect.provide(chain(options).pipe(Layer.provide(harness(files, platform)))));

describe("AppConfig.layer xdg", () => {
	// The control: the same seed, with the XDG tier left in, loads the XDG file.
	it.effect("probes the XDG search path by default", () =>
		Effect.gen(function* () {
			const value = yield* loadWith(
				{ filename: "rc.json", schema: Shape, codec: JsonCodec },
				{
					"/home/test/.config/myapp/rc.json": doc("xdg"),
				},
			);
			assert.strictEqual(value.from, "xdg");
		}),
	);

	it.effect("xdg: false drops the XDG tier entirely", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				loadWith(
					{ filename: "rc.json", schema: Shape, codec: JsonCodec, xdg: false },
					{
						"/home/test/.config/myapp/rc.json": doc("xdg"),
					},
				),
			);
			assert.instanceOf(error, ConfigFileNotFoundError);
			// Nothing XDG-shaped was even probed.
			assert.deepStrictEqual([...error.searched], []);
		}),
	);

	it.effect("xdg: false leaves the caller's own resolvers in charge", () =>
		Effect.gen(function* () {
			const value = yield* loadWith(
				{
					filename: "rc.json",
					schema: Shape,
					codec: JsonCodec,
					xdg: false,
					resolvers: [ConfigResolver.explicitPath("/explicit/rc.json")],
				},
				{ "/explicit/rc.json": doc("explicit"), "/home/test/.config/myapp/rc.json": doc("xdg") },
			);
			assert.strictEqual(value.from, "explicit");
		}),
	);

	// The native probe is the tail of the XDG fallback chain, not a tier of its
	// own, so `xdg: false` must take it with it — `native` left at its default.
	it.effect("xdg: false drops the native probe too", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				loadWith(
					{ filename: "rc.json", schema: Shape, codec: JsonCodec, xdg: false },
					{ "/home/test/Library/Application Support/myapp/rc.json": doc("native") },
					"darwin",
				),
			);
			assert.instanceOf(error, ConfigFileNotFoundError);
		}),
	);
});

describe("AppConfig.layer systemEtc", () => {
	it.effect("is absent by default", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				loadWith(
					{ filename: "rc.json", schema: Shape, codec: JsonCodec },
					{
						"/etc/myapp/rc.json": doc("system"),
					},
				),
			);
			assert.instanceOf(error, ConfigFileNotFoundError);
		}),
	);

	it.effect("appends the system tier, namespaced from the ambient AppDirs", () =>
		Effect.gen(function* () {
			const value = yield* loadWith(
				{ filename: "rc.json", schema: Shape, codec: JsonCodec, systemEtc: true },
				{
					"/etc/myapp/rc.json": doc("system"),
				},
			);
			assert.strictEqual(value.from, "system");
		}),
	);

	it.effect("puts the system tier BEHIND the user's XDG config", () =>
		Effect.gen(function* () {
			const value = yield* loadWith(
				{ filename: "rc.json", schema: Shape, codec: JsonCodec, systemEtc: true },
				{
					"/etc/myapp/rc.json": doc("system"),
					"/home/test/.config/myapp/rc.json": doc("xdg"),
				},
			);
			assert.strictEqual(value.from, "xdg");
		}),
	);

	it.effect("honors an overridden system root", () =>
		Effect.gen(function* () {
			const value = yield* loadWith(
				{ filename: "rc.json", schema: Shape, codec: JsonCodec, systemEtc: { dir: "/sandbox/etc" } },
				{ "/sandbox/etc/myapp/rc.json": doc("sandbox"), "/etc/myapp/rc.json": doc("system") },
			);
			assert.strictEqual(value.from, "sandbox");
		}),
	);
});

describe("AppConfig.layer resolversAfter", () => {
	it.effect("appends behind every built-in tier", () =>
		Effect.gen(function* () {
			const value = yield* loadWith(
				{
					filename: "rc.json",
					schema: Shape,
					codec: JsonCodec,
					systemEtc: true,
					resolversAfter: [ConfigResolver.staticDir({ dir: "/fallback", filename: "rc.json" })],
				},
				{
					"/fallback/rc.json": doc("after"),
					"/etc/myapp/rc.json": doc("system"),
					"/home/test/.config/myapp/rc.json": doc("xdg"),
				},
			);
			assert.strictEqual(value.from, "xdg");
		}),
	);

	it.effect("wins when every tier ahead of it finds nothing", () =>
		Effect.gen(function* () {
			const value = yield* loadWith(
				{
					filename: "rc.json",
					schema: Shape,
					codec: JsonCodec,
					resolversAfter: [ConfigResolver.staticDir({ dir: "/fallback", filename: "rc.json" })],
				},
				{ "/fallback/rc.json": doc("after") },
			);
			assert.strictEqual(value.from, "after");
		}),
	);
});

// The cluster's real target: one `AppConfig.layer` call expresses a CLI's whole
// chain — a config-dir upward walk, no XDG probe, a system tier — and the
// discovered source reports which candidate matched. Both packages run for
// real: the resolver and its match come from `@effected/config-file`, the
// chain assembly and `defaultPath` from `@effected/app`.
describe("AppConfig.layer end to end with a config-file walk", () => {
	const options = {
		filename: "rc.json",
		schema: Shape,
		codec: JsonCodec,
		xdg: false,
		resolvers: [
			ConfigResolver.upwardWalk({
				filenames: [".myapp.json", "myapp.json", ".config/myapp.json"],
				cwd: "/repo/pkg",
				name: "walk:project",
			}),
		],
		systemEtc: true,
	} satisfies ChainOptions;

	const files = {
		"/repo/pkg/myapp.json": doc("project"),
		"/repo/.myapp.json": doc("ancestor"),
		"/etc/myapp/rc.json": doc("system"),
	};

	it.effect("prefers the nearer directory's later candidate over an ancestor's first", () =>
		Effect.gen(function* () {
			const value = yield* loadWith(options, files);
			assert.strictEqual(value.from, "project");
		}),
	);

	it.effect("reports the anchor directory and the caller's resolver name", () =>
		Effect.gen(function* () {
			const config = yield* ChainConfig;
			const sources = yield* config.discover;
			assert.strictEqual(sources[0]?.resolver, "walk:project");
			assert.strictEqual(sources[0]?.match?.dir, "/repo/pkg");
			assert.strictEqual(sources[0]?.match?.filename, "myapp.json");
			// The system tier is still there, behind the walk.
			assert.strictEqual(sources[1]?.resolver, "system");
			assert.strictEqual(sources[1]?.match?.dir, "/etc/myapp");
		}).pipe(Effect.provide(chain(options).pipe(Layer.provide(harness(files))))),
	);

	it.effect("still saves through the XDG default path with the XDG tier dropped", () =>
		Effect.gen(function* () {
			const config = yield* ChainConfig;
			const written = yield* config.save(Shape.make({ from: "saved" }));
			assert.strictEqual(written, "/home/test/.config/myapp/rc.json");
			const reread = yield* config.loadFrom(written);
			assert.strictEqual(reread.from, "saved");
		}).pipe(Effect.provide(chain(options).pipe(Layer.provide(harness(files))))),
	);
});
