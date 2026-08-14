import { assert, describe, it } from "@effect/vitest";
import { ConfigFile, ConfigResolver, JsonCodec } from "@effected/config-file";
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
const fakeFs = (options?: {
	readonly present?: ReadonlyArray<string>;
	readonly written?: Array<string>;
	/** Per-path bodies, for tests that must tell WHICH resolver won. */
	readonly contents?: Readonly<Record<string, string>>;
}) =>
	FileSystem.layerNoop({
		exists: (candidate) => Effect.succeed(options?.present?.includes(candidate) ?? false),
		readFileString: (candidate) => Effect.succeed(options?.contents?.[candidate] ?? `{"port":4242}`),
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
					}).pipe(
						Layer.provide(
							harnessWith(
								fakeFs({
									present: [flagged, xdgCandidate],
									contents: { [flagged]: `{"port":8080}`, [xdgCandidate]: `{"port":4242}` },
								}),
							),
						),
					),
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
					}).pipe(Layer.provide(harnessWith(fakeFs({ present: [xdgCandidate] })))),
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
							Layer.provide(
								harnessWith(
									fakeFs({
										present: [first, second, xdgCandidate],
										contents: { [first]: `{"port":1}`, [second]: `{"port":2}` },
									}),
								),
							),
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
				const written: Array<string> = [];
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
						}).pipe(Layer.provide(harnessWith(fakeFs({ present: [flagged], written })))),
					),
				);
				assert.strictEqual(target, xdgCandidate);
				assert.deepStrictEqual(written, [xdgCandidate]);
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
						Layer.provide(harnessWith(fakeFs({ present: [xdgCandidate] }))),
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
							Layer.provide(
								harnessWith(
									fakeFs({
										present: [flagged, nativeCandidate],
										contents: { [flagged]: `{"port":8080}` },
									}),
									"darwin",
								),
							),
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
						Layer.provide(
							harnessWith(
								fakeFs({
									present: [xdgCandidate2],
									contents: { [xdgCandidate2]: `{"port":4242,"removedCredential":"stale"}` },
								}),
							),
						),
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
					}).pipe(
						Layer.provide(
							harnessWith(
								fakeFs({
									present: [xdgCandidate2],
									contents: { [xdgCandidate2]: `{"port":4242,"removedCredential":"stale"}` },
								}),
							),
						),
					),
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
					}).pipe(Layer.provide(harnessWith(fakeFs({ present: [xdgCandidate2] })))),
				),
			),
		);
	});
});
