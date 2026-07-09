import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { ConfigCodec, ConfigCodecError } from "../src/ConfigCodec.js";
import type { ConfigLoadError, ConfigReadError } from "../src/ConfigFile.js";
import { ConfigFile, ConfigFileNotFoundError, ConfigFileReadError, ConfigValidationError } from "../src/ConfigFile.js";
import { ConfigResolver } from "../src/ConfigResolver.js";
import { MergeStrategy } from "../src/MergeStrategy.js";

class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}
class AppConfig extends ConfigFile.Service<AppConfig, AppShape>()("test/AppConfig") {}

/** An in-memory FileSystem seeded with `files`; anything else is ENOENT. */
const memoryFs = (files: Record<string, string>) =>
	Layer.succeed(FileSystem.FileSystem, {
		exists: (p: string) => Effect.succeed(Object.hasOwn(files, p)),
		readFileString: (p: string) =>
			Object.hasOwn(files, p) ? Effect.succeed(files[p] as string) : Effect.fail(new Error(`ENOENT: ${p}`)),
	} as unknown as FileSystem.FileSystem);

const layerFor = (
	files: Record<string, string>,
	resolvers = [ConfigResolver.explicitPath("/app/.apprc")],
	validate?: (value: AppShape) => Effect.Effect<AppShape, ConfigValidationError>,
) =>
	ConfigFile.layer(AppConfig, {
		schema: AppShape,
		codec: ConfigCodec.json,
		resolvers,
		strategy: MergeStrategy.firstMatch<AppShape>(),
		...(validate !== undefined && { validate }),
	}).pipe(Layer.provide(Layer.mergeAll(memoryFs(files), Path.layer)));

describe("ConfigFile.load", () => {
	it.effect("loads, decodes and validates the highest-priority source", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const value = yield* cfg.load;
			assert.strictEqual(value.port, 8080);
			assert.instanceOf(value, AppShape);
		}).pipe(Effect.provide(layerFor({ "/app/.apprc": `{"port":8080}` }))),
	);

	it.effect("fails with ConfigFileNotFoundError when no resolver matches", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const error = yield* Effect.flip(cfg.load);
			assert.instanceOf(error, ConfigFileNotFoundError);
			assert.strictEqual(error._tag, "ConfigFileNotFoundError");
			// It reports which tiers were probed — v3's mega-error could not.
			assert.include((error as ConfigFileNotFoundError).searched, "explicit");
		}).pipe(Effect.provide(layerFor({}))),
	);

	it.effect("fails with ConfigCodecError — distinguishable from NotFound", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const error = yield* Effect.flip(cfg.load);
			assert.instanceOf(error, ConfigCodecError);
			assert.strictEqual(error._tag, "ConfigCodecError");
		}).pipe(Effect.provide(layerFor({ "/app/.apprc": "{ not json" }))),
	);

	it.effect("fails with ConfigValidationError carrying a structured issue, not a string", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const error = yield* Effect.flip(cfg.load);
			assert.instanceOf(error, ConfigValidationError);
			assert.strictEqual(error._tag, "ConfigValidationError");
			const { issue } = error as ConfigValidationError;
			assert.notStrictEqual(typeof issue, "string");
			// The structured schema issue tree survives, rather than String(ParseError).
			assert.strictEqual(typeof issue, "object");
			assert.property(issue as object, "_tag");
		}).pipe(Effect.provide(layerFor({ "/app/.apprc": `{"port":"nope"}` }))),
	);

	it.effect("ConfigValidationError names the offending path", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const error = yield* Effect.flip(cfg.load);
			assert.instanceOf(error, ConfigValidationError);
			assert.deepStrictEqual((error as ConfigValidationError).path, Option.some("/app/.apprc"));
		}).pipe(Effect.provide(layerFor({ "/app/.apprc": `{"port":"nope"}` }))),
	);

	it.effect("preserves the read failure structurally rather than stringifying it", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const error = yield* Effect.flip(cfg.loadFrom("/nope/.apprc"));
			assert.instanceOf(error, ConfigFileReadError);
			// v3 collapsed this to `reason: String(e)`; the Error instance survives.
			assert.instanceOf((error as ConfigFileReadError).cause, Error);
		}).pipe(Effect.provide(layerFor({}))),
	);

	it.effect("the three failure modes are routable by catchTag — the v3 defect this fixes", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const label = yield* cfg.load.pipe(
				Effect.as("ok"),
				Effect.catchTag("ConfigFileNotFoundError", () => Effect.succeed("not-found")),
				Effect.catchTag("ConfigCodecError", () => Effect.succeed("bad-syntax")),
				Effect.catchTag("ConfigValidationError", () => Effect.succeed("bad-shape")),
				Effect.catchTag("ConfigFileReadError", () => Effect.succeed("unreadable")),
			);
			assert.strictEqual(label, "bad-syntax");
		}).pipe(Effect.provide(layerFor({ "/app/.apprc": "{ not json" }))),
	);
});

describe("ConfigFile bare non-object documents", () => {
	// ConfigCodec.json.parse happily accepts `null`, `42` and `"str"` — a bare,
	// non-object JSON document. The service is where that becomes a decision:
	// the schema rejects it as a ConfigValidationError, never a defect.
	for (const [label, raw] of [
		["null", "null"],
		["a bare number", "42"],
		["a bare string", `"hello"`],
		["an array", "[]"],
	] as const) {
		it.effect(`rejects ${label} as ConfigValidationError, not a defect`, () =>
			Effect.gen(function* () {
				const cfg = yield* AppConfig;
				const error = yield* Effect.flip(cfg.load);
				assert.instanceOf(error, ConfigValidationError);
				assert.strictEqual(error._tag, "ConfigValidationError");
			}).pipe(Effect.provide(layerFor({ "/app/.apprc": raw }))),
		);
	}
});

