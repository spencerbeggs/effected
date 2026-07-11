/**
 * The Node.js release schedule and the lifecycle phases derived from it.
 *
 * @packageDocumentation
 */

import { DateTime, Effect, Option, Order, Schema } from "effect";
import type { RawSchedule } from "./internal/types.js";

/**
 * Lifecycle phase of a Node.js major release line.
 *
 * - `current` — actively receiving features and bug fixes.
 * - `active-lts` — Long-Term Support: bug and security fixes only.
 * - `maintenance-lts` — critical security fixes only.
 * - `end-of-life` — no longer maintained.
 *
 * @public
 */
export const NodePhase = Schema.Literals(["current", "active-lts", "maintenance-lts", "end-of-life"]);

/**
 * Lifecycle phase of a Node.js major release line.
 *
 * @public
 */
export type NodePhase = typeof NodePhase.Type;

/**
 * A date in the release schedule could not be understood.
 *
 * Raised when `nodejs/Release` publishes a `schedule.json` whose dates this
 * package cannot parse — an operator-facing signal that the upstream feed
 * changed shape, not something a caller can recover from.
 *
 * @public
 */
export class InvalidScheduleDateError extends Schema.TaggedErrorClass<InvalidScheduleDateError>()(
	"InvalidScheduleDateError",
	{
		/** The schedule key whose entry failed, e.g. `"v20"`. */
		key: Schema.String,
		/** The field that failed, e.g. `"start"`. */
		field: Schema.String,
		/** The value that could not be parsed. */
		value: Schema.String,
	},
) {}

/**
 * One major release line's lifecycle dates.
 *
 * @public
 */
export class NodeScheduleEntry extends Schema.Class<NodeScheduleEntry>("NodeScheduleEntry")({
	/** The Node.js major version number, e.g. `20`. */
	major: Schema.Number,
	/** When the line was first released. */
	start: Schema.DateTimeUtc,
	/** When the line entered Active LTS, absent if it never does (odd majors). */
	lts: Schema.optionalKey(Schema.DateTimeUtc),
	/** When the line entered Maintenance LTS. */
	maintenance: Schema.optionalKey(Schema.DateTimeUtc),
	/** When the line reaches end of life. */
	end: Schema.DateTimeUtc,
	/** The LTS codename, e.g. `"Iron"`. Empty for lines that never got one. */
	codename: Schema.String,
}) {}

/**
 * The raw shape of `schedule.json` as `nodejs/Release` publishes it: a map of
 * `"vNN"` to ISO date strings.
 *
 * @public
 */
export const NodeScheduleData = Schema.Record(
	Schema.String,
	Schema.Struct({
		start: Schema.String,
		lts: Schema.optionalKey(Schema.String),
		maintenance: Schema.optionalKey(Schema.String),
		end: Schema.String,
		codename: Schema.optionalKey(Schema.String),
	}),
);

/**
 * The raw shape of `schedule.json`.
 *
 * @public
 */
export type NodeScheduleData = typeof NodeScheduleData.Type;

const decodeDate = Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString);

const parseDate = (key: string, field: string, value: string): Effect.Effect<DateTime.Utc, InvalidScheduleDateError> =>
	decodeDate(value).pipe(Effect.mapError(() => new InvalidScheduleDateError({ key, field, value })));

const byMajor = Order.mapInput(Order.Number, (entry: NodeScheduleEntry) => entry.major);

/**
 * An immutable snapshot of the Node.js release schedule.
 *
 * In v3 a `Ref<NodeSchedule>` was threaded *into every `NodeRelease`* so that
 * `release.phase()` could reach the schedule — mutable service state inside an
 * immutable domain value, which is why `NodeRelease` could not be a data class.
 * Here the schedule is a value the caller passes in: phase is a function of
 * `(release, schedule, now)`, and nothing in the model is mutable.
 *
 * @example
 * ```ts
 * import { NodeSchedule } from "@effected/runtime-resolver";
 * import { DateTime, Effect, Option } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const schedule = yield* NodeSchedule.fromData({
 *     v20: { start: "2023-04-18", lts: "2023-10-24", end: "2026-04-30" },
 *   });
 *   const phase = schedule.phaseFor(20, DateTime.makeUnsafe("2024-01-01"));
 *   return Option.getOrNull(phase); // "active-lts"
 * });
 * ```
 *
 * @public
 */
