import type { DateTime } from "effect";
import { Effect } from "effect";
import type { Mac } from "effect/crypto";
import { annotateOutcome, checkFresh, matchesAny, readHeader, reject } from "./internal/verify.js";
import type { FreshnessOptions, WebhookRequest } from "./WebhookRequest.js";
import type { WebhookVerificationError } from "./WebhookVerificationError.js";

const PRESET = "Sanity";
/** The header grammar, exactly as `@sanity/webhook`'s `decodeSignatureHeader` parses it. */
const SIGNATURE = /^t=(\d+)[, ]+v1=([^, ]+)$/;

/**
 * What a verified Sanity delivery carries besides its body.
 *
 * @public
 */
export interface SanityVerified {
	/** The signed timestamp, the header's `t`. */
	readonly timestamp: DateTime.Utc;
}

const verify = Effect.fn("Sanity.verify")(function* (request: WebhookRequest, options?: FreshnessOptions) {
	const header = readHeader(request, "sanity-webhook-signature");
	if (header === undefined) return yield* reject(PRESET, "missing_signature");
	const match = SIGNATURE.exec(header);
	const t = match?.[1];
	const signature = match?.[2];
	if (t === undefined || signature === undefined) return yield* reject(PRESET, "bad_signature", "not t=<ms>,v1=<sig>");
	if (!(yield* matchesAny(request.secret, [`${t}.`, request.body], "base64url", [signature]))) {
		return yield* reject(PRESET, "bad_signature");
	}
	// `t` is milliseconds.
	const timestamp = yield* checkFresh(PRESET, Number(t), request.receivedAt, options);
	const verified: SanityVerified = { timestamp };
	return verified;
}, annotateOutcome(PRESET));

/**
 * Sanity's `sanity-webhook-signature` scheme.
 *
 * @remarks
 * The header is `t=<unix milliseconds>,v1=<signature>` with exactly one `v1`. The signed bytes are `${t}.` and then
 * the body, and the signature is the unpadded base64url HMAC-SHA256 under the secret's UTF-8 bytes, as
 * `@sanity/webhook` computes it.
 *
 * @public
 */
export class Sanity {
	private constructor() {}

	/**
	 * Verify a delivery.
	 *
	 * @remarks
	 * `missing_signature` without the header; `bad_signature` when it is not `t=<ms>,v1=<sig>` or the signature does
	 * not match; `stale_timestamp` when the signature matches but `t` sits outside `tolerance` (five minutes by
	 * default) of `receivedAt`. The signature is always checked before the timestamp.
	 *
	 * Requires `Mac.Mac` (`effect/crypto`) in `R`: `Mac.layerWebCrypto` with `SecureRandom.layerWebCrypto`, or a
	 * platform family layer such as `NodeCrypto.layerMac`. A `CryptoError` from the `Mac` layer is a defect, as is a
	 * runtime with no `crypto.subtle` on the WebCrypto layer.
	 *
	 * On `Mac.layerWebCrypto` this is truly asynchronous: a test that forks it and then adjusts `TestClock` can race or
	 * hang. Await it, or gate the clock on a latch.
	 *
	 * @public
	 */
	static readonly verify: (
		request: WebhookRequest,
		options?: FreshnessOptions,
	) => Effect.Effect<SanityVerified, WebhookVerificationError, Mac.Mac> = verify;
}
