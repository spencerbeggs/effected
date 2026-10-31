import { ConstantTime } from "@effected/crypto";
import { Effect } from "effect";
import type { Mac } from "effect/crypto";
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
	// A CryptoError means the Mac layer refused its own blinding key: a broken runtime, not a bad delivery.
	const equal = yield* ConstantTime.secretsEqual(request.secret, received).pipe(Effect.orDie);
	if (!equal) return yield* reject(PRESET, "bad_signature");
}, annotateOutcome(PRESET));

/**
 * A shared secret sent verbatim in a caller-named header, such as Cloudflare's `cf-webhook-auth`.
 *
 * @remarks
 * Compared with `ConstantTime.secretsEqual`, which blinds both sides with an HMAC under a fresh `Mac` key first,
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
	 * secret, surrounding whitespace included.
	 *
	 * Requires `Mac.Mac` (`effect/crypto`) in `R`, as the HMAC presets do: `Mac.layerWebCrypto` with
	 * `SecureRandom.layerWebCrypto`, or a platform family layer such as `NodeCrypto.layerMac`. A `CryptoError` from the
	 * `Mac` layer is a defect, as is a runtime with no `crypto.subtle` on the WebCrypto layer.
	 *
	 * On `Mac.layerWebCrypto` this is truly asynchronous: a test that forks it and then adjusts `TestClock` can race or
	 * hang. Await it, or gate the clock on a latch.
	 *
	 * @public
	 */
	static readonly verify: (
		request: WebhookRequest,
		options: SharedSecretOptions,
	) => Effect.Effect<void, WebhookVerificationError, Mac.Mac> = verify;
}
