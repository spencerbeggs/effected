import { ConstantTime } from "@effected/crypto";
import type { Crypto, PlatformError } from "effect";
import { Effect } from "effect";
import { annotateOutcome, readHeader, reject } from "./internal/verify.js";
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
	const received = readHeader(request, options.header);
	if (received === undefined) return yield* reject(PRESET, "missing_signature");
	if (!(yield* ConstantTime.secretsEqual(request.secret, received))) return yield* reject(PRESET, "bad_signature");
}, annotateOutcome(PRESET));

/**
 * A shared secret sent verbatim in a caller-named header, such as Cloudflare's `cf-webhook-auth`.
 *
 * @remarks
 * Compared with `ConstantTime.secretsEqual`, which hashes both sides first, so neither the secret's length nor a
 * matching prefix leaks. That hash is core `Crypto.digest`, so `Crypto` is in `R`.
 *
 * @public
 */
export class SharedSecret {
	private constructor() {}

	/**
	 * Verify a delivery.
	 *
	 * @remarks
	 * `missing_signature` without the header; `bad_signature` when it is not the secret. Fails with
	 * `PlatformError` only if the platform digest does.
	 *
	 * @public
	 */
	static readonly verify: (
		request: WebhookRequest,
		options: SharedSecretOptions,
	) => Effect.Effect<void, WebhookVerificationError | PlatformError.PlatformError, Crypto.Crypto> = verify;
}
