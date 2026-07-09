import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import type { ConfigCodec as ConfigCodecShape } from "../src/ConfigCodec.js";
import { ConfigCodec, ConfigCodecError } from "../src/ConfigCodec.js";
import type { ConfigSaveError, ConfigUpdateError, ConfigWriteError } from "../src/ConfigFile.js";
import { ConfigDefaultPathMissingError, ConfigFile, ConfigFileWriteError } from "../src/ConfigFile.js";
import { ConfigResolver } from "../src/ConfigResolver.js";
import { MergeStrategy } from "../src/MergeStrategy.js";

class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}
class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("test/WriteConfig") {}

/** Records every write and every mkdir so the tests can assert on them. */
const recordingFs = (files: Record<string, string>) => {
	const mkdirs: Array<string> = [];
	const fs = {
		exists: (p: string) => Effect.succeed(Object.hasOwn(files, p)),
		readFileString: (p: string) =>
			Object.hasOwn(files, p) ? Effect.succeed(files[p] as string) : Effect.fail(new Error(`ENOENT: ${p}`)),
		writeFileString: (p: string, content: string) =>
			Effect.sync(() => {
				files[p] = content;
			}),
		makeDirectory: (p: string) =>
			Effect.sync(() => {
				mkdirs.push(p);
			}),
	} as unknown as FileSystem.FileSystem;
	return { layer: Layer.succeed(FileSystem.FileSystem, fs), files, mkdirs };
};

/**
 * A host whose every write is rejected. `makeDirectory` is absent on purpose:
 * if `write` ever started creating directories, this would throw rather than
 * quietly pass.
 */
const hostileFs = (): ReturnType<typeof recordingFs> => {
	const fs = {
		exists: () => Effect.succeed(false),
		writeFileString: () => Effect.fail(new Error("EROFS")),
	} as unknown as FileSystem.FileSystem;
	return { layer: Layer.succeed(FileSystem.FileSystem, fs), files: {}, mkdirs: [] };
};

const layerFor = (
	host: ReturnType<typeof recordingFs>,
	defaultPath?: string,
	codec: ConfigCodecShape = ConfigCodec.json,
) =>
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
	it("narrows each write-path method's error channel", () =>
		Effect.runSync(
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
		));
});
