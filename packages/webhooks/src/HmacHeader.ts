import type { HmacAlgorithm } from "@effected/crypto";
import { Hmac } from "@effected/crypto";
import { Effect } from "effect";
import { annotateOutcome, readHeader, reject } from "./internal/verify.js";
import type { WebhookRequest } from "./WebhookRequest.js";
import type { WebhookVerificationError } from "./WebhookVerificationError.js";

const PRESET = "HmacHeader";

/**
 * Where a generic HMAC signature lives and how it is written.
 *
 * @public
 */
export interface HmacHeaderOptions {
	/** The header carrying the signature, lower case. */
	readonly header: string;
	/** How the signature is encoded: `hex` (either case) or padded `base64`. */
	readonly encoding: "hex" | "base64";
	/** The hash; `SHA-256` when omitted. */
	readonly algorithm?: HmacAlgorithm;
	/** A literal the header value starts with before the signature, such as `sha256=`. */
	readonly prefix?: string;
}

const verify = Effect.fn("HmacHeader.verify")(function* (request: WebhookRequest, options: HmacHeaderOptions) {
	const header = readHeader(request, options.header);
	if (header === undefined) return yield* reject(PRESET, "missing_signature");
	const prefix = options.prefix ?? "";
	if (!header.startsWith(prefix)) return yield* reject(PRESET, "bad_signature", "the signature prefix is missing");
	// Compared as bytes: the signature is decoded and checked against the MAC in
	// constant time, so any spelling that decodes to the right MAC is accepted.
	const verified = yield* Hmac.verify({
		algorithm: options.algorithm ?? "SHA-256",
		key: request.secret,
		message: request.body,
		signature: header.slice(prefix.length),
		encoding: options.encoding,
	}).pipe(Effect.orDie);
	if (!verified) return yield* reject(PRESET, "bad_signature");
}, annotateOutcome(PRESET));

/**
 * A generic HMAC of the body in a caller-named header, for senders with no timestamp in the signed bytes.
 *
 * @remarks
 * The signature is the HMAC of the body under the secret's UTF-8 bytes, hex or base64, optionally behind a literal
 * prefix. It covers Linear's bare hex `linear-signature`; Linear's timestamp is inside the JSON body, so check it with
 * `Webhooks.checkFreshness` after decoding.
 *
 * @public
 */
export class HmacHeader {
	private constructor() {}

	/**
	 * Verify a delivery.
	 *
	 * @remarks
	 * `missing_signature` without the header; `bad_signature` when the prefix is missing or the signature does not
	 * match. The signature is decoded and compared as bytes with `@effected/crypto`'s `Hmac.verify`, so any spelling
	 * that decodes to the right MAC verifies: hex in either case, and padded base64 even when it is not the canonical
	 * spelling. One that does not decode, unpadded base64 included, is `bad_signature`.
	 *
	 * Truly asynchronous: the HMAC runs on WebCrypto, so a test that forks this and then adjusts `TestClock` can race or
	 * hang. Await it, or gate the clock on a latch.
	 *
	 * @public
	 */
	static readonly verify: (
		request: WebhookRequest,
		options: HmacHeaderOptions,
	) => Effect.Effect<void, WebhookVerificationError> = verify;
}
