/**
 * The Node.js release schedule and the lifecycle phases derived from it.
 *
 * @packageDocumentation
 */

import { DateTime, Effect, Option, Order, Schema } from "effect";

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
 * The parts of a version that decide which release line it belongs to.
 *
 * Structural, so a `SemVer` satisfies it without this module naming one.
 *
 * @public
 */
export interface NodeReleaseLine {
	/** The major version. */
	readonly major: number;
	/** The minor version. Only consulted for the `0.x` lines; defaults to `0`. */
	readonly minor?: number | undefined;
}

/**
 * The release-line key a version belongs to.
 *
 * Node's early history is the whole reason this exists. `nodejs/Release`
 * publishes `v0.8`, `v0.10` and `v0.12` as three *separate* release lines with
 * their own start and end dates — the major number does not identify them.
 * Everything from `v4` on is keyed by the major alone.
 *
 * @example
 * ```ts
 * import { nodeReleaseLine } from "@effected/runtimes";
 *
 * nodeReleaseLine({ major: 20, minor: 11 }); // "20"
 * nodeReleaseLine({ major: 0, minor: 12 });  // "0.12"
 * ```
 *
 * @public
 */
export const nodeReleaseLine = (version: NodeReleaseLine): string =>
	version.major === 0 ? `0.${version.minor ?? 0}` : String(version.major);

/**
 * One release line's lifecycle dates.
 *
 * @public
 */
export class NodeScheduleEntry extends Schema.Class<NodeScheduleEntry>("NodeScheduleEntry")({
	/**
	 * The release line as `nodejs/Release` keys it, without the `v`: `"20"`, or
	 * `"0.10"` for the three dotted early lines.
	 */
	line: Schema.String,
	/** The Node.js major version number, e.g. `20`. `0` for every `0.x` line. */
	major: Schema.Number,
	/** The minor, for the `0.x` lines that are each their own release line. */
	minor: Schema.optionalKey(Schema.Number),
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

/**
 * Ascending by major, then by minor within the `0.x` lines — so `v0.8` sorts
 * before `v0.10`, which a plain string or major-only comparison would not do.
 */
const byLine = Order.combine(
	Order.mapInput(Order.Number, (entry: NodeScheduleEntry) => entry.major),
	Order.mapInput(Order.Number, (entry: NodeScheduleEntry) => entry.minor ?? 0),
);

/** `"v20"` or `"v0.10"`, and nothing else — the file has carried other keys. */
const SCHEDULE_KEY = /^v?(\d+)(?:\.(\d+))?$/;

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
 * import { NodeSchedule } from "@effected/runtimes";
 * import { DateTime, Effect, Option } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const schedule = yield* NodeSchedule.fromData({
 *     v20: { start: "2023-04-18", lts: "2023-10-24", end: "2026-04-30" },
 *   });
 *   const phase = schedule.phaseFor({ major: 20 }, DateTime.makeUnsafe("2024-01-01"));
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
	static readonly fromData = Effect.fn("NodeSchedule.fromData")(function* (data: NodeScheduleData) {
		const entries: NodeScheduleEntry[] = [];

		for (const [key, value] of Object.entries(data)) {
			// `Number.parseInt("0.10")` is `0`, so parsing the key as an integer maps
			// v0.8, v0.10 and v0.12 onto one another and every 0.x release resolves
			// against whichever of them happens to be first. The dotted lines are
			// distinct release lines upstream, and they stay distinct here.
			const match = SCHEDULE_KEY.exec(key);
			if (match === null) continue;

			const major = Number(match[1]);
			const minor = match[2] === undefined ? undefined : Number(match[2]);

			const start = yield* parseDate(key, "start", value.start);
			const end = yield* parseDate(key, "end", value.end);
			const lts = value.lts === undefined ? undefined : yield* parseDate(key, "lts", value.lts);
			const maintenance =
				value.maintenance === undefined ? undefined : yield* parseDate(key, "maintenance", value.maintenance);

			entries.push(
				NodeScheduleEntry.make({
					line: nodeReleaseLine({ major, minor }),
					major,
					start,
					end,
					codename: value.codename ?? "",
					...(minor !== undefined ? { minor } : {}),
					...(lts !== undefined ? { lts } : {}),
					...(maintenance !== undefined ? { maintenance } : {}),
				}),
			);
		}

		return NodeSchedule.make({ entries: entries.sort(byLine) });
	});

	/**
	 * The schedule entry for a version's release line, if the schedule knows it.
	 */
	entryFor(version: NodeReleaseLine): Option.Option<NodeScheduleEntry> {
		const line = nodeReleaseLine(version);
		return Option.fromUndefinedOr(this.entries.find((entry) => entry.line === line));
	}

	/**
	 * The lifecycle phase of a version's release line at a point in time.
	 *
	 * `now` is an explicit parameter rather than a read of the wall clock, which
	 * is what makes every phase transition testable without mocking time.
	 *
	 * Returns `Option.none()` when the schedule does not know the line, or when
	 * `now` is before the line was released — an unreleased line has no phase.
	 */
	phaseFor(version: NodeReleaseLine, now: DateTime.Utc): Option.Option<NodePhase> {
		return this.entryFor(version).pipe(
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
