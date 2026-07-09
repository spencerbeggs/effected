import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import type { ConfigCodec as ConfigCodecShape } from "../src/ConfigCodec.js";
import { ConfigCodec, ConfigCodecError } from "../src/ConfigCodec.js";
import type { ConfigSaveError, ConfigUpdateError, ConfigWriteError } from "../src/ConfigFile.js";
import { ConfigDefaultPathMissingError, ConfigFile, ConfigFileWriteError } from "../src/ConfigFile.js";
import { ConfigResolver } from "../src/ConfigResolver.js";
import { MergeStrategy } from "../src/MergeStrategy.js";
import type { RecordingFs } from "./helpers.js";
import { hostileFs, recordingFs } from "./helpers.js";

class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}
class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("test/WriteConfig") {}

const layerFor = (host: RecordingFs, defaultPath?: string, codec: ConfigCodecShape = ConfigCodec.json) =>
	ConfigFile.layer(AppConfig, {
		schema: AppShape,
		codec,
		resolvers: [ConfigResolver.explicitPath("/app/.apprc")],
		strategy: MergeStrategy.firstMatch<AppShape>(),
		...(defaultPath !== undefined && { defaultPath: Effect.succeed(defaultPath) }),
	}).pipe(Layer.provide(Layer.mergeAll(host.layer, Path.layer)));

describe("ConfigFile.write", () => {
	it.effect("encodes and writes to an explicit path without creating directories", () =>
		Effect.gen(function* () {
			const host = recordingFs({});
			yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				yield* cfg.write(new AppShape({ port: 9090 }), "/explicit/.apprc");
			}).pipe(Effect.provide(layerFor(host)));

			assert.deepStrictEqual(JSON.parse(host.files["/explicit/.apprc"] as string), { port: 9090 });
			// `write` never mkdirs — the documented distinction from `save`.
			assert.deepStrictEqual(host.mkdirs, []);
		}),
	);

	it.effect("fails with ConfigFileWriteError when the filesystem rejects the write", () =>
		Effect.gen(function* () {
			const error = yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				return yield* Effect.flip(cfg.write(new AppShape({ port: 1 }), "/ro/.apprc"));
			}).pipe(Effect.provide(layerFor(hostileFs())));

			assert.instanceOf(error, ConfigFileWriteError);
			assert.strictEqual((error as ConfigFileWriteError).path, "/ro/.apprc");
			// The filesystem failure survives structurally; v3 flattened it to String(e).
			assert.instanceOf((error as ConfigFileWriteError).cause, Error);
		}),
	);

	it.effect("fails with ConfigCodecError when the codec cannot stringify", () =>
		Effect.gen(function* () {
			const host = recordingFs({});
			const brokenCodec: ConfigCodecShape = {
				name: "broken",
				parse: ConfigCodec.json.parse,
				stringify: () =>
					Effect.fail(new ConfigCodecError({ codec: "broken", operation: "stringify", cause: new Error("nope") })),
			};

			const error = yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				return yield* Effect.flip(cfg.write(new AppShape({ port: 1 }), "/x/.apprc"));
			}).pipe(Effect.provide(layerFor(host, undefined, brokenCodec)));

			assert.instanceOf(error, ConfigCodecError);
			assert.strictEqual(error._tag, "ConfigCodecError");
			// A failed stringify must not have written a partial file.
			assert.deepStrictEqual(Object.keys(host.files), []);
		}),
	);
});

