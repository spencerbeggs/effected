import { assert, describe, it } from "@effect/vitest";
import { Duration } from "effect";
import { Fmt } from "../src/index.js";

describe("Fmt.durationWords", () => {
	it("writes the ticket's examples", () => {
		assert.strictEqual(Fmt.durationWords(Duration.minutes(5)), "5 minutes");
		assert.strictEqual(Fmt.durationWords(Duration.minutes(1)), "1 minute");
		assert.strictEqual(Fmt.durationWords(Duration.minutes(150)), "2 hours 30 minutes");
	});

	it("uses the singular for exactly one of every unit", () => {
		assert.strictEqual(Fmt.durationWords(Duration.days(1)), "1 day");
		assert.strictEqual(Fmt.durationWords(Duration.hours(1)), "1 hour");
		assert.strictEqual(Fmt.durationWords(Duration.seconds(1)), "1 second");
		assert.strictEqual(Fmt.durationWords(Duration.millis(1)), "1 millisecond");
		assert.strictEqual(Fmt.durationWords(Duration.millis(2)), "2 milliseconds");
	});

	it("balances into days and never writes weeks", () => {
		assert.strictEqual(Fmt.durationWords(Duration.hours(28)), "1 day 4 hours");
		assert.strictEqual(Fmt.durationWords(Duration.days(14)), "14 days");
	});

	it("writes two parts by default, skipping zero units", () => {
		const d = Duration.sum(Duration.days(1), Duration.sum(Duration.minutes(5), Duration.seconds(30)));
		assert.strictEqual(Fmt.durationWords(d), "1 day 5 minutes");
	});

	it("writes as many parts as asked, and every one with Infinity", () => {
		const d = Duration.sum(
			Duration.sum(Duration.days(1), Duration.hours(2)),
			Duration.sum(Duration.sum(Duration.minutes(3), Duration.seconds(4)), Duration.millis(5)),
		);
		assert.strictEqual(Fmt.durationWords(d, { parts: 1 }), "1 day");
		assert.strictEqual(Fmt.durationWords(d, { parts: 3 }), "1 day 2 hours 3 minutes");
		assert.strictEqual(
			Fmt.durationWords(d, { parts: Number.POSITIVE_INFINITY }),
			"1 day 2 hours 3 minutes 4 seconds 5 milliseconds",
		);
	});

	it("drops the remainder below the last unit written, never rounding up", () => {
		const d = Duration.sum(Duration.hours(2), Duration.sum(Duration.minutes(59), Duration.seconds(59)));
		assert.strictEqual(Fmt.durationWords(d), "2 hours 59 minutes");
		assert.strictEqual(Fmt.durationWords(Duration.millis(59_999), { parts: 1 }), "59 seconds");
	});

	it("drops whatever is below the smallest unit", () => {
		assert.strictEqual(Fmt.durationWords(Duration.millis(90_500), { smallest: "seconds" }), "1 minute 30 seconds");
		assert.strictEqual(Fmt.durationWords(Duration.millis(1500), { smallest: "seconds" }), "1 second");
		assert.strictEqual(Fmt.durationWords(Duration.seconds(59), { smallest: "minutes" }), "0 minutes");
		assert.strictEqual(Fmt.durationWords(Duration.hours(26), { smallest: "days" }), "1 day");
	});

	it("drops anything below a millisecond", () => {
		assert.strictEqual(Fmt.durationWords(Duration.nanos(1_500_000n)), "1 millisecond");
		assert.strictEqual(Fmt.durationWords(Duration.nanos(999n)), "0 milliseconds");
	});

	it("writes zero as 0 of the smallest unit's plural", () => {
		assert.strictEqual(Fmt.durationWords(Duration.zero), "0 milliseconds");
		assert.strictEqual(Fmt.durationWords(0, { smallest: "seconds" }), "0 seconds");
	});

	it("writes an infinite duration as infinity", () => {
		assert.strictEqual(Fmt.durationWords(Duration.infinity), "infinity");
		assert.strictEqual(Fmt.durationWords(Number.POSITIVE_INFINITY), "infinity");
	});

	it("treats a negative, negative-infinite or unreadable input as zero", () => {
		assert.strictEqual(Fmt.durationWords(Duration.minutes(-5)), "0 milliseconds");
		assert.strictEqual(Fmt.durationWords(-1n), "0 milliseconds");
		assert.strictEqual(Fmt.durationWords(Number.NEGATIVE_INFINITY), "0 milliseconds");
		assert.strictEqual(Fmt.durationWords(Number.NaN), "0 milliseconds");
		assert.strictEqual(Fmt.durationWords("soon" as Duration.Input, { smallest: "seconds" }), "0 seconds");
	});

	it("reads every Duration.Input: a number as milliseconds, a string, a bigint as nanoseconds", () => {
		assert.strictEqual(Fmt.durationWords(90_000), "1 minute 30 seconds");
		assert.strictEqual(Fmt.durationWords("90 seconds", { parts: 1 }), "1 minute");
		assert.strictEqual(Fmt.durationWords(2_000_000_000n), "2 seconds");
	});

	it("throws a RangeError for a parts count that is not a positive integer or Infinity", () => {
		for (const parts of [0, -1, 1.5, Number.NaN, Number.NEGATIVE_INFINITY]) {
			assert.throws(() => Fmt.durationWords(Duration.minutes(5), { parts }), RangeError);
		}
	});

	it("throws a RangeError for an unknown smallest unit", () => {
		assert.throws(
			() => Fmt.durationWords(Duration.minutes(5), { smallest: "weeks" as "days" }),
			/smallest must be a duration unit/,
		);
	});
});
