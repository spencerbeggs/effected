import { Schema } from "effect";

/**
 * Why a cryptographic operation failed.
 *
 * @remarks
 * Route on this value, never on `message`. The set is closed:
 *
 * - `unsupportedRuntime` — the runtime has no WebCrypto `subtle`.
 * - `key` — WebCrypto refused the key material (for example an empty HMAC key).
 *
 * Both are wiring defects, not caller input: a caller usually dies on them
 * with `Effect.orDie`. A SigV4 path no URL can carry is caller input, so it
 * is its own tag, {@link SigV4PathError}.
 *
 * A digest failure is not one of these: digests come from core `Crypto`, so
 * they fail with core's own `PlatformError`.
 *
 * @public
 */
export const CryptoErrorReason = Schema.Literals(["unsupportedRuntime", "key"]);

/**
 * The reason union carried by {@link CryptoError}.
 *
 * @public
 */
export type CryptoErrorReason = typeof CryptoErrorReason.Type;

/**
 * The wiring-defect error `@effected/crypto` fails with: no WebCrypto, or key
 * material it refuses.
 *
 * @remarks
 * `reason` is the routing key; `detail` is human-readable, names the runtime
 * or the algorithm and never the key, and may change between releases. Caller
 * input that SigV4 cannot sign fails with {@link SigV4PathError} instead.
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
