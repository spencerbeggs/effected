// A decorated codec reaches AppConfig.layer.
//
// `AppConfigOptions` and `AppConfig.layer` are generic over the codec error
// `CE`, mirroring `ConfigFile.layer`: an `EncryptedCodec` or a
// `ConfigMigration.make` codec goes straight in, the key must name the widened
// union, and the union reaches the service's own method error types. Mirrors
// config-file's `DecoratedCodecComposition.test.ts` at the app edge.

import { assert, describe, it } from "@effect/vitest";
import type { ConfigCodec, ConfigCodecError, ConfigLoadError } from "@effected/config-file";
import {
	ConfigEncryptionError,
	ConfigFile,
	ConfigMigration,
	EncryptedCodec,
	EncryptedCodecKey,
	JsonCodec,
} from "@effected/config-file";
import { MemoryFileSystem } from "@effected/memfs";
import { AppDirs, CurrentPlatform, Xdg, XdgPaths } from "@effected/xdg";
import type { FileSystem } from "effect";
import { Effect, Layer, Path, Schema } from "effect";
import type { AppConfigOptions } from "../src/index.js";
import { AppConfig } from "../src/index.js";

class Shape extends Schema.Class<Shape>("Shape")({ port: Schema.Number }) {}

type EncryptedError = ConfigCodecError | ConfigEncryptionError;

const salt = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2]);
const encrypted = EncryptedCodec(JsonCodec, EncryptedCodecKey.fromPassphrase("app-composition", salt));
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

class Secrets extends ConfigFile.Service<Secrets, Shape, EncryptedError>()("app-composition/Secrets") {}
class Migrated extends ConfigFile.Service<Migrated, Shape, ConfigCodec.ErrorOf<typeof migratingEncrypted>>()(
	"app-composition/Migrated",
) {}
class Plain extends ConfigFile.Service<Plain, Shape>()("app-composition/Plain") {}

const xdgPaths = XdgPaths.make({
	home: "/home/test",
	configHome: "/home/test/.config",
	configDirs: ["/etc/xdg"],
	dataDirs: ["/usr/share"],
});

/** AppDirs for `myapp` over a seeded in-memory volume, so saves land somewhere real. */
const harness = (files: Record<string, string> = {}) => {
	const base = Layer.mergeAll(
		Path.layer,
		MemoryFileSystem.layerWith(files),
		Layer.succeed(CurrentPlatform, "linux"),
		Xdg.layerFrom(xdgPaths),
	);
	return Layer.provideMerge(AppDirs.layer({ namespace: "myapp" }), base);
};

describe("AppConfig.layer with a decorated codec", () => {
	it("AppConfigOptions carries the codec error and defaults it to ConfigCodecError", () => {
		const plain: AppConfigOptions<Shape, { readonly port: number }> = {
			filename: "rc.json",
			schema: Shape,
			codec: JsonCodec,
		};
		const widened: AppConfigOptions<Shape, { readonly port: number }, never, EncryptedError> = {
			filename: "secrets.enc",
			schema: Shape,
			codec: encrypted,
		};
		const narrow: AppConfigOptions<Shape, { readonly port: number }> = {
			filename: "secrets.enc",
			schema: Shape,
			// @ts-expect-error the default CE is ConfigCodecError; an encrypted codec also fails with ConfigEncryptionError
			codec: encrypted,
		};
		for (const options of [plain, widened, narrow]) assert.isDefined(options);
	});

	it("accepts both decorators when the key names the widened union", () => {
		const secrets = AppConfig.layer(Secrets, { filename: "secrets.enc", schema: Shape, codec: encrypted });
		const migrated = AppConfig.layer(Migrated, { filename: "secrets.enc", schema: Shape, codec: migratingEncrypted });
		// A decorated codec changes nothing about R: the platform and the ambient dirs, as always.
		const _secrets: Layer.Layer<Secrets, never, FileSystem.FileSystem | Path.Path | AppDirs | Xdg> = secrets;
		for (const built of [secrets, migrated, _secrets]) assert.isDefined(built);
	});

	it("a key declared over the built-in codec error rejects a decorated codec", () => {
		const build = () =>
			// @ts-expect-error Plain's methods promise ConfigCodecError only; this codec can also fail with ConfigEncryptionError
			AppConfig.layer(Plain, { filename: "secrets.enc", schema: Shape, codec: encrypted });
		const buildNarrowKey = () =>
			// @ts-expect-error Secrets names the encrypted union; the stacked codec also fails with ConfigMigrationError
			AppConfig.layer(Secrets, { filename: "secrets.enc", schema: Shape, codec: migratingEncrypted });
		for (const b of [build, buildNarrowKey]) assert.isFunction(b);
	});

	it.effect("an encrypted config round-trips through save and load under the app's namespace", () =>
		Effect.gen(function* () {
			const secrets = yield* Secrets;
			// The service's load error type names the decorator's failure.
			const _load: Effect.Effect<Shape, ConfigLoadError<EncryptedError>> = secrets.load;
			assert.isDefined(_load);
			const saved = yield* secrets.save(Shape.make({ port: 8443 }));
			assert.strictEqual(saved, "/home/test/.config/myapp/secrets.enc");
			const loaded = yield* secrets.load;
			assert.strictEqual(loaded.port, 8443);
			// What landed on disk is ciphertext, not the document.
			const volume = yield* MemoryFileSystem.Volume;
			assert.notInclude(volume.text(saved), "8443");
		}).pipe(
			Effect.provide(
				AppConfig.layer(Secrets, { filename: "secrets.enc", schema: Shape, codec: encrypted }).pipe(
					Layer.provideMerge(harness()),
				),
			),
		),
	);

	it.effect("a decorator failure on the load path keeps its own tag", () =>
		Effect.gen(function* () {
			const secrets = yield* Secrets;
			const error = yield* Effect.flip(secrets.load);
			assert.instanceOf(error, ConfigEncryptionError);
		}).pipe(
			Effect.provide(
				AppConfig.layer(Secrets, { filename: "secrets.enc", schema: Shape, codec: encrypted }).pipe(
					Layer.provide(harness({ "/home/test/.config/myapp/secrets.enc": "SGVs bG8=" })),
				),
			),
		),
	);

	it.effect("load decrypts and migrates a file written by the decorated codec", () =>
		Effect.gen(function* () {
			const ciphertext = yield* encrypted.stringify({ version: 1 });
			const value = yield* Effect.gen(function* () {
				const migrated = yield* Migrated;
				return yield* migrated.load;
			}).pipe(
				Effect.provide(
					AppConfig.layer(Migrated, { filename: "secrets.enc", schema: Shape, codec: migratingEncrypted }).pipe(
						Layer.provide(harness({ "/home/test/.config/myapp/secrets.enc": ciphertext })),
					),
				),
			);
			assert.strictEqual(value.port, 2020);
		}),
	);
});
