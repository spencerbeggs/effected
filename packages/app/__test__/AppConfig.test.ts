import { assert, describe, it } from "@effect/vitest";
import { ConfigFile, JsonCodec } from "@effected/config-file";
import { AppDirs, CurrentPlatform, Xdg, XdgPaths } from "@effected/xdg";
import { Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import type { AppConfigOptions } from "../src/index.js";
import { AppConfig } from "../src/index.js";
import { filenameGuardCases } from "./filenameGuard.js";

class Shape extends Schema.Class<Shape>("Shape")({ port: Schema.Number }) {}
class TestConfig extends ConfigFile.Service<TestConfig, Shape>()("app-test/Config") {}

const xdgPaths = XdgPaths.make({
	home: "/home/test",
	configHome: "/home/test/.config",
	configDirs: ["/etc/xdg"],
	dataDirs: ["/usr/share"],
});

/** A hermetic FileSystem: `exists` answers from a fixed set, reads are canned. */
const fakeFs = (options?: { readonly present?: ReadonlyArray<string>; readonly written?: Array<string> }) =>
	FileSystem.layerNoop({
		exists: (candidate) => Effect.succeed(options?.present?.includes(candidate) ?? false),
		readFileString: () => Effect.succeed(`{"port":4242}`),
		makeDirectory: () => Effect.void,
		writeFileString: (target) =>
			Effect.suspend(() => {
				options?.written?.push(target);
				return Effect.void;
			}),
	});

const harnessWith = (fs: Layer.Layer<FileSystem.FileSystem>, platform: "linux" | "darwin" = "linux") => {
	const base = Layer.mergeAll(Path.layer, fs, Layer.succeed(CurrentPlatform, platform), Xdg.layerFrom(xdgPaths));
	return Layer.provideMerge(AppDirs.layer({ namespace: "myapp" }), base);
};

const configLayer = (options: AppConfigOptions<Shape, { readonly port: number }>) =>
	AppConfig.layer(TestConfig, options);

describe("AppConfig.layer", () => {
	describe("the filename guard", () => {
		filenameGuardCases((filename) =>
			Effect.exit(
				Effect.provide(
					Effect.void,
					configLayer({ filename, schema: Shape, codec: JsonCodec }).pipe(Layer.provide(harnessWith(fakeFs()))),
				),
			),
		);

		it.effect("a plain filename builds the layer cleanly", () =>
			Effect.gen(function* () {
				// Unlike the database glue, config construction does no IO at all, so
				// a good filename must BUILD under the stub filesystem.
				const exit = yield* Effect.exit(
					Effect.provide(
						Effect.void,
						configLayer({ filename: "rc.json", schema: Shape, codec: JsonCodec }).pipe(
							Layer.provide(harnessWith(fakeFs())),
						),
					),
				);
				assert.isTrue(Exit.isSuccess(exit));
			}),
		);
	});

	describe("the ambient namespace", () => {
		it.effect("discovers through the app's XDG config search path, namespace read from AppDirs", () =>
			Effect.gen(function* () {
				// The ONLY namespace in this test is the one AppDirs was built with.
				// If AppConfig ever grows a namespace option, this test must fail.
				const cfg = yield* TestConfig;
				const value = yield* cfg.load;
				assert.instanceOf(value, Shape);
				assert.strictEqual(value.port, 4242);
			}).pipe(
				Effect.provide(
					configLayer({ filename: "rc.json", schema: Shape, codec: JsonCodec }).pipe(
						Layer.provide(harnessWith(fakeFs({ present: ["/home/test/.config/myapp/rc.json"] }))),
					),
				),
			),
		);

		it.effect("saves into the app's own config directory", () =>
			Effect.gen(function* () {
				const written: Array<string> = [];
				const target = yield* Effect.gen(function* () {
					const cfg = yield* TestConfig;
					return yield* cfg.save(Shape.make({ port: 9000 }));
				}).pipe(
					Effect.provide(
						configLayer({ filename: "rc.json", schema: Shape, codec: JsonCodec }).pipe(
							Layer.provide(harnessWith(fakeFs({ written }))),
						),
					),
				);
				assert.strictEqual(target, "/home/test/.config/myapp/rc.json");
				assert.deepStrictEqual(written, ["/home/test/.config/myapp/rc.json"]);
			}),
		);
	});

	describe("the native probe", () => {
		const nativeCandidate = "/home/test/Library/Application Support/myapp/rc.json";

		it.effect("falls back to the OS-native directory by default", () =>
			Effect.gen(function* () {
				const cfg = yield* TestConfig;
				const value = yield* cfg.load;
				assert.strictEqual(value.port, 4242);
			}).pipe(
				Effect.provide(
					configLayer({ filename: "rc.json", schema: Shape, codec: JsonCodec }).pipe(
						Layer.provide(harnessWith(fakeFs({ present: [nativeCandidate] }), "darwin")),
					),
				),
			),
		);

		it.effect("native: false drops the native probe", () =>
			Effect.gen(function* () {
				const cfg = yield* TestConfig;
				const error = yield* Effect.flip(cfg.load);
				assert.strictEqual(error._tag, "ConfigFileNotFoundError");
			}).pipe(
				Effect.provide(
					configLayer({ filename: "rc.json", schema: Shape, codec: JsonCodec, native: false }).pipe(
						Layer.provide(harnessWith(fakeFs({ present: [nativeCandidate] }), "darwin")),
					),
				),
			),
		);
	});
});