describe("ConfigFile.save", () => {
	it.effect("creates the parent directory, writes, and returns the path", () =>
		Effect.gen(function* () {
			const host = recordingFs({});
			const written = yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				return yield* cfg.save(new AppShape({ port: 7070 }));
			}).pipe(Effect.provide(layerFor(host, "/home/u/.config/app/.apprc")));

			assert.strictEqual(written, "/home/u/.config/app/.apprc");
			assert.deepStrictEqual(host.mkdirs, ["/home/u/.config/app"]);
			assert.deepStrictEqual(JSON.parse(host.files["/home/u/.config/app/.apprc"] as string), { port: 7070 });
		}),
	);

	it.effect("fails with ConfigDefaultPathMissingError when no defaultPath is configured", () =>
		Effect.gen(function* () {
			const host = recordingFs({});
			const error = yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				return yield* Effect.flip(cfg.save(new AppShape({ port: 1 })));
			}).pipe(Effect.provide(layerFor(host)));

			assert.instanceOf(error, ConfigDefaultPathMissingError);
			assert.strictEqual(error._tag, "ConfigDefaultPathMissingError");
			// It is its own tag, not a ConfigFileWriteError carrying a fabricated `path`.
			assert.notInstanceOf(error, ConfigFileWriteError);
			assert.deepStrictEqual(host.mkdirs, []);
			assert.deepStrictEqual(Object.keys(host.files), []);
		}),
	);

	it.effect("routes the missing-defaultPath failure by tag", () =>
		Effect.gen(function* () {
			const host = recordingFs({});
			const label = yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				return yield* cfg.save(new AppShape({ port: 1 })).pipe(
					Effect.as("saved"),
					Effect.catchTag("ConfigDefaultPathMissingError", () => Effect.succeed("no-default-path")),
					Effect.catchTag("ConfigFileWriteError", () => Effect.succeed("unwritable")),
					Effect.catchTag("ConfigCodecError", () => Effect.succeed("bad-syntax")),
					Effect.catchTag("ConfigValidationError", () => Effect.succeed("bad-shape")),
				);
			}).pipe(Effect.provide(layerFor(host)));

			assert.strictEqual(label, "no-default-path");
		}),
	);
});

describe("ConfigFile.update", () => {
	it.effect("loads, transforms, saves, and returns the updated value", () =>
		Effect.gen(function* () {
			const host = recordingFs({ "/app/.apprc": `{"port":1}` });
			const updated = yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				return yield* cfg.update((current) => new AppShape({ port: current.port + 1 }));
			}).pipe(Effect.provide(layerFor(host, "/app/.apprc")));

			assert.strictEqual(updated.port, 2);
			assert.deepStrictEqual(JSON.parse(host.files["/app/.apprc"] as string), { port: 2 });
		}),
	);

	it.effect("uses defaultValue when nothing is found, then saves it", () =>
		Effect.gen(function* () {
			const host = recordingFs({});
			const updated = yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				return yield* cfg.update((current) => new AppShape({ port: current.port + 1 }), new AppShape({ port: 10 }));
			}).pipe(Effect.provide(layerFor(host, "/app/.apprc")));

			assert.strictEqual(updated.port, 11);
			assert.deepStrictEqual(JSON.parse(host.files["/app/.apprc"] as string), { port: 11 });
		}),
	);

	it.effect("propagates ConfigFileNotFoundError when nothing is found and no defaultValue is given", () =>
		Effect.gen(function* () {
			const host = recordingFs({});
			const error = yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				return yield* Effect.flip(cfg.update((current) => current));
			}).pipe(Effect.provide(layerFor(host, "/app/.apprc")));

			assert.strictEqual(error._tag, "ConfigFileNotFoundError");
			// Nothing was written: update failed before reaching save.
			assert.deepStrictEqual(Object.keys(host.files), []);
		}),
	);
});

describe("ConfigFile write-path error-union narrowing (type-level)", () => {
	// These assignments FAIL THE TYPECHECK if a method's error channel is wider
	// than the design permits. `write` takes an explicit path, so it can never
	// fail with ConfigFileNotFoundError.
	it.effect("narrows each write-path method's error channel", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;

			// No ConfigFileNotFoundError: the path is explicit. No
			// ConfigDefaultPathMissingError: no default path is consulted.
			const _write: (value: AppShape, path: string) => Effect.Effect<void, ConfigWriteError, never> = cfg.write;
			// No ConfigFileNotFoundError: `save` never discovers anything.
			const _save: (value: AppShape) => Effect.Effect<string, ConfigSaveError, never> = cfg.save;
			// `update` loads, so it inherits the whole load union, plus save's.
			const _update: (
				fn: (current: AppShape) => AppShape,
				defaultValue?: AppShape,
			) => Effect.Effect<AppShape, ConfigUpdateError, never> = cfg.update;

			assert.isFunction(_write);
			assert.isFunction(_save);
			assert.isFunction(_update);
		}).pipe(Effect.provide(layerFor(recordingFs({})))),
	);
});

