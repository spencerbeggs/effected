/**
 * A published Node.js release.
 *
 * @packageDocumentation
 */

import { SemVer } from "@effected/semver";
import type { DateTime } from "effect";
import { Option, Schema } from "effect";
import type { NodePhase, NodeSchedule } from "./NodeSchedule.js";
import { isLtsPhase } from "./NodeSchedule.js";

/**
 * One Node.js release.
 *
 * Unlike its v3 ancestor this is an ordinary immutable value. v3's `NodeRelease`
 * carried a `Ref<NodeSchedule>` so that `release.phase()` could reach the
 * schedule, which meant every release held shared mutable state and could not be
 * a data class at all. Phase is now a question you ask *with* a schedule rather
 * than a property the release drags around.
 *
 * @example
 * ```ts
 * import { NodeRelease, NodeSchedule } from "@effected/runtime-resolver";
 * import { DateTime, Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const schedule = yield* NodeSchedule.fromData({
 *     v20: { start: "2023-04-18", lts: "2023-10-24", end: "2026-04-30" },
 *   });
 *   const release = NodeRelease.make({
 *     version: yield* SemVer.parse("20.11.0"),
 *     npm: yield* SemVer.parse("10.2.4"),
 *     date: DateTime.makeUnsafe("2024-01-09"),
 *   });
 *   return release.isLts(schedule, DateTime.makeUnsafe("2024-06-01")); // true
 * });
 * ```
 *
 * @public
 */
export class NodeRelease extends Schema.Class<NodeRelease>("NodeRelease")({
	/** The released version. */
	version: SemVer,
	/** The npm version bundled with it. */
	npm: SemVer,
	/** When it was published. */
	date: Schema.DateTimeUtc,
}) {
	/**
	 * This release's lifecycle phase at a point in time.
	 *
	 * `Option.none()` when the schedule does not cover this major, or when `now`
	 * predates the line's release.
	 */
	phase(schedule: NodeSchedule, now: DateTime.Utc): Option.Option<NodePhase> {
		return schedule.phaseFor(this.version.major, now);
	}

	/**
	 * Whether this release is in Long-Term Support at a point in time.
	 */
	isLts(schedule: NodeSchedule, now: DateTime.Utc): boolean {
		return Option.match(this.phase(schedule, now), { onNone: () => false, onSome: isLtsPhase });
	}
}
