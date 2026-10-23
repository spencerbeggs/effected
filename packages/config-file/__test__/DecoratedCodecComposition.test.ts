// The decorators reach the loader.
//
// `EncryptedCodec` and `ConfigMigration.make` return codecs whose error channel
// is WIDENED. `ConfigFile.layer`, `testLayer` and `read` once typed their
// `codec` option as the narrow `ConfigCodec<ConfigCodecError>`, so neither
// decorator could be passed to the loader at all (TS2322), and the README's
// "Codecs compose" example only worked standalone. Every options type is now
// generic over the codec error `CE`, and the service's error unions widen
// with it.

import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import type { ConfigProvider, FileSystem } from "effect";
import { Effect, Layer, Path, PubSub, Schema } from "effect";
import type { ConfigCodec, ConfigCodecError } from "../src/ConfigCodec.js";
import { ConfigEvents } from "../src/ConfigEvent.js";
import type { ConfigLoadError, ConfigReadError } from "../src/ConfigFile.js";
import { ConfigFile } from "../src/ConfigFile.js";
import type { ConfigMigrationError } from "../src/ConfigMigration.js";
import { ConfigMigration } from "../src/ConfigMigration.js";
import { asConfigProvider, layerConfigProvider } from "../src/ConfigProvider.js";
import { ConfigResolver } from "../src/ConfigResolver.js";
import { ConfigEncryptionError, EncryptedCodec, EncryptedCodecKey } from "../src/EncryptedCodec.js";
import { JsonCodec } from "../src/JsonCodec.js";
import { MergeStrategy } from "../src/MergeStrategy.js";

class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}

type EncryptedError = ConfigCodecError | ConfigEncryptionError;
type MigratingEncryptedError = ConfigCodecError | ConfigEncryptionError | ConfigMigrationError;

const salt = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
const encrypted = EncryptedCodec(JsonCodec, EncryptedCodecKey.fromPassphrase("composition", salt));
const migratingEncrypted = ConfigMigration.make({
	codec: encrypted,
	migrations: [
		{
			version: 2,
			name: "default-port",
			up: (raw) => Effect.succeed({ ...(raw as Record<string, unknown>), port: 2020 }),
		},
	],
});

class Secrets extends ConfigFile.Service<Secrets, AppShape, EncryptedError>()("composition/Secrets") {}
class Migrated extends ConfigFile.Service<Migrated, AppShape, MigratingEncryptedError>()("composition/Migrated") {}
class Plain extends ConfigFile.Service<Plain, AppShape>()("composition/Plain") {}

const platform = (files: Record<string, string> = {}): Layer.Layer<FileSystem.FileSystem | Path.Path> =>
	Layer.mergeAll(MemoryFileSystem.layerWith(files), Path.layer);