describe("ConfigFile.layer with an empty resolver chain", () => {
	// Regression for the RR inference gap: `resolvers: []` with no other
	// resolver gives `RR` zero inference candidates. Before `RR` defaulted to
	// `never`, this configuration failed to typecheck at all — `RR` inferred
	// `unknown`, collapsing the layer's `R` to `unknown` and breaking
	// `Effect.provide` downstream. A write-only config service (discovery
	// disabled, `save` still wired through `defaultPath`) is a legitimate
	// configuration this must support.
	it.effect("saves via defaultPath alone when resolvers is empty", () =>
		Effect.gen(function* () {
			const host = recordingFs({});
			const writeOnlyLayer = ConfigFile.layer(AppConfig, {
				schema: AppShape,
				codec: ConfigCodec.json,
				resolvers: [],
				strategy: MergeStrategy.firstMatch<AppShape>(),
				defaultPath: Effect.succeed("/write-only/.apprc"),
			}).pipe(Layer.provide(Layer.mergeAll(host.layer, Path.layer)));

			const written = yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				return yield* cfg.save(new AppShape({ port: 42 }));
			}).pipe(Effect.provide(writeOnlyLayer));

			assert.strictEqual(written, "/write-only/.apprc");
			assert.deepStrictEqual(host.mkdirs, ["/write-only"]);
			assert.deepStrictEqual(JSON.parse(host.files["/write-only/.apprc"] as string), { port: 42 });
		}),
	);
});

describe("ConfigFile.update — concurrency", () => {
	/**
	 * A recording FileSystem whose read yields to the scheduler, so two fibers
	 * genuinely interleave between `load` and `save`. Without that boundary the
	 * effects run to completion one after the other and no race is possible —
	 * a test over a synchronous FileSystem passes whether or not `update` is
	 * serialized, which proves nothing.
	 */
	const yieldingFs = (files: Record<string, string>) => ({
		files,
		layer: Layer.succeed(FileSystem.FileSystem, {
			exists: (p: string) => Effect.succeed(Object.hasOwn(files, p)),
			readFileString: (p: string) =>
				Effect.gen(function* () {
					// Snapshot before yielding: a real read observes the file as it was when the
					// read began. Returning `files[p]` after the yield would silently hand the
					// second fiber the first fiber's write, masking the very race under test.
					if (!Object.hasOwn(files, p)) return yield* Effect.fail(new Error(`ENOENT: ${p}`));
					const snapshot = files[p] as string;
					yield* Effect.yieldNow;
					return snapshot;
				}),
			writeFileString: (p: string, content: string) =>
				Effect.sync(() => {
					files[p] = content;
				}),
			makeDirectory: () => Effect.void,
		} as unknown as FileSystem.FileSystem),
	});

	it.effect("two concurrent updates both land; neither write is lost", () =>
		Effect.gen(function* () {
			const host = yieldingFs({ "/app/.apprc": `{"port":0}` });
			const layer = ConfigFile.layer(AppConfig, {
				schema: AppShape,
				codec: ConfigCodec.json,
				resolvers: [ConfigResolver.explicitPath("/app/.apprc")],
				strategy: MergeStrategy.firstMatch<AppShape>(),
				defaultPath: Effect.succeed("/app/.apprc"),
			}).pipe(Layer.provide(Layer.mergeAll(host.layer, Path.layer)));

			yield* Effect.gen(function* () {
				const cfg = yield* AppConfig;
				const bump = cfg.update((current) => new AppShape({ port: current.port + 1 }));
				// Unserialized, both fibers read port=0 across the yield and both write 1.
				yield* Effect.all([bump, bump], { concurrency: 2 });
			}).pipe(Effect.provide(layer));

			const final = JSON.parse(host.files["/app/.apprc"] as string) as { port: number };
			assert.strictEqual(final.port, 2, "both increments must survive");
		}),
	);
});
