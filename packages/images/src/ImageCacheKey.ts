import { Crypto, Effect, Result, Schema } from "effect";
import * as Hex from "effect/encoding/Hex";
import { ImageCacheKeyError } from "./ImageCacheKeyError.js";
import { canonicalJson } from "./internal/canonical.js";
import { DIGEST_PATTERN } from "./internal/digest.js";

/**
 * Options for {@link ImageCacheKey.fromParams}.
 *
 * @public
 */
export interface ImageCacheKeyOptions {
	/** The generator's identity: change it when the template changes, and every old key misses. */
	readonly salt: string;
	/** A grouping tag the backend records (store can invalidate by it); not part of the digest. */
	readonly namespace: string;
}

/**
 * The identity of one generated image: a SHA-256 digest of the salt and the schema-encoded parameters.
 *
 * @public
 */
export class ImageCacheKey extends Schema.Class<ImageCacheKey>("ImageCacheKey")({
	/** Lowercase hex SHA-256 of `salt`, a NUL, and the canonical JSON of the encoded params. */
	digest: Schema.String.check(Schema.isPattern(DIGEST_PATTERN)),
	/** The salt the digest was derived with. */
	salt: Schema.String,
	/** The grouping tag. */
	namespace: Schema.String,
}) {
	/**
	 * Derive a key.
	 *
	 * @remarks
	 * `params` are encoded through `schema`, so a transformation participates and the key reflects the wire form. The
	 * digest is core `Crypto`'s SHA-256, so `Crypto` is required — Node apps get it from `NodeServices.layer` or
	 * `NodeCrypto.layer`.
	 */
	static fromParams<S extends Schema.ConstraintEncoder<unknown>>(
		schema: S,
		params: S["Type"],
		options: ImageCacheKeyOptions,
	): Effect.Effect<ImageCacheKey, ImageCacheKeyError, Crypto.Crypto> {
		return Effect.gen(function* () {
			const encoded = yield* Schema.encodeEffect(schema)(params).pipe(
				Effect.mapError((cause) => new ImageCacheKeyError({ reason: "encode", detail: cause.message, cause })),
			);
			const canonical = canonicalJson(encoded);
			if (Result.isFailure(canonical))
				return yield* new ImageCacheKeyError({ reason: "non-json", detail: canonical.failure });
			const crypto = yield* Crypto.Crypto;
			const bytes = yield* crypto
				.digest("SHA-256", new TextEncoder().encode(`${options.salt}\u0000${canonical.success}`))
				.pipe(Effect.mapError((cause) => new ImageCacheKeyError({ reason: "digest", detail: cause.message, cause })));
			return ImageCacheKey.make({ digest: Hex.encode(bytes), salt: options.salt, namespace: options.namespace });
		}).pipe(Effect.withSpan("ImageCacheKey.fromParams", { attributes: { namespace: options.namespace } }));
	}
}
