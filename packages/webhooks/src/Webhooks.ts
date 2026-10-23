import type { Duration } from "effect";
import { DateTime, Effect } from "effect";
import { DEFAULT_TOLERANCE, checkFresh } from "./internal/verify.js";
import type { WebhookPreset, WebhookVerificationError } from "./WebhookVerificationError.js";

const checkFreshness = (
	timestamp: DateTime.DateTime | number,
	receivedAt: DateTime.Utc,
	tolerance: Duration.Input,
	preset: WebhookPreset = "HmacHeader",
): Effect.Effect<void, WebhookVerificationError> =>
	// Suspended so an unusable tolerance surfaces when the effect runs, not when it is built.
	// A number is epoch milliseconds; one no `DateTime` can represent is stale, never a throw.
	Effect.suspend(() =>
		Effect.asVoid(
			checkFresh(preset, typeof timestamp === "number" ? timestamp : DateTime.toEpochMillis(timestamp), receivedAt, {
				tolerance,
			}),
		),
	);

/**
 * Helpers shared across presets.
 *
 * @public
 */
export class Webhooks {
	private constructor() {}

	/**
	 * The tolerance the timestamped presets use when none is given: five minutes either way.
	 *
	 * @public
	 */
	static readonly DEFAULT_TOLERANCE: Duration.Duration = DEFAULT_TOLERANCE;

	/**
	 * Fail with `stale_timestamp` unless `timestamp` sits within `tolerance` of `receivedAt`, either way.
	 *
	 * @remarks
	 * For a scheme whose timestamp is not in the signed headers, such as Linear's `webhookTimestamp` inside the JSON
	 * body: verify the signature with {@link HmacHeader.verify} first, decode the body, then call this. The boundary
	 * counts as fresh. `preset` names the scheme on the error and defaults to `HmacHeader`.
	 *
	 * `timestamp` is a `DateTime` or a number of epoch milliseconds, as Linear sends it. A number no `DateTime` can
	 * represent (out of range, `NaN`, infinite) is `stale_timestamp`, never a throw, so a sender-supplied value can be
	 * passed straight in.
	 *
	 * @public
	 */
	static readonly checkFreshness: (
		timestamp: DateTime.DateTime | number,
		receivedAt: DateTime.Utc,
		tolerance: Duration.Input,
		preset?: WebhookPreset,
	) => Effect.Effect<void, WebhookVerificationError> = checkFreshness;
}
