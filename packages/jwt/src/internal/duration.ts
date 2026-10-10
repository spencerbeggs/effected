// Option durations arrive as `Duration.Input`. Core's `Duration.fromInput(NaN)`
// is zero, not `None`, so a raw non-finite number is refused before the
// conversion; an infinite `Duration` is refused after it.

import { Duration, Option } from "effect";

/**
 * The milliseconds `input` names, or `undefined` when it is unparseable or
 * not finite. The sign is the caller's to check.
 *
 * @internal
 */
export const finiteMillis = (input: Duration.Input): number | undefined => {
	if (typeof input === "number" && !Number.isFinite(input)) return undefined;
	const duration = Option.getOrUndefined(Duration.fromInput(input));
	if (duration === undefined) return undefined;
	const millis = Duration.toMillis(duration);
	return Number.isFinite(millis) ? millis : undefined;
};
