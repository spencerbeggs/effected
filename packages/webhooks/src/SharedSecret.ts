import { ConstantTime } from "@effected/crypto";
import { Effect } from "effect";
import { annotateOutcome, readRawHeader, reject } from "./internal/verify.js";
import type { WebhookRequest } from "./WebhookRequest.js";
import type { WebhookVerificationError } from "./WebhookVerificationError.js";

const PRESET = "SharedSecret";

/**
 * Where a shared secret is delivered.
 *
 * @public
 */
export interface SharedSecretOptions {
	/** The header carrying the secret itself, lower case. */
	readonly header: string;
}

const verify = Effect.fn("SharedSecret.verify")(function* (request: WebhookRequest, options: SharedSecretOptions) {
	// Raw, never trimmed: whitespace around a secret is a different secret.
	const received = readRawHeader(request, options.header);
	if (received === undefined) return yield* reject(PRESET, "missing_signature");
	// A CryptoError means no WebCrypto or a refused blinding key: a broken runtime, not a bad delivery.
	const equal = yield* ConstantTime.secretsEqual(request.secret, received).pipe(Effect.orDie);
	if (!equal) return yield* reject(PRESET, "bad_signature");
}, annotateOutcome(PRESET));

/**
 * A shared secret sent verbatim in a caller-named header, such as Cloudflare's `cf-webhook-auth`.
 *
 * @remarks
 * Compared with `ConstantTime.secretsEqual`, which blinds both sides with an HMAC under a fresh WebCrypto key first,
 * so neither the secret's length nor a matching prefix leaks. The header value is compared exactly as received:
 * unlike the signature presets, it is never trimmed, because trimming would loosen a secret comparison.
 *
 * @public
 */
export class SharedSecret {
	private constructor() {}

	/**
	 * Verify a delivery.
	 *
	 * @remarks
	 * `missing_signature` without the header or with an empty value; `bad_signature` when the raw value is not the
	 * secret, surrounding whitespace included. Needs nothing in `R`; a WebCrypto failure is a defect, as in the HMAC
	 * presets.
	 *
	 * Truly asynchronous: the comparison runs on WebCrypto, so a test that forks this and then adjusts `TestClock` can
	 * race or hang. Await it, or gate the clock on a latch.
	 *
	 * @public
	 */
	static readonly verify: (
		request: WebhookRequest,
		options: SharedSecretOptions,
	) => Effect.Effect<void, WebhookVerificationError> = verify;
}
