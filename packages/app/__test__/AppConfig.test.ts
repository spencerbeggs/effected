import { assert, describe, it } from "@effect/vitest";
import type { ConfigFileShape } from "@effected/config-file";
import { ConfigFile, ConfigResolver, JsonCodec } from "@effected/config-file";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { AppDirs, CurrentPlatform, Xdg, XdgPaths } from "@effected/xdg";
import type { FileSystem } from "effect";
import { Context, Effect, Exit, Layer, Path, Schema } from "effect";
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

/** A well-formed config body, seeded wherever a test needs a file that loads. */
const rc = `{"port":4242}`;

/**
 * A real in-memory volume holding exactly `seed`. Every other path is honestly
 * absent, and every read answers with what was seeded — never a canned body.
 */
const fakeFs = (seed: MemoryFileSystemSeed = {}) => MemoryFileSystem.layerWith(seed);

const harnessWith = (fs: Layer.Layer<FileSystem.FileSystem>, platform: "linux" | "darwin" = "linux") => {
	const base = Layer.mergeAll(Path.layer, fs, Layer.succeed(CurrentPlatform, platform), Xdg.layerFrom(xdgPaths));
	return Layer.provideMerge(AppDirs.layer({ namespace: "myapp" }), base);
};

const configLayer = <RR = never>(options: AppConfigOptions<Shape, { readonly port: number }, RR>) =>
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
				// a good filename must BUILD over an empty volume.
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
						Layer.provide(harnessWith(fakeFs({ "/home/test/.config/myapp/rc.json": rc }))),
					),
				),
			),
		);

		it.effect("saves into the app's own config directory", () =>
			Effect.gen(function* () {
				const host = MemoryFileSystem.makeSync();
				const target = yield* Effect.gen(function* () {
					const cfg = yield* TestConfig;
					return yield* cfg.save(Shape.make({ port: 9000 }));
				}).pipe(
					Effect.provide(
						configLayer({ filename: "rc.json", schema: Shape, codec: JsonCodec }).pipe(
							Layer.provide(harnessWith(host.layer)),
						),
					),
				);
				assert.strictEqual(target, "/home/test/.config/myapp/rc.json");
				// Exactly one file on the volume, and it is the one saved.
				assert.deepStrictEqual(host.volume.paths(), ["/home/test/.config/myapp/rc.json"]);
				assert.deepStrictEqual(JSON.parse(host.volume.text(target) ?? "null"), { port: 9000 });
			}),
		);
	});

	describe("caller-supplied resolvers", () => {
		const xdgCandidate = "/home/test/.config/myapp/rc.json";
		const flagged = "/somewhere/else/custom.json";

		it.effect("a prepended resolver outranks the app's XDG search path", () =>
			Effect.gen(function* () {
				// Both files exist. The flag's file wins because its resolver leads.
				const cfg = yield* TestConfig;
				const value = yield* cfg.load;
				assert.strictEqual(value.port, 8080);
			}).pipe(
				Effect.provide(
					configLayer({
						filename: "rc.json",
						schema: Shape,
						codec: JsonCodec,
						resolvers: [ConfigResolver.explicitPath(flagged)],
					}).pipe(Layer.provide(harnessWith(fakeFs({ [flagged]: `{"port":8080}`, [xdgCandidate]: rc })))),
				),
			),
		);

		it.effect("a prepended resolver that finds nothing falls through to the XDG chain", () =>
			Effect.gen(function* () {
				// Every resolver's error channel is `never`: a --config naming a
				// missing file is not an error here, it is a miss. The app decides
				// whether that deserves one, before it builds the layer.
				const cfg = yield* TestConfig;
				const value = yield* cfg.load;
				assert.strictEqual(value.port, 4242);
			}).pipe(
				Effect.provide(
					configLayer({
						filename: "rc.json",
						schema: Shape,
						codec: JsonCodec,
						resolvers: [ConfigResolver.explicitPath(flagged)],
					}).pipe(Layer.provide(harnessWith(fakeFs({ [xdgCandidate]: rc })))),
				),
			),
		);

		it.effect("the resolvers stay in the order they were given", () =>
			Effect.gen(function* () {
				const first = "/first/rc.json";
				const second = "/second/rc.json";
				const value = yield* Effect.gen(function* () {
					const cfg = yield* TestConfig;
					return yield* cfg.load;
				}).pipe(
					Effect.provide(
						configLayer({
							filename: "rc.json",
							schema: Shape,
							codec: JsonCodec,
							resolvers: [ConfigResolver.explicitPath(first), ConfigResolver.explicitPath(second)],
						}).pipe(
							Layer.provide(harnessWith(fakeFs({ [first]: `{"port":1}`, [second]: `{"port":2}`, [xdgCandidate]: rc }))),
						),
					),
				);
				assert.strictEqual(value.port, 1);
			}),
		);

		it.effect("saving still targets the app's own config directory, not the discovered path", () =>
			Effect.gen(function* () {
				// The prepended resolver decides where config is READ from; the save
				// path is `XdgConfig.savePath` and stays that way.
				const host = MemoryFileSystem.makeSync({ [flagged]: `{"port":8080}` });
				const target = yield* Effect.gen(function* () {
					const cfg = yield* TestConfig;
					return yield* cfg.save(Shape.make({ port: 9000 }));
				}).pipe(
					Effect.provide(
						configLayer({
							filename: "rc.json",
							schema: Shape,
							codec: JsonCodec,
							resolvers: [ConfigResolver.explicitPath(flagged)],
						}).pipe(Layer.provide(harnessWith(host.layer))),
					),
				);
				assert.strictEqual(target, xdgCandidate);
				assert.deepStrictEqual(JSON.parse(host.volume.text(xdgCandidate) ?? "null"), { port: 9000 });
				// The discovered file is untouched.
				assert.strictEqual(host.volume.text(flagged), `{"port":8080}`);
			}),
		);

		it.effect("an empty resolvers array leaves the default chain untouched", () =>
			Effect.gen(function* () {
				const cfg = yield* TestConfig;
				const value = yield* cfg.load;
				assert.strictEqual(value.port, 4242);
			}).pipe(
				Effect.provide(
					configLayer({ filename: "rc.json", schema: Shape, codec: JsonCodec, resolvers: [] }).pipe(
						Layer.provide(harnessWith(fakeFs({ [xdgCandidate]: rc }))),
					),
				),
			),
		);

		it.effect("caller resolvers compose with native: false", () =>
			Effect.gen(function* () {
				// The two options are independent: dropping the native probe must not
				// drop the prepended chain with it.
				const nativeCandidate = "/home/test/Library/Application Support/myapp/rc.json";
				const value = yield* Effect.gen(function* () {
					const cfg = yield* TestConfig;
					return yield* cfg.load;
				}).pipe(
					Effect.provide(
						configLayer({
							filename: "rc.json",
							schema: Shape,
							codec: JsonCodec,
							native: false,
							resolvers: [ConfigResolver.explicitPath(flagged)],
						}).pipe(
							Layer.provide(harnessWith(fakeFs({ [flagged]: `{"port":8080}`, [nativeCandidate]: rc }), "darwin")),
						),
					),
				);
				assert.strictEqual(value.port, 8080);
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
						Layer.provide(harnessWith(fakeFs({ [nativeCandidate]: rc }), "darwin")),
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
						Layer.provide(harnessWith(fakeFs({ [nativeCandidate]: rc }), "darwin")),
					),
				),
			),
		);
	});
	describe("parseOptions", () => {
		const xdgCandidate2 = "/home/test/.config/myapp/rc.json";

		it.effect("unknown keys are dropped silently by default", () =>
			Effect.gen(function* () {
				const cfg = yield* TestConfig;
				const value = yield* cfg.load;
				assert.strictEqual(value.port, 4242);
			}).pipe(
				Effect.provide(
					configLayer({ filename: "rc.json", schema: Shape, codec: JsonCodec }).pipe(
						Layer.provide(harnessWith(fakeFs({ [xdgCandidate2]: `{"port":4242,"removedCredential":"stale"}` }))),
					),
				),
			),
		);

		it.effect("onExcessProperty error rejects a leftover field and names its path", () =>
			Effect.gen(function* () {
				// The migration case: a user's older file keeps a field the schema
				// deliberately removed. Silence here is what makes a dead credential
				// look live.
				const cfg = yield* TestConfig;
				const error = yield* Effect.flip(cfg.load);
				assert.strictEqual(error._tag, "ConfigValidationError");
				// The whole error, not `.issue`: `load` fails with the ConfigLoadError
				// union, and the issue tree is a field so it serialises either way.
				assert.include(JSON.stringify(error), "removedCredential");
			}).pipe(
				Effect.provide(
					configLayer({
						filename: "rc.json",
						schema: Shape,
						codec: JsonCodec,
						parseOptions: { onExcessProperty: "error" },
					}).pipe(Layer.provide(harnessWith(fakeFs({ [xdgCandidate2]: `{"port":4242,"removedCredential":"stale"}` })))),
				),
			),
		);

		it.effect("onExcessProperty error still accepts a document with no excess keys", () =>
			Effect.gen(function* () {
				const cfg = yield* TestConfig;
				const value = yield* cfg.load;
				assert.strictEqual(value.port, 4242);
			}).pipe(
				Effect.provide(
					configLayer({
						filename: "rc.json",
						schema: Shape,
						codec: JsonCodec,
						parseOptions: { onExcessProperty: "error" },
					}).pipe(Layer.provide(harnessWith(fakeFs({ [xdgCandidate2]: rc })))),
				),
			),
		);
	});
});

describe("AppConfig.layer key typing", () => {
	class Other extends Schema.Class<Other>("Other")({ name: Schema.String }) {}
	class WiderConfig extends Context.Service<WiderConfig, ConfigFileShape<Shape> & { readonly extra: string }>()(
		"app-test/WiderConfig",
	) {}

	it("accepts a ConfigFile.Service key and rejects a wider or mismatched one", () => {
		const options = { filename: "c.json", schema: Shape, codec: JsonCodec } as const;
		const ok = () => AppConfig.layer(TestConfig, options);
		// @ts-expect-error a key over a WIDER shape would be handed a value missing `extra`
		const wider = () => AppConfig.layer(WiderConfig, options);
		// @ts-expect-error the key's config type must match the schema's
		const mismatched = () => AppConfig.layer(TestConfig, { filename: "c.json", schema: Other, codec: JsonCodec });
		for (const build of [ok, wider, mismatched]) assert.isFunction(build);
	});
});
