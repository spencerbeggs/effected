import { Schema } from "effect";

/**
 * Why a JWS or JWT operation failed.
 *
 * @remarks
 * Route on this value, never on `message`. The set is closed:
 *
 * - `malformed` — the token is not three base64url segments of JSON, JSON, bytes.
 * - `unsupportedAlgorithm` — the algorithm is not `RS256` or `ES256` (`none` is never accepted).
 * - `algorithmMismatch` — the header's `alg` differs from the key's algorithm.
 * - `badSignature` — the signature does not verify.
 * - `unknownKid` — no key in the key set carries the token's `kid`.
 * - `expired` / `notYetValid` — `exp` / `nbf` fall outside the clock tolerance.
 * - `wrongIssuer` / `wrongAudience` — `iss` / `aud` do not match what was required.
 * - `claims` — the claims are not the expected shape.
 * - `key` — key material could not be imported or generated.
 * - `jwksFetch` — the key set could not be discovered or fetched.
 * - `unsupportedRuntime` — the runtime has no WebCrypto `subtle`.
 *
 * @public
 */
export const JwtErrorReason = Schema.Literals([
	"malformed",
	"unsupportedAlgorithm",
	"algorithmMismatch",
	"badSignature",
	"unknownKid",
	"expired",
	"notYetValid",
	"wrongIssuer",
	"wrongAudience",
	"claims",
	"key",
	"jwksFetch",
	"unsupportedRuntime",
]);

/**
 * The reason union carried by {@link JwtError}.
 *
 * @public
 */
export type JwtErrorReason = typeof JwtErrorReason.Type;

/**
 * The one error `@effected/jwt` fails with.
 *
 * @remarks
 * `reason` is the routing key; `detail` is human-readable and may change
 * between releases. `kid` is set when the failure concerns a specific key.
 *
 * @public
 */
export class JwtError extends Schema.TaggedError<JwtError>()("JwtError", {
	/** Why the operation failed; the routing key. */
	reason: JwtErrorReason,
	/** Human-readable detail. */
	detail: Schema.String,
	/** The key id the failure concerns, when there is one. */
	kid: Schema.optionalKey(Schema.String),
	/** The underlying failure, when there is one. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		return `JWT ${this.reason}: ${this.detail}`;
	}

	/** @internal */
	static of(
		reason: JwtErrorReason,
		detail: string,
		extra?: { readonly kid?: string; readonly cause?: unknown },
	): JwtError {
		return new JwtError({
			reason,
			detail,
			...(extra?.kid !== undefined ? { kid: extra.kid } : {}),
			...(extra?.cause !== undefined ? { cause: extra.cause } : {}),
		});
	}
}
