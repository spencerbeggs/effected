import { Effect } from "effect";
import type { Mac } from "effect/crypto";
import { annotateOutcome, matchesAny, readHeader, reject } from "./internal/verify.js";
import type { WebhookRequest } from "./WebhookRequest.js";
import type { WebhookVerificationError } from "./WebhookVerificationError.js";

const PRESET = "GitHub";
const SIGNATURE = /^sha256=([0-9a-f]{64})$/;

const verify = Effect.fn("GitHub.verify")(function* (request: WebhookRequest) {
	// The legacy SHA-1 x-hub-signature is never read.
	const header = readHeader(request, "x-hub-signature-256");
	if (header === undefined) return yield* reject(PRESET, "missing_signature");
	const received = SIGNATURE.exec(header)?.[1];
	if (received === undefined) return yield* reject(PRESET, "bad_signature", "not sha256=<hex>");
	if (!(yield* matchesAny(request.secret, request.body, "hex", [received]))) {
		return yield* reject(PRESET, "bad_signature");
	}
}, annotateOutcome(PRESET));

/**
 * GitHub's `x-hub-signature-256` scheme.
 *
 * @remarks
 * The header is `sha256=` and the lower-case hex HMAC-SHA256 of the body under the secret's UTF-8 bytes. The SHA-1
 * `x-hub-signature` is ignored. GitHub signs no timestamp, so a replay and a redelivery are indistinguishable here;
 * deduplicate on `x-github-delivery`.
 *
 * @public
 */
export class GitHub {
	private constructor() {}

	/**
	 * Verify a delivery.
	 *
	 * @remarks
	 * `missing_signature` without the header; `bad_signature` when it is not `sha256=<64 lower-case hex>` or does
	 * not match.
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
	static readonly verify: (request: WebhookRequest) => Effect.Effect<void, WebhookVerificationError, Mac.Mac> = verify;
}
