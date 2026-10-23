import { Schema } from "effect";

/**
 * Why a cryptographic operation failed.
 *
 * @remarks
 * Route on this value, never on `message`. The set is closed:
 *
 * - `unsupportedRuntime` — the runtime has no WebCrypto `subtle`.
 * - `key` — WebCrypto refused the key material (for example an empty HMAC key).
 * - `path` — a SigV4 request path holds a `.` or `..` segment, which no URL can
 *   carry as signed. Caller input, not a wiring defect.
 *
 * A digest failure is not one of these: digests come from core `Crypto`, so
 * they fail with core's own `PlatformError`.
 *
 * @public
 */
export const CryptoErrorReason = Schema.Literals(["unsupportedRuntime", "key", "path"]);

/**
 * The reason union carried by {@link CryptoError}.
 *
 * @public
 */
export type CryptoErrorReason = typeof CryptoErrorReason.Type;

/**
 * The one error `@effected/crypto` fails with.
 *
 * @remarks
 * `reason` is the routing key; `detail` is human-readable, names the runtime,
 * the algorithm or the offending path segment and never the key, and may change between releases.
 *
 * @public
 */
export class CryptoError extends Schema.TaggedError<CryptoError>()("CryptoError", {
	/** Why the operation failed; the routing key. */
	reason: CryptoErrorReason,
	/** Human-readable detail. */
	detail: Schema.String,
	/** The underlying failure, when there is one. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		return `crypto ${this.reason}: ${this.detail}`;
	}

	/** @internal */
	static of(reason: CryptoErrorReason, detail: string, cause?: unknown): CryptoError {
		return new CryptoError({ reason, detail, ...(cause !== undefined ? { cause } : {}) });
	}
}
