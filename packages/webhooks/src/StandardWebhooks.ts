import type { DateTime } from "effect";
import { Effect, Redacted, Result } from "effect";
import * as Base64 from "effect/encoding/Base64";
import { annotateOutcome, checkFresh, matchesAny, readHeader, reject } from "./internal/verify.js";
import type { FreshnessOptions, WebhookRequest } from "./WebhookRequest.js";
import type { WebhookVerificationError } from "./WebhookVerificationError.js";

const PRESET = "StandardWebhooks";
const SECRET_PREFIX = "whsec_";
const STRICT_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const TIMESTAMP = /^\d{1,15}$/;

/**
 * What a verified Standard Webhooks delivery carries besides its body.
 *
 * @public
 */
export interface StandardWebhooksVerified {
	/** The message id, which the sender repeats on every retry. */
	readonly id: string;
	/** The signed timestamp. */
	readonly timestamp: DateTime.Utc;
}

/**
 * The HMAC key of a `whsec_` secret: the strict, padded base64 after an optional prefix, decoded.
 * `undefined` for anything else, including a secret that decodes to no bytes.
 */
const secretKey = (secret: string): Uint8Array | undefined => {
	const text = secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret;
	if (!STRICT_BASE64.test(text)) return undefined;
	const decoded = Base64.decode(text);
	return Result.isSuccess(decoded) && decoded.success.byteLength > 0 ? decoded.success : undefined;
};

/** The first of `names` with a non-empty value. */
const pick = (request: WebhookRequest, names: ReadonlyArray<string>): string | undefined => {
	for (const name of names) {
		const value = readHeader(request, name);
		if (value !== undefined) return value;
	}
	return undefined;
};

/** Every `v1` signature in a space-separated `v1,<base64>` list; other versions and malformed entries are ignored. */
const v1Signatures = (header: string): ReadonlyArray<string> =>
	header
		.split(" ")
		.map((entry) => entry.split(","))
		.filter((parts) => parts.length >= 2 && parts[0] === "v1")
		.map((parts) => parts.slice(1).join(","));

const verify = Effect.fn("StandardWebhooks.verify")(function* (request: WebhookRequest, options?: FreshnessOptions) {
	const signature = pick(request, ["svix-signature", "webhook-signature"]);
	if (signature === undefined) return yield* reject(PRESET, "missing_signature");
	const id = pick(request, ["svix-id", "webhook-id"]);
	if (id === undefined) return yield* reject(PRESET, "malformed", "no svix-id or webhook-id header");
	const timestamp = pick(request, ["svix-timestamp", "webhook-timestamp"]);
	if (timestamp === undefined)
		return yield* reject(PRESET, "malformed", "no svix-timestamp or webhook-timestamp header");
	if (!TIMESTAMP.test(timestamp)) return yield* reject(PRESET, "malformed", "the timestamp is not Unix seconds");

	const key = secretKey(Redacted.value(request.secret));
	if (key === undefined) {
		return yield* Effect.die(new Error("StandardWebhooks: the secret is not a whsec_ base64 secret"));
	}
	const candidates = v1Signatures(signature);
	if (candidates.length === 0) return yield* reject(PRESET, "bad_signature", "no v1 signature");
	const seconds = Number(timestamp);
	// Signed over the timestamp as an integer, so a zero-padded header still matches, as the reference does. Any v1
	// may match: the sender signs with every active secret during a rotation.
	const signed = [`${id}.${String(seconds)}.`, request.body];
	if (!(yield* matchesAny(key, signed, "base64", candidates))) {
		return yield* reject(PRESET, "bad_signature");
	}
	const verifiedAt = yield* checkFresh(PRESET, seconds * 1000, request.receivedAt, options);
	const verified: StandardWebhooksVerified = { id, timestamp: verifiedAt };
	return verified;
}, annotateOutcome(PRESET));

/**
 * Standard Webhooks, the scheme Svix signs with (Clerk and Resend send through Svix).
 *
 * @remarks
 * Reads `svix-id`, `svix-timestamp` and `svix-signature`, each falling back to its unbranded `webhook-` name when
 * absent, per header, as `svix`'s own `Webhook.verify` maps them. The signed bytes are `${id}.${timestamp}.` and then
 * the body; the signature header is a space-separated list of `v1,<base64>`, any of which may match.
 *
 * The secret is `whsec_` and strict padded base64 (the prefix is optional), and its decoded bytes are the HMAC key. A
 * secret that is not is a wiring mistake and dies rather than failing every delivery as `bad_signature`.
 *
 * @public
 */
export class StandardWebhooks {
	private constructor() {}

	/**
	 * Verify a delivery.
	 *
	 * @remarks
	 * `missing_signature` without a signature header; `malformed` without an id or timestamp, or with a timestamp
	 * that is not 1 to 15 digits of Unix seconds; `bad_signature` when no `v1` matches; `stale_timestamp` when the
	 * signature matches but the timestamp sits outside `tolerance` (five minutes by default) of `receivedAt`. The
	 * signature is always checked before the timestamp.
	 *
	 * Truly asynchronous: the HMAC runs on WebCrypto, so a test that forks this and then adjusts `TestClock` can race or
	 * hang. Await it, or gate the clock on a latch.
	 *
	 * @public
	 */
	static readonly verify: (
		request: WebhookRequest,
		options?: FreshnessOptions,
	) => Effect.Effect<StandardWebhooksVerified, WebhookVerificationError> = verify;
}
