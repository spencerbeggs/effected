import type { DateTime, Duration, Option, Redacted } from "effect";

/**
 * One inbound delivery, as every preset's `verify` takes it.
 *
 * @remarks
 * Plain data, so it adapts from core `effect/http`, a Workers `Request` or a test alike.
 *
 * @public
 */
export interface WebhookRequest {
	/**
	 * Look up a header, returning the value as received. Presets call it with lower-case names. The adapter need not
	 * trim or filter: the presets guarantee that an empty value counts as absent, and the signature presets trim the
	 * value and treat a whitespace-only one as absent too. `SharedSecret` alone compares the raw value, untrimmed.
	 */
	readonly header: (name: string) => Option.Option<string>;
	/** The raw body: the exact bytes received, never a re-serialized parse. */
	readonly body: Uint8Array;
	/** When the delivery arrived. Staleness is judged against this, never the wall clock. */
	readonly receivedAt: DateTime.Utc;
	/** The endpoint's secret, in the form the vendor shows it. */
	readonly secret: Redacted.Redacted<string>;
}

/**
 * The tolerance option shared by the timestamped presets.
 *
 * @public
 */
export interface FreshnessOptions {
	/** How far the signed timestamp may sit from `receivedAt`, either way. Five minutes when omitted. */
	readonly tolerance?: Duration.Input;
}
