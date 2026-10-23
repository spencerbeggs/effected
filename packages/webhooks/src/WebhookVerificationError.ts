import { Schema } from "effect";

/**
 * Why a webhook delivery failed verification.
 *
 * @remarks
 * Route on this value, never on `message`. The set is closed:
 *
 * - `missing_signature` — the signature header is absent or empty.
 * - `malformed` — a header the scheme requires besides the signature is absent, or not the shape the scheme defines.
 * - `bad_signature` — the signature header does not parse, or no signature in it matches.
 * - `stale_timestamp` — the signature matches but its timestamp sits outside the tolerance of the receive time.
 *
 * A typical HTTP mapping is 401 for `missing_signature` and `bad_signature`, 400 for the other two.
 *
 * @public
 */
export const WebhookVerificationReason = Schema.Literals([
	"missing_signature",
	"malformed",
	"bad_signature",
	"stale_timestamp",
]);

/**
 * The reason union carried by {@link WebhookVerificationError}.
 *
 * @public
 */
export type WebhookVerificationReason = typeof WebhookVerificationReason.Type;

/**
 * The preset that produced a {@link WebhookVerificationError}.
 *
 * @public
 */
export const WebhookPreset = Schema.Literals([
	"StandardWebhooks",
	"GitHub",
	"Stripe",
	"Sanity",
	"HmacHeader",
	"SharedSecret",
]);

/**
 * The preset union carried by {@link WebhookVerificationError}.
 *
 * @public
 */
export type WebhookPreset = typeof WebhookPreset.Type;

/**
 * The one error a webhook verifier fails with.
 *
 * @remarks
 * `reason` is the routing key and `preset` names the scheme. `detail` is human-readable and may change between
 * releases; it never carries the secret, a signature or the body.
 *
 * @public
 */
export class WebhookVerificationError extends Schema.TaggedError<WebhookVerificationError>()(
	"WebhookVerificationError",
	{
		/** Why verification failed; the routing key. */
		reason: WebhookVerificationReason,
		/** The scheme that was being verified. */
		preset: WebhookPreset,
		/** Human-readable detail, when there is any. */
		detail: Schema.optionalKey(Schema.String),
	},
) {
	override get message(): string {
		return this.detail === undefined
			? `${this.preset} webhook ${this.reason}`
			: `${this.preset} webhook ${this.reason} (${this.detail})`;
	}

	/** @internal */
	static of(preset: WebhookPreset, reason: WebhookVerificationReason, detail?: string): WebhookVerificationError {
		return new WebhookVerificationError({ reason, preset, ...(detail !== undefined ? { detail } : {}) });
	}
}
