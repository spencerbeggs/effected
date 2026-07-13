import { assert, describe, it } from "@effect/vitest";
import { DateTime, Effect, Option } from "effect";
import { InvalidScheduleDateError, NodeSchedule, isLtsPhase, nodeReleaseLine } from "../src/index.js";

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

/**
 * The three dotted lines, with the dates `nodejs/Release` actually publishes.
 *
 * `Number.parseInt` maps every one of these keys to the major `0`, so a schedule
 * keyed by major collapses all three onto whichever entry it happened to store
 * first — and answers `0.12` with `0.8`'s dates. These fixtures exist to catch
 * exactly that; the v20–v22 lines above structurally cannot, because their majors
 * are already distinct.
 */
const DOTTED = {
	"v0.8": { start: "2012-06-25", end: "2014-07-31" },
	"v0.10": { start: "2013-03-11", end: "2016-10-31" },
	"v0.12": { start: "2015-02-06", end: "2016-12-31" },
	v4: { start: "2015-09-08", lts: "2015-10-12", maintenance: "2017-04-01", end: "2018-04-30", codename: "Argon" },
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
				const phaseAt = (iso: string) => Option.getOrNull(schedule.phaseFor({ major: 20 }, at(iso)));

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
				assert.strictEqual(Option.getOrNull(schedule.phaseFor({ major: 21 }, at("2023-12-01"))), "current");
				assert.strictEqual(Option.getOrNull(schedule.phaseFor({ major: 21 }, at("2024-02-01"))), "maintenance-lts");
			}),
		);

		it.effect("keeps a line with no maintenance date in active-lts until it dies", () =>
			Effect.gen(function* () {
				const schedule = yield* NodeSchedule.fromData(DATA);
				assert.strictEqual(Option.getOrNull(schedule.phaseFor({ major: 22 }, at("2026-01-01"))), "active-lts");
				assert.strictEqual(Option.getOrNull(schedule.phaseFor({ major: 22 }, at("2027-05-01"))), "end-of-life");
			}),
		);

		it.effect("knows nothing about a major it has never heard of", () =>
			Effect.gen(function* () {
				const schedule = yield* NodeSchedule.fromData(DATA);
				assert.isTrue(Option.isNone(schedule.phaseFor({ major: 99 }, at("2024-01-01"))));
				assert.isTrue(Option.isNone(NodeSchedule.empty.phaseFor({ major: 20 }, at("2024-01-01"))));
			}),
		);
	});

	it.effect("entryFor finds a line and its codename", () =>
		Effect.gen(function* () {
			const schedule = yield* NodeSchedule.fromData(DATA);
			const entry = schedule.entryFor({ major: 20 });
			assert.isTrue(Option.isSome(entry));
			assert.strictEqual(Option.getOrThrow(entry).codename, "Iron");
			assert.isTrue(Option.isNone(schedule.entryFor({ major: 99 })));
		}),
	);

	it("isLtsPhase covers both LTS phases and neither of the others", () => {
		assert.isTrue(isLtsPhase("active-lts"));
		assert.isTrue(isLtsPhase("maintenance-lts"));
		assert.isFalse(isLtsPhase("current"));
		assert.isFalse(isLtsPhase("end-of-life"));
	});

	describe("the dotted 0.x release lines", () => {
		it("nodeReleaseLine keys 0.x by minor and everything else by major", () => {
			assert.strictEqual(nodeReleaseLine({ major: 0, minor: 8 }), "0.8");
			assert.strictEqual(nodeReleaseLine({ major: 0, minor: 10 }), "0.10");
			assert.strictEqual(nodeReleaseLine({ major: 0, minor: 12 }), "0.12");
			assert.strictEqual(nodeReleaseLine({ major: 4, minor: 9 }), "4");
			assert.strictEqual(nodeReleaseLine({ major: 20, minor: 11 }), "20");
		});

		it.effect("keeps v0.8, v0.10 and v0.12 as three distinct entries", () =>
			Effect.gen(function* () {
				const schedule = yield* NodeSchedule.fromData(DOTTED);
				assert.deepStrictEqual(
					schedule.entries.map((entry) => entry.line),
					// Ascending by minor within major 0 — 0.8 before 0.10, which neither a
					// string sort nor a major-only sort would give.
					["0.8", "0.10", "0.12", "4"],
				);
			}),
		);

		it.effect("answers each dotted line with its OWN dates, not the first 0.x entry's", () =>
			Effect.gen(function* () {
				const schedule = yield* NodeSchedule.fromData(DOTTED);

				// 2015-06-01 is the discriminating moment, and v0.8 is the trap: it died
				// 2014-07-31, while v0.10 and v0.12 were both still live. `Object.entries`
				// yields v0.8 first, so a schedule keyed by the major `0` answers ALL THREE
				// with v0.8's entry — and reports every 0.x release end-of-life here.
				const june2015 = at("2015-06-01");
				assert.strictEqual(Option.getOrNull(schedule.phaseFor({ major: 0, minor: 8 }, june2015)), "end-of-life");
				assert.strictEqual(
					Option.getOrNull(schedule.phaseFor({ major: 0, minor: 10 }, june2015)),
					"current",
					"v0.10 outlived v0.8 by two years; keying by major alone reports it dead",
				);
				assert.strictEqual(Option.getOrNull(schedule.phaseFor({ major: 0, minor: 12 }, june2015)), "current");

				// The end dates differ again at the other edge: v0.10 died 2016-10-31,
				// v0.12 not until 12-31.
				const nov2016 = at("2016-11-15");
				assert.strictEqual(Option.getOrNull(schedule.phaseFor({ major: 0, minor: 10 }, nov2016)), "end-of-life");
				assert.strictEqual(Option.getOrNull(schedule.phaseFor({ major: 0, minor: 12 }, nov2016)), "current");
			}),
		);

		it.effect("a 0.x line that predates its own start has no phase", () =>
			Effect.gen(function* () {
				const schedule = yield* NodeSchedule.fromData(DOTTED);
				// 2014-01-01 is after v0.8 and v0.10 shipped but before v0.12 did. A
				// schedule that collapsed the three would hand v0.12 one of theirs and
				// report a phase here.
				assert.isTrue(Option.isNone(schedule.phaseFor({ major: 0, minor: 12 }, at("2014-01-01"))));
				assert.strictEqual(Option.getOrNull(schedule.phaseFor({ major: 0, minor: 10 }, at("2014-01-01"))), "current");
			}),
		);

		it.effect("entryFor reaches the right dotted entry", () =>
			Effect.gen(function* () {
				const schedule = yield* NodeSchedule.fromData(DOTTED);
				const entry = Option.getOrThrow(schedule.entryFor({ major: 0, minor: 12 }));
				assert.strictEqual(entry.line, "0.12");
				assert.strictEqual(entry.minor, 12);
				// There is no `v0.0` line, so asking by the bare major is honestly unknown
				// rather than quietly answered with some other 0.x line's dates.
				assert.isTrue(Option.isNone(schedule.entryFor({ major: 0 })));
			}),
		);
	});
});