export class NodeSchedule extends Schema.Class<NodeSchedule>("NodeSchedule")({
	/** The known release lines, ascending by major. */
	entries: Schema.Array(NodeScheduleEntry),
}) {
	/**
	 * A schedule that knows nothing.
	 *
	 * `phaseFor` returns `Option.none()` for every major, which is the correct
	 * answer before a schedule has been loaded.
	 */
	static readonly empty: NodeSchedule = NodeSchedule.make({ entries: [] });

	/**
	 * Parse the raw `schedule.json` shape into a schedule.
	 *
	 * Keys that are not of the form `"vNN"` are skipped — the upstream file has
	 * historically carried non-version keys, and one of them is not a reason to
	 * fail the whole schedule. A key that *is* a version but whose dates do not
	 * parse fails with {@link InvalidScheduleDateError}.
	 */
	static readonly fromData = Effect.fn("NodeSchedule.fromData")(function* (data: NodeScheduleData | RawSchedule) {
		const entries: NodeScheduleEntry[] = [];

		for (const [key, value] of Object.entries(data)) {
			const major = Number.parseInt(key.replace(/^v/, ""), 10);
			if (!Number.isInteger(major)) continue;

			const start = yield* parseDate(key, "start", value.start);
			const end = yield* parseDate(key, "end", value.end);
			const lts = value.lts === undefined ? undefined : yield* parseDate(key, "lts", value.lts);
			const maintenance =
				value.maintenance === undefined ? undefined : yield* parseDate(key, "maintenance", value.maintenance);

			entries.push(
				NodeScheduleEntry.make({
					major,
					start,
					end,
					codename: value.codename ?? "",
					...(lts !== undefined ? { lts } : {}),
					...(maintenance !== undefined ? { maintenance } : {}),
				}),
			);
		}

		return NodeSchedule.make({ entries: entries.sort(byMajor) });
	});

	/**
	 * The schedule entry for a major version, if the schedule knows it.
	 */
	entryFor(major: number): Option.Option<NodeScheduleEntry> {
		return Option.fromUndefinedOr(this.entries.find((entry) => entry.major === major));
	}

	/**
	 * The lifecycle phase of a major version at a point in time.
	 *
	 * `now` is an explicit parameter rather than a read of the wall clock, which
	 * is what makes every phase transition testable without mocking time.
	 *
	 * Returns `Option.none()` when the schedule does not know the major, or when
	 * `now` is before the line was released — an unreleased line has no phase.
	 */
	phaseFor(major: number, now: DateTime.Utc): Option.Option<NodePhase> {
		return this.entryFor(major).pipe(
			Option.flatMap((entry) => {
				if (DateTime.isLessThan(now, entry.start)) return Option.none();
				if (DateTime.isGreaterThanOrEqualTo(now, entry.end)) return Option.some("end-of-life" as const);
				if (entry.maintenance !== undefined && DateTime.isGreaterThanOrEqualTo(now, entry.maintenance)) {
					return Option.some("maintenance-lts" as const);
				}
				if (entry.lts !== undefined && DateTime.isGreaterThanOrEqualTo(now, entry.lts)) {
					return Option.some("active-lts" as const);
				}
				return Option.some("current" as const);
			}),
		);
	}
}

/**
 * Whether a phase counts as Long-Term Support.
 *
 * @public
 */
export const isLtsPhase = (phase: NodePhase): boolean => phase === "active-lts" || phase === "maintenance-lts";
