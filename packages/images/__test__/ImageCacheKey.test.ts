import { createHash } from "node:crypto";
import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, layer } from "@effect/vitest";
import { Effect, Layer, Schema, SchemaTransformation } from "effect";
import { Digest } from "effect/crypto";
import { ImageCacheKey, ImageCacheKeyError } from "../src/cache.js";

const Params = Schema.Struct({
	name: Schema.String,
	version: Schema.String,
	tagline: Schema.optionalKey(Schema.String),
});
const OPTIONS = { salt: "og-v1", namespace: "og" } as const;
const digestOf = (params: typeof Params.Type, options: { salt: string; namespace: string } = OPTIONS) =>
	ImageCacheKey.fromParams(Params, params, options).pipe(Effect.map((key) => key.digest));

layer(NodeCrypto.layerDigest)("ImageCacheKey.fromParams", (it) => {
	it.effect("hashes exactly salt NUL canonical-json with SHA-256, as lowercase hex", () =>
		Effect.gen(function* () {
			const key = yield* ImageCacheKey.fromParams(Params, { version: "1.0.0", name: "pkg" }, OPTIONS);
			const expected = createHash("sha256").update('og-v1\u0000{"name":"pkg","version":"1.0.0"}', "utf8").digest("hex");
			assert.strictEqual(key.digest, expected);
			assert.strictEqual(key.salt, "og-v1");
			assert.strictEqual(key.namespace, "og");
		}),
	);

	it.effect("is independent of property order", () =>
		Effect.gen(function* () {
			assert.strictEqual(
				yield* digestOf({ name: "pkg", version: "1" }),
				yield* digestOf({ version: "1", name: "pkg" }),
			);
		}),
	);

	it.effect("changes with the salt, the params, and an optional field's presence", () =>
		Effect.gen(function* () {
			const base = yield* digestOf({ name: "pkg", version: "1" });
			assert.notStrictEqual(base, yield* digestOf({ name: "pkg", version: "1" }, { ...OPTIONS, salt: "og-v2" }));
			assert.notStrictEqual(base, yield* digestOf({ name: "pkg", version: "2" }));
			assert.notStrictEqual(base, yield* digestOf({ name: "pkg", version: "1", tagline: "" }));
		}),
	);

	it.effect("does not change with the namespace (namespace is a tag, not identity)", () =>
		Effect.gen(function* () {
			assert.strictEqual(
				yield* digestOf({ name: "pkg", version: "1" }),
				yield* digestOf({ name: "pkg", version: "1" }, { ...OPTIONS, namespace: "other" }),
			);
		}),
	);

	it.effect("hashes the ENCODED form, so a transformation participates", () =>
		Effect.gen(function* () {
			const viaNumber = yield* ImageCacheKey.fromParams(
				Schema.Struct({ n: Schema.NumberFromString }),
				{ n: 5 },
				OPTIONS,
			);
			const viaString = yield* ImageCacheKey.fromParams(Schema.Struct({ n: Schema.String }), { n: "5" }, OPTIONS);
			assert.strictEqual(viaNumber.digest, viaString.digest);
		}),
	);

	it.effect("an effectful encoding is supported and hashes like the equivalent sync schema", () =>
		Effect.gen(function* () {
			// The encode runs through an Effect (a yield), so it is not expressible as a sync encode.
			const AsyncNumber = Schema.String.pipe(
				Schema.decodeTo(
					Schema.Number,
					SchemaTransformation.transformEffect<number, string>({
						decode: (s) => Effect.succeed(Number(s)),
						encode: (n) => Effect.yieldNow.pipe(Effect.as(String(n))),
					}),
				),
			);
			const viaEffectful = yield* ImageCacheKey.fromParams(Schema.Struct({ n: AsyncNumber }), { n: 5 }, OPTIONS);
			const viaSync = yield* ImageCacheKey.fromParams(Schema.Struct({ n: Schema.NumberFromString }), { n: 5 }, OPTIONS);
			assert.strictEqual(viaEffectful.digest, viaSync.digest);
		}),
	);

	it.effect("a schema rejection is an encode failure", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(ImageCacheKey.fromParams(Params, { name: 7 } as never, OPTIONS));
			assert.instanceOf(error, ImageCacheKeyError);
			assert.strictEqual(error.reason, "encode");
			assert.instanceOf(error.cause, Schema.SchemaError);
		}),
	);

	it.effect("an encoded value JSON cannot carry is a non-json failure", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				ImageCacheKey.fromParams(Schema.Struct({ when: Schema.Date }), { when: new Date(0) }, OPTIONS),
			);
			assert.strictEqual(error.reason, "non-json");
		}),
	);
});

describe("ImageCacheKey.fromParams with a Digest double", () => {
	const seen: Array<string> = [];
	const fixed = Layer.mock(Digest.Digest, {
		digestHex: (algorithm, data) =>
			Effect.sync(() => {
				seen.push(`${algorithm.name}:${new TextDecoder().decode(data)}`);
				return "a".repeat(64);
			}),
	});

	layer(fixed)((it) => {
		it.effect("takes the SHA-256 of salt NUL canonical-json from the Digest service in R", () =>
			Effect.gen(function* () {
				const key = yield* ImageCacheKey.fromParams(Params, { name: "pkg", version: "1" }, OPTIONS);
				assert.strictEqual(key.digest, "a".repeat(64));
				assert.deepStrictEqual(seen, ['SHA-256:og-v1\u0000{"name":"pkg","version":"1"}']);
			}),
		);
	});
});