describe("decorated codecs compose with ConfigFile", () => {
	it("the decorated codecs carry their widened error types", () => {
		// Compile-time pins: ConfigMigration.make keeps the inner codec's own
		// error type rather than resetting it to ConfigCodecError.
		const _encrypted: ConfigCodec<EncryptedError> = encrypted;
		const _migrating: ConfigCodec<MigratingEncryptedError> = migratingEncrypted;
		assert.strictEqual(_encrypted.name, "encrypted(json)");
		assert.strictEqual(_migrating.name, "encrypted(json)");
	});

	it("layer, testLayer and read accept both decorators", () => {
		const live = ConfigFile.layer(Secrets, {
			schema: AppShape,
			codec: encrypted,
			resolvers: [ConfigResolver.explicitPath("/app/secrets")],
			strategy: MergeStrategy.firstMatch<AppShape>(),
		});
		const migrated = ConfigFile.layer(Migrated, {
			schema: AppShape,
			codec: migratingEncrypted,
			resolvers: [],
			strategy: MergeStrategy.firstMatch(),
		});
		const seeded = ConfigFile.testLayer(Secrets, {
			schema: AppShape,
			codec: encrypted,
			strategy: MergeStrategy.firstMatch<AppShape>(),
			files: {},
		});
		const readEncrypted = ConfigFile.read("/app/secrets", { schema: AppShape, codec: encrypted });
		const readMigrated = ConfigFile.read("/app/secrets", { schema: AppShape, codec: migratingEncrypted });
		// `read`'s error channel widens with the codec instead of hiding its failures.
		const _readEncrypted: Effect.Effect<
			AppShape,
			ConfigReadError<EncryptedError>,
			FileSystem.FileSystem
		> = readEncrypted;
		const _readMigrated: Effect.Effect<
			AppShape,
			ConfigReadError<MigratingEncryptedError>,
			FileSystem.FileSystem
		> = readMigrated;
		// @ts-expect-error the narrow default union cannot hold a ConfigEncryptionError
		const _narrow: Effect.Effect<AppShape, ConfigReadError, FileSystem.FileSystem> = readEncrypted;
		for (const built of [live, migrated, seeded, _readEncrypted, _readMigrated, _narrow]) assert.isDefined(built);
	});

	it("a key declared over the built-in codec error rejects a decorated codec", () => {
		const build = () =>
			// @ts-expect-error Plain's methods promise ConfigCodecError only; this codec can also fail with ConfigEncryptionError
			ConfigFile.layer(Plain, {
				schema: AppShape,
				codec: encrypted,
				resolvers: [],
				strategy: MergeStrategy.firstMatch<AppShape>(),
			});
		const buildTest = () =>
			// @ts-expect-error the same rule holds for testLayer
			ConfigFile.testLayer(Plain, {
				schema: AppShape,
				codec: encrypted,
				strategy: MergeStrategy.firstMatch<AppShape>(),
				files: {},
			});
		for (const b of [build, buildTest]) assert.isFunction(b);
	});

	it("asConfigProvider and layerConfigProvider carry the decorated codec error", () => {
		// CE is inferred from the widened key and must reach the error channel;
		// the narrow default union cannot hold a ConfigEncryptionError.
		const _layer: Layer.Layer<never, ConfigLoadError<EncryptedError>, Secrets> = layerConfigProvider(Secrets);
		// @ts-expect-error the narrow ConfigLoadError drops ConfigEncryptionError
		const _narrowLayer: Layer.Layer<never, ConfigLoadError, Secrets> = layerConfigProvider(Secrets);
		const provider = Effect.flatMap(Secrets, asConfigProvider);
		const _provider: Effect.Effect<ConfigProvider.ConfigProvider, ConfigLoadError<EncryptedError>, Secrets> = provider;
		// @ts-expect-error the same rule holds for asConfigProvider
		const _narrowProvider: Effect.Effect<ConfigProvider.ConfigProvider, ConfigLoadError, Secrets> = provider;
		for (const built of [_layer, _narrowLayer, _provider, _narrowProvider]) assert.isDefined(built);
	});

	it.effect("an encrypted config round-trips through write and load", () =>
		Effect.gen(function* () {
			const secrets = yield* Secrets;
			yield* secrets.write(AppShape.make({ port: 8443 }), "/app/secrets");
			const loaded = yield* secrets.load;
			// The service's load error type names the decorator's failure.
			const _load: Effect.Effect<AppShape, ConfigLoadError<EncryptedError>> = secrets.load;
			assert.isDefined(_load);
			assert.strictEqual(loaded.port, 8443);
		}).pipe(
			Effect.provide(
				ConfigFile.layer(Secrets, {
					schema: AppShape,
					codec: encrypted,
					resolvers: [ConfigResolver.explicitPath("/app/secrets")],
					strategy: MergeStrategy.firstMatch<AppShape>(),
				}).pipe(Layer.provide(platform({ "/app/.keep": "" }))),
			),
		),
	);

	it.effect("read decrypts and migrates a file written by the decorated codec", () =>
		Effect.gen(function* () {
			// Version 1 on disk, encrypted; the migration stamps version 2 and a port.
			const ciphertext = yield* encrypted.stringify({ version: 1 });
			const value = yield* ConfigFile.read("/app/secrets", {
				schema: AppShape,
				codec: migratingEncrypted,
			}).pipe(Effect.provide(platform({ "/app/secrets": ciphertext })));
			assert.strictEqual(value.port, 2020);
		}),
	);

	it.effect("a decorator failure on the read path keeps its own tag", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				ConfigFile.read("/app/secrets", { schema: AppShape, codec: encrypted }).pipe(
					Effect.provide(platform({ "/app/secrets": "SGVs bG8=" })),
				),
			);
			assert.strictEqual(error._tag, "ConfigEncryptionError");
		}),
	);

	it.effect("a decorator failure on the write path emits StringifyFailed carrying that failure", () =>
		Effect.gen(function* () {
			// A key effect that fails makes `stringify` fail with ConfigEncryptionError,
			// not ConfigCodecError. The event must still fire: the codec's error type is
			// the caller's CE, so a tag check for "ConfigCodecError" would miss it.
			const keyFailure = new ConfigEncryptionError({ phase: "key-derivation", cause: new Error("kms unavailable") });
			const failingKey = EncryptedCodec(JsonCodec, EncryptedCodecKey.fromCryptoKey(Effect.fail(keyFailure)));
			const eventful = Layer.mergeAll(
				ConfigEvents.layer,
				ConfigFile.layer(Secrets, {
					schema: AppShape,
					codec: failingKey,
					resolvers: [],
					strategy: MergeStrategy.firstMatch<AppShape>(),
					events: ConfigEvents,
				}).pipe(Layer.provide(platform())),
			);
			const program = Effect.gen(function* () {
				const svc = yield* ConfigEvents;
				const sub = yield* PubSub.subscribe(svc.events);
				const cfg = yield* Secrets;
				const error = yield* Effect.flip(cfg.write(AppShape.make({ port: 1 }), "/x/secrets"));
				const events = yield* PubSub.takeUpTo(sub, Number.MAX_SAFE_INTEGER);
				return { error, events };
			});
			const { error, events } = yield* program.pipe(Effect.scoped, Effect.provide(eventful));
			assert.strictEqual(error, keyFailure);
			assert.deepStrictEqual(
				events.map((e) => e.event._tag),
				["StringifyFailed"],
			);
			const [event] = events;
			assert.isTrue(event !== undefined && event.event._tag === "StringifyFailed" && event.event.error === keyFailure);
		}),
	);
});
