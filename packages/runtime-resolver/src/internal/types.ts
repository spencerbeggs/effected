/**
 * Raw record shapes shared by the engine.
 *
 * These are the *unparsed* shapes of the bundled snapshots and the network
 * feeds — plain strings, no `SemVer`, no `DateTime`, no public classes. The
 * engine speaks these; the public modules materialize them into domain
 * classes. Keeping the leaf free of facade imports is what lets
 * `internal/http.ts` stay importable from every direction without a cycle.
 *
 * @internal
 */

/** Where a loaded release set came from. Mirrors the public `Source` literal. */
export type RawSource = "api" | "cache";

/** A Bun or Deno release before parsing: a version string and a date string. */
export interface RawRelease {
	readonly version: string;
	readonly date: string;
}

/** A Node release before parsing. Carries the bundled npm version too. */
export interface RawNodeRelease {
	readonly version: string;
	readonly npm: string;
	readonly date: string;
}

/** One major line of the Node release schedule, dates unparsed. */
export interface RawScheduleEntry {
	readonly start: string;
	readonly lts?: string;
	readonly maintenance?: string;
	readonly end: string;
	readonly codename?: string;
}

/** The Node release schedule keyed by `"vNN"`, as `nodejs/Release` publishes it. */
export type RawSchedule = Readonly<Record<string, RawScheduleEntry>>;
