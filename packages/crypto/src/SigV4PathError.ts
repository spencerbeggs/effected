import { Schema } from "effect";

/**
 * A SigV4 request path holds a segment that is exactly `.` or `..`, so it
 * cannot be sent as signed.
 *
 * @remarks
 * Every URL parser collapses such a segment, so the request would reach
 * another path than the one signed; percent-encoding cannot help, since both
 * characters are unreserved. This is caller input, not a wiring defect, which
 * is why it is its own tag rather than a {@link CryptoError} reason: recover
 * from it with `Effect.catchTag("SigV4PathError", ...)` and let `CryptoError`
 * die. `SigV4.canonicalize` and `SigV4.sign` raise it before anything is
 * hashed or signed.
 *
 * @public
 */
export class SigV4PathError extends Schema.TaggedError<SigV4PathError>()("SigV4PathError", {
	/** The unencoded request path, as the caller passed it. */
	path: Schema.String,
	/** The offending segment: `.` or `..`. */
	segment: Schema.String,
}) {
	override get message(): string {
		return `the SigV4 path "${this.path}" has a "${this.segment}" segment, which a URL collapses, so it cannot be sent as signed`;
	}
}
