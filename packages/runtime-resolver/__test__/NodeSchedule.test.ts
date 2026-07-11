import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { InvalidScheduleDateError, NodeSchedule, isLtsPhase } from "../src/index.js";

const at = (iso: string): DateTime.Utc => DateTime.makeUnsafe(iso);

// One line with every transition, so every branch of `phaseFor` has a witness.
const DATA = {
	v20: {
		start: "2023-04-18",
		lts: "2023-10-24",
		maintenance: "2024-10-22",
		end: "2026-04-30",
		codename: "Iron",
	},
	// An odd major never reaches LTS: it goes current -> maintenance -> EOL.
	v21: { start: "2023-10-17", maintenance: "2024-01-01", end: "2024-06-01" },
	// A line with no maintenance date at all.
	v22: { start: "2024-04-24", lts: "2024-10-29", end: "2027-04-30" },
} as const;

describe("NodeSchedule", () => {
	it.effect("parses the raw schedule and sorts entries by major", () =>
		Effect.gen(function* () {
			const schedule = yield* NodeSchedule.fromData(DATA);
			assert.deepStrictEqual(
				schedule.entries.map((entry) => entry.major),
				[20, 21, 22],
			);
		}),
	);

	it.effect("skips keys that are not version lines", () =>
		Effect.gen(function* () {
			const schedule = yield* NodeSchedule.fromData({
				...DATA,
				// The upstream file has carried non-version keys; one is not a reason
				// to fail the whole schedule.
				$schema: { start: "2023-01-01", end: "2024-01-01" },
			});
			assert.deepStrictEqual(
				schedule.entries.map((entry) => entry.major),
				[20, 21, 22],
			);
		}),
	);

	it.effect("reports an unparseable date rather than defecting", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(NodeSchedule.fromData({ v20: { start: "not-a-date", end: "2026-04-30" } }));
			assert.instanceOf(error, InvalidScheduleDateError);
			assert.strictEqual(error.key, "v20");
			assert.strictEqual(error.field, "start");
			assert.strictEqual(error.value, "not-a-date");
		}),
	);

	describe("phaseFor", () => {
		it.effect("walks a major through every phase in order", () =>
			Effect.gen(function* () {
				const schedule = yield* NodeSchedule.fromData(DATA);
				const phaseAt = (iso: string) => Option.getOrNull(schedule.phaseFor(20, at(iso)));

				// Before the line exists it has no phase at all — not "current".
				assert.isNull(phaseAt("2023-01-01"));
				assert.strictEqual(phaseAt("2023-04-18"), "current", "the start date is inclusive");
				assert.strictEqual(phaseAt("2023-06-01"), "current");
				assert.strictEqual(phaseAt("2023-10-24"), "active-lts", "the lts date is inclusive");
				assert.strictEqual(phaseAt("2024-06-01"), "active-lts");
				assert.strictEqual(phaseAt("2024-10-22"), "maintenance-lts", "the maintenance date is inclusive");
				assert.strictEqual(phaseAt("2025-06-01"), "maintenance-lts");
				assert.strictEqual(phaseAt("2026-04-30"), "end-of-life", "the end date is inclusive");
				assert.strictEqual(phaseAt("2030-01-01"), "end-of-life");
			}),
		);

		it.effect("moves a line with no lts date straight from current to maintenance", () =>
			Effect.gen(function* () {
				const schedule = yield* NodeSchedule.fromData(DATA);
				assert.strictEqual(Option.getOrNull(schedule.phaseFor(21, at("2023-12-01"))), "current");
				assert.strictEqual(Option.getOrNull(schedule.phaseFor(21, at("2024-02-01"))), "maintenance-lts");
			}),
		);

		it.effect("keeps a line with no maintenance date in active-lts until it dies", () =>
			Effect.gen(function* () {
				const schedule = yield* NodeSchedule.fromData(DATA);
				assert.strictEqual(Option.getOrNull(schedule.phaseFor(22, at("2026-01-01"))), "active-lts");
				assert.strictEqual(Option.getOrNull(schedule.phaseFor(22, at("2027-05-01"))), "end-of-life");
			}),
		);

		it.effect("knows nothing about a major it has never heard of", () =>
			Effect.gen(function* () {
				const schedule = yield* NodeSchedule.fromData(DATA);
				assert.isTrue(Option.isNone(schedule.phaseFor(99, at("2024-01-01"))));
				assert.isTrue(Option.isNone(NodeSchedule.empty.phaseFor(20, at("2024-01-01"))));
			}),
		);
	});

	it.effect("entryFor finds a line and its codename", () =>
		Effect.gen(function* () {
			const schedule = yield* NodeSchedule.fromData(DATA);
			const entry = schedule.entryFor(20);
			assert.isTrue(Option.isSome(entry));
			assert.strictEqual(Option.getOrThrow(entry).codename, "Iron");
			assert.isTrue(Option.isNone(schedule.entryFor(99)));
		}),
	);

	it("isLtsPhase covers both LTS phases and neither of the others", () => {
		assert.isTrue(isLtsPhase("active-lts"));
		assert.isTrue(isLtsPhase("maintenance-lts"));
		assert.isFalse(isLtsPhase("current"));
		assert.isFalse(isLtsPhase("end-of-life"));
	});
});
