// `ConfigCodec.ErrorOf<typeof codec>` reads a codec's error channel back from
// its type, so a `ConfigFile.Service` key declared over a decorated codec
// names the same union the codec carries, without spelling it out by hand.

import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Path, Schema } from "effect";
import type { ConfigCodec, ConfigCodecError } from "../src/ConfigCodec.js";
import type { ConfigLoadError } from "../src/ConfigFile.js";
import { ConfigFile } from "../src/ConfigFile.js";
import type { ConfigMigrationError } from "../src/ConfigMigration.js";
import { ConfigMigration } from "../src/ConfigMigration.js";
import { ConfigResolver } from "../src/ConfigResolver.js";
import type { ConfigEncryptionError } from "../src/EncryptedCodec.js";
import { EncryptedCodec, EncryptedCodecKey } from "../src/EncryptedCodec.js";
import { JsonCodec } from "../src/JsonCodec.js";
import { MergeStrategy } from "../src/MergeStrategy.js";

class AppShape extends Schema.Class<AppShape>("AppShape")({ port: Schema.Number }) {}

const salt = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const encrypted = EncryptedCodec(JsonCodec, EncryptedCodecKey.fromPassphrase("error-of", salt));
const migratingEncrypted = ConfigMigration.make({
	codec: encrypted,
	migrations: [{ version: 2, name: "noop", up: (raw) => Effect.succeed(raw) }],
});

// The key is declared over the codec's OWN error type, read back from the value.
class Secrets extends ConfigFile.Service<Secrets, AppShape, ConfigCodec.ErrorOf<typeof encrypted>>()(
	"error-of/Secrets",
) {}
class Migrated extends ConfigFile.Service<Migrated, AppShape, ConfigCodec.ErrorOf<typeof migratingEncrypted>>()(
	"error-of/Migrated",
) {}

type Equals<X, Y> = (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;

describe("ConfigCodec.ErrorOf", () => {
	it("reads the exact error union back from a codec value", () => {
		const builtIn: Equals<ConfigCodec.ErrorOf<typeof JsonCodec>, ConfigCodecError> = true;
		const decorated: Equals<ConfigCodec.ErrorOf<typeof encrypted>, ConfigCodecError | ConfigEncryptionError> = true;
		const stacked: Equals<
			ConfigCodec.ErrorOf<typeof migratingEncrypted>,
			ConfigCodecError | ConfigEncryptionError | ConfigMigrationError
		> = true;
		// A bare interface default is ConfigCodecError, and a non-codec is never.
		const defaulted: Equals<ConfigCodec.ErrorOf<ConfigCodec>, ConfigCodecError> = true;
		const notACodec: Equals<ConfigCodec.ErrorOf<{ readonly name: string }>, never> = true;
		// @ts-expect-error the decorator's error is part of the union, not dropped
		const narrow: Equals<ConfigCodec.ErrorOf<typeof encrypted>, ConfigCodecError> = true;
		for (const pin of [builtIn, decorated, stacked, defaulted, notACodec, narrow]) assert.isTrue(pin);
	});

	it("a key declared through ErrorOf accepts the codec it was read from", () => {
		const secrets = ConfigFile.layer(Secrets, {
			schema: AppShape,
			codec: encrypted,
			resolvers: [ConfigResolver.explicitPath("/app/secrets")],
			strategy: MergeStrategy.firstMatch<AppShape>(),
		});
		const migrated = ConfigFile.layer(Migrated, {
			schema: AppShape,
			codec: migratingEncrypted,
			resolvers: [],
			strategy: MergeStrategy.firstMatch<AppShape>(),
		});
		const build = () =>
			// @ts-expect-error Secrets names the encrypted codec's union; the stacked codec also fails with ConfigMigrationError
			ConfigFile.layer(Secrets, {
				schema: AppShape,
				codec: migratingEncrypted,
				resolvers: [],
				strategy: MergeStrategy.firstMatch<AppShape>(),
			});
		for (const built of [secrets, migrated, build]) assert.isDefined(built);
	});

	it.effect("the key round-trips a value through the codec it was declared over", () =>
		Effect.gen(function* () {
			const secrets = yield* Secrets;
			yield* secrets.write(AppShape.make({ port: 9000 }), "/app/secrets");
			const loaded = yield* secrets.load;
			// The service's method unions carry the union ErrorOf read back.
			const _load: Effect.Effect<AppShape, ConfigLoadError<ConfigCodecError | ConfigEncryptionError>> = secrets.load;
			assert.isDefined(_load);
			assert.strictEqual(loaded.port, 9000);
		}).pipe(
			Effect.provide(
				ConfigFile.layer(Secrets, {
					schema: AppShape,
					codec: encrypted,
					resolvers: [ConfigResolver.explicitPath("/app/secrets")],
					strategy: MergeStrategy.firstMatch<AppShape>(),
				}).pipe(Layer.provide(Layer.mergeAll(MemoryFileSystem.layerWith({ "/app/.keep": "" }), Path.layer))),
			),
		),
	);
});