describe("ConfigFile.loadOrDefault", () => {
	it.effect("returns the default when nothing is found", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const value = yield* cfg.loadOrDefault(new AppShape({ port: 1 }));
			assert.strictEqual(value.port, 1);
		}).pipe(Effect.provide(layerFor({}))),
	);

	it.effect("still propagates a codec failure — a corrupt file is not a missing file", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const error = yield* Effect.flip(cfg.loadOrDefault(new AppShape({ port: 1 })));
			assert.strictEqual(error._tag, "ConfigCodecError");
		}).pipe(Effect.provide(layerFor({ "/app/.apprc": "{ not json" }))),
	);
});

describe("ConfigFile.discover", () => {
	it.effect("returns an empty array rather than failing when nothing is found", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const sources = yield* cfg.discover;
			assert.deepStrictEqual(sources, []);
		}).pipe(Effect.provide(layerFor({}))),
	);

	it.effect("labels each source with the resolver that found it", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const sources = yield* cfg.discover;
			assert.strictEqual(sources[0]?.resolver, "explicit");
			assert.strictEqual(sources[0]?.path, "/app/.apprc");
		}).pipe(Effect.provide(layerFor({ "/app/.apprc": `{"port":8080}` }))),
	);
});

describe("ConfigFile.loadFrom / validate", () => {
	it.effect("loadFrom fails with ConfigFileReadError on an unreadable path", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const error = yield* Effect.flip(cfg.loadFrom("/nope/.apprc"));
			assert.instanceOf(error, ConfigFileReadError);
			assert.strictEqual((error as ConfigFileReadError).path, "/nope/.apprc");
		}).pipe(Effect.provide(layerFor({}))),
	);

	it.effect("validate decodes an unknown value", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const value = yield* cfg.validate({ port: 3000 });
			assert.strictEqual(value.port, 3000);
		}).pipe(Effect.provide(layerFor({}))),
	);

	it.effect("validate fails with ConfigValidationError carrying no path", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const error = yield* Effect.flip(cfg.validate({ port: "nope" }));
			assert.instanceOf(error, ConfigValidationError);
			assert.isTrue(Option.isNone(error.path));
		}).pipe(Effect.provide(layerFor({}))),
	);
});

describe("ConfigFile options.validate", () => {
	const rejectPort0 = (value: AppShape): Effect.Effect<AppShape, ConfigValidationError> =>
		value.port === 0
			? Effect.fail(new ConfigValidationError({ path: Option.none(), issue: "port must not be 0" }))
			: Effect.succeed(value);

	it.effect("cfg.load fails with ConfigValidationError when the caller hook rejects a schema-valid document", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const error = yield* Effect.flip(cfg.load);
			assert.instanceOf(error, ConfigValidationError);
			assert.strictEqual(error._tag, "ConfigValidationError");
		}).pipe(Effect.provide(layerFor({ "/app/.apprc": `{"port":0}` }, undefined, rejectPort0))),
	);

	it.effect("cfg.load succeeds when the caller hook passes the value through", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const value = yield* cfg.load;
			assert.strictEqual(value.port, 8080);
		}).pipe(Effect.provide(layerFor({ "/app/.apprc": `{"port":8080}` }, undefined, rejectPort0))),
	);

	it.effect("cfg.validate(value) also runs the caller hook, not just the schema", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			const error = yield* Effect.flip(cfg.validate({ port: 0 }));
			assert.instanceOf(error, ConfigValidationError);
		}).pipe(Effect.provide(layerFor({}, undefined, rejectPort0))),
	);

	it.effect("loadOrDefault returns defaultValue as-is, without running the schema or options.validate on it", () =>
		Effect.gen(function* () {
			const cfg = yield* AppConfig;
			// port: 0 would be rejected by rejectPort0 if it were run, and by the
			// schema if re-decoded. Its return unmolested pins the v3-parity behavior.
			const defaultValue = new AppShape({ port: 0 });
			const value = yield* cfg.loadOrDefault(defaultValue);
			assert.strictEqual(value, defaultValue);
			assert.strictEqual(value.port, 0);
		}).pipe(Effect.provide(layerFor({}, undefined, rejectPort0))),
	);
});

describe("ConfigFile error-union narrowing (type-level)", () => {
	// These assignments do not run anything meaningful; they FAIL THE TYPECHECK
	// if a method's error channel is wider than the design permits. That is the
	// deliverable of this task, and the v3 defect it repairs.
	it("narrows each method's error channel", () =>
		Effect.runSync(
			Effect.gen(function* () {
				const cfg = yield* AppConfig;

				const _load: Effect.Effect<AppShape, ConfigLoadError, never> = cfg.load;
				// No ConfigFileNotFoundError: the path is explicit.
				const _loadFrom: (p: string) => Effect.Effect<AppShape, ConfigReadError, never> = cfg.loadFrom;
				// No ConfigFileNotFoundError: an empty array is success.
				const _discover: Effect.Effect<
					ReadonlyArray<{ readonly value: AppShape }>,
					ConfigReadError,
					never
				> = cfg.discover;
				// No ConfigFileNotFoundError: that is the branch it handles.
				const _loadOrDefault: (d: AppShape) => Effect.Effect<AppShape, ConfigReadError, never> = cfg.loadOrDefault;
				// ConfigValidationError and nothing else.
				const _validate: (v: unknown) => Effect.Effect<AppShape, ConfigValidationError, never> = cfg.validate;

				assert.isFunction(_validate);
				assert.isFunction(_loadFrom);
				assert.isFunction(_loadOrDefault);
				assert.isDefined(_load);
				assert.isDefined(_discover);
			}).pipe(Effect.provide(layerFor({}))),
		));
});
