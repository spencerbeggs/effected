// Shared mechanics for every preset: header reads, signed-content assembly,
// freshness arithmetic and the span's outcome annotation.

import type { HmacKey, HmacMessage, HmacStringEncoding } from "@effected/crypto";
import { ConstantTime, Hmac } from "@effected/crypto";
import { DateTime, Duration, Effect, Option } from "effect";
import type { FreshnessOptions, WebhookRequest } from "../WebhookRequest.js";
import type { WebhookPreset, WebhookVerificationReason } from "../WebhookVerificationError.js";
import { WebhookVerificationError } from "../WebhookVerificationError.js";

/**
 * The default freshness tolerance: five minutes either way.
 *
 * @internal
 */
export const DEFAULT_TOLERANCE: Duration.Duration = Duration.minutes(5);

/**
 * A header's trimmed value, or `undefined` when absent, empty or whitespace.
 *
 * @internal
 */
export const readHeader = (request: WebhookRequest, name: string): string | undefined => {
	const value = Option.getOrUndefined(request.header(name))?.trim();
	return value === undefined || value === "" ? undefined : value;
};

/**
 * A header's raw value, untrimmed, or `undefined` when absent or empty. For a value compared verbatim, such as a
 * shared secret, where trimming would loosen the comparison.
 *
 * @internal
 */
export const readRawHeader = (request: WebhookRequest, name: string): string | undefined => {
	const value = Option.getOrUndefined(request.header(name));
	return value === undefined || value === "" ? undefined : value;
};

const encoder = new TextEncoder();

/**
 * A typed verification failure.
 *
 * @internal
 */
export const reject = (
	preset: WebhookPreset,
	reason: WebhookVerificationReason,
	detail?: string,
): Effect.Effect<never, WebhookVerificationError> => Effect.fail(WebhookVerificationError.of(preset, reason, detail));

/**
 * Whether the HMAC-SHA256 of `message` under `key`, encoded as `encoding`, equals any of `candidates`.
 *
 * @remarks
 * Compared as encoded strings in constant time, so a candidate in another spelling (upper-case hex, say) does not
 * match: GitHub and Stripe send lower-case hex only. A `CryptoError` is a defect here: the presets' keys are
 * well-formed by the time they reach this, so one would be a wiring mistake, not a bad delivery.
 *
 * @internal
 */
export const matchesAny = (
	key: HmacKey,
	message: HmacMessage,
	encoding: HmacStringEncoding,
	candidates: ReadonlyArray<string>,
): Effect.Effect<boolean> =>
	Hmac.sign({ algorithm: "SHA-256", key, message, encoding }).pipe(
		Effect.orDie,
		Effect.map((expected) => {
			// Encoded once, not once per candidate.
			const expectedBytes = encoder.encode(expected);
			return candidates.some((candidate) => ConstantTime.equal(expectedBytes, candidate));
		}),
	);

/**
 * The timestamp as a `DateTime`, when it sits within `tolerance` of `receivedAt` either way; the boundary is fresh.
 * `None` when it is stale, or when the sender-supplied value is one no `DateTime` can represent (out of range, or
 * not a number), which is stale rather than a defect.
 *
 * @internal
 */
const freshAt = (
	timestampMillis: number,
	receivedAt: DateTime.Utc,
	tolerance: Duration.Input,
): Option.Option<DateTime.Utc> =>
	Option.filter(DateTime.make(timestampMillis), (signedAt) =>
		Duration.isLessThanOrEqualTo(
			Duration.abs(DateTime.distance(receivedAt, signedAt)),
			Duration.fromInputUnsafe(tolerance),
		),
	);

/**
 * The freshness check: the validated timestamp, or `stale_timestamp`. Every timestamped preset runs it after the
 * signature, and `Webhooks.checkFreshness` is it under a public name.
 *
 * @internal
 */
export const checkFresh = (
	preset: WebhookPreset,
	timestampMillis: number,
	receivedAt: DateTime.Utc,
	options: FreshnessOptions | undefined,
): Effect.Effect<DateTime.Utc, WebhookVerificationError> =>
	Option.match(freshAt(timestampMillis, receivedAt, options?.tolerance ?? DEFAULT_TOLERANCE), {
		onNone: () => reject(preset, "stale_timestamp", "the timestamp is outside the tolerance"),
		onSome: Effect.succeed,
	});

/**
 * Annotate the current span with the preset and the outcome: `verified`, or the failure reason. Applied as an
 * `Effect.fn` pipeable, so it runs inside the preset's span. Never annotates the secret, a signature or the body.
 *
 * @internal
 */
export const annotateOutcome =
	(preset: WebhookPreset) =>
	<A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
		Effect.annotateCurrentSpan("webhook.preset", preset).pipe(
			Effect.andThen(self),
			Effect.tap(() => Effect.annotateCurrentSpan("webhook.outcome", "verified")),
			Effect.tapError((error) =>
				error instanceof WebhookVerificationError
					? Effect.annotateCurrentSpan("webhook.outcome", error.reason)
					: Effect.void,
			),
		);
