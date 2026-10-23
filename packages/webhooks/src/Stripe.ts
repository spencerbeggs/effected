import type { DateTime } from "effect";
import { Effect } from "effect";
import { annotateOutcome, checkFresh, matchesAny, readHeader, reject } from "./internal/verify.js";
import type { FreshnessOptions, WebhookRequest } from "./WebhookRequest.js";
import type { WebhookVerificationError } from "./WebhookVerificationError.js";

const PRESET = "Stripe";
const TIMESTAMP = /^\d{1,15}$/;

/**
 * What a verified Stripe delivery carries besides its body.
 *
 * @public
 */
export interface StripeVerified {
	/** The signed timestamp, the header's `t`. */
	readonly timestamp: DateTime.Utc;
}

/** The header's last valid `t` and every `v1`; `v0` and unknown keys are ignored. */
const parse = (header: string): { readonly t: string | undefined; readonly v1: ReadonlyArray<string> } => {
	let t: string | undefined;
	const v1: Array<string> = [];
	for (const item of header.split(",")) {
		const at = item.indexOf("=");
		if (at < 0) continue;
		const key = item.slice(0, at).trim();
		const value = item.slice(at + 1).trim();
		if (key === "t" && TIMESTAMP.test(value)) t = value;
		else if (key === "v1") v1.push(value);
	}
	return { t, v1 };
};

const verify = Effect.fn("Stripe.verify")(function* (request: WebhookRequest, options?: FreshnessOptions) {
	const header = readHeader(request, "stripe-signature");
	if (header === undefined) return yield* reject(PRESET, "missing_signature");
	const { t, v1 } = parse(header);
	if (t === undefined) return yield* reject(PRESET, "bad_signature", "no t=<unix seconds>");
	if (v1.length === 0) return yield* reject(PRESET, "bad_signature", "no v1 signature");
	// The whsec_ secret is the key as a literal string; Stripe never decodes it. Any v1 may match: during a secret
	// roll Stripe signs with both the old and the new secret.
	if (!(yield* matchesAny(request.secret, [`${t}.`, request.body], "hex", v1))) {
		return yield* reject(PRESET, "bad_signature");
	}
	const timestamp = yield* checkFresh(PRESET, Number(t) * 1000, request.receivedAt, options);
	const verified: StripeVerified = { timestamp };
	return verified;
}, annotateOutcome(PRESET));

/**
 * Stripe's `stripe-signature` scheme.
 *
 * @remarks
 * The header is comma-separated `key=value` pairs: the last valid `t` (Unix seconds) wins, every `v1` is a
 * candidate and `v0` is ignored. The signed bytes are `${t}.` and then the body, and the signature is the lower-case
 * hex HMAC-SHA256 keyed by the secret string verbatim, `whsec_` prefix and all.
 *
 * @public
 */
export class Stripe {
	private constructor() {}

	/**
	 * Verify a delivery.
	 *
	 * @remarks
	 * `missing_signature` without the header; `bad_signature` when it carries no `t` or no `v1`, or no `v1` matches;
	 * `stale_timestamp` when the signature matches but `t` sits outside `tolerance` (five minutes by default) of
	 * `receivedAt`. The signature is always checked before the timestamp.
	 *
	 * Truly asynchronous: the HMAC runs on WebCrypto, so a test that forks this and then adjusts `TestClock` can race or
	 * hang. Await it, or gate the clock on a latch.
	 *
	 * @public
	 */
	static readonly verify: (
		request: WebhookRequest,
		options?: FreshnessOptions,
	) => Effect.Effect<StripeVerified, WebhookVerificationError> = verify;
}
