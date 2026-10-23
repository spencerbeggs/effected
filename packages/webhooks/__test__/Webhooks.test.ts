import { assert, describe, it } from "@effect/vitest";
import { DateTime, Duration, Effect } from "effect";
import { Webhooks } from "../src/Webhooks.js";

const NOON = DateTime.makeUnsafe("2026-10-19T12:00:00Z");
const at = (offsetMillis: number) => DateTime.makeUnsafe(DateTime.toEpochMillis(NOON) + offsetMillis);

describe("Webhooks.checkFreshness", () => {
	it.effect("passes within the tolerance either way, including the boundary", () =>
		Effect.gen(function* () {
			for (const offset of [0, 299_999, -299_999, 300_000, -300_000]) {
				yield* Webhooks.checkFreshness(at(offset), NOON, Webhooks.DEFAULT_TOLERANCE);
			}
		}),
	);

	it.effect("fails stale_timestamp beyond it, naming HmacHeader unless told otherwise", () =>
		Effect.gen(function* () {
			for (const offset of [300_001, -300_001]) {
				const error = yield* Effect.flip(Webhooks.checkFreshness(at(offset), NOON, "5 minutes"));
				assert.strictEqual(error.reason, "stale_timestamp");
				assert.strictEqual(error.preset, "HmacHeader");
			}
			const named = yield* Effect.flip(Webhooks.checkFreshness(at(-61_000), NOON, Duration.minutes(1), "Stripe"));
			assert.strictEqual(named.preset, "Stripe");
		}),
	);

	it("defaults to five minutes", () => {
		assert.strictEqual(Duration.toMillis(Webhooks.DEFAULT_TOLERANCE), 300_000);
	});
});
