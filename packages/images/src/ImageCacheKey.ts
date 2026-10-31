import { Effect, Result, Schema } from "effect";
import { Digest } from "effect/crypto";
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
	 * digest is core `Digest`'s SHA-256, so `Digest.Digest` is required — provide `Digest.layerWebCrypto` from
	 * `effect/crypto`, or a platform family layer such as `NodeCrypto.layerDigest`. `NodeServices.layer` does not
	 * include it.
	 */
	static fromParams<S extends Schema.ConstraintEncoder<unknown>>(
		schema: S,
		params: S["Type"],
		options: ImageCacheKeyOptions,
	): Effect.Effect<ImageCacheKey, ImageCacheKeyError, Digest.Digest> {
		return Effect.gen(function* () {
			const encoded = yield* Schema.encodeEffect(schema)(params).pipe(
				Effect.mapError((cause) => new ImageCacheKeyError({ reason: "encode", detail: cause.message, cause })),
			);
			const canonical = canonicalJson(encoded);
			if (Result.isFailure(canonical))
				return yield* new ImageCacheKeyError({ reason: "non-json", detail: canonical.failure });
			const digest = yield* Digest.Digest;
			const hex = yield* digest.digestHex(
				Digest.sha256,
				new TextEncoder().encode(`${options.salt}\u0000${canonical.success}`),
			);
			return ImageCacheKey.make({ digest: hex, salt: options.salt, namespace: options.namespace });
		}).pipe(Effect.withSpan("ImageCacheKey.fromParams", { attributes: { namespace: options.namespace } }));
	}
}
