import { Schema } from "effect";

/**
 * Cache-key parameters that could not be turned into a key.
 *
 * @remarks
 * `encode`: the parameter schema rejected the params. `non-json`: the encoded form holds a value canonical JSON
 * cannot carry (a `Date`, a `bigint`, a non-finite number, a class instance). `digest`: the `Crypto` service failed.
 *
 * @public
 */
export class ImageCacheKeyError extends Schema.TaggedError<ImageCacheKeyError>()("ImageCacheKeyError", {
	/** Which step failed. */
	reason: Schema.Literals(["encode", "non-json", "digest"]),
	/** What exactly was wrong. */
	detail: Schema.String,
	/** The schema error (`encode`) or platform error (`digest`). */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		return `Cannot derive an image cache key (${this.reason}): ${this.detail}`;
	}
}
