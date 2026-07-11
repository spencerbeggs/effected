/**
 * The upstream release feeds, and how raw records become domain releases.
 *
 * v3 had four fetcher services with four `*Live` layers; the shapes differ only
 * in the URL and how a tag name is stripped, so they collapse into functions.
 *
 * @internal
 */

import type { InvalidVersionError } from "@effected/semver";
import { SemVer } from "@effected/semver";
import type { DateTime } from "effect";
import { Effect, Option, Schema } from "effect";
import type { HttpClient } from "effect/unstable/http";
import type { GitHubClient, GitHubError } from "../GitHub.js";
import { mapHttpFailure } from "../GitHub.js";
import { NodeRelease } from "../NodeRelease.js";
import type { NodeScheduleData } from "../NodeSchedule.js";
import { getJson } from "./http.js";
import type { RawNodeRelease, RawRelease } from "./types.js";

const NODE_DIST_URL = "https://nodejs.org/dist/index.json";
const NODE_SCHEDULE_URL = "https://raw.githubusercontent.com/nodejs/Release/refs/heads/main/schedule.json";

/** The subset of nodejs.org's dist index this package reads. */
const NodeDistIndex = Schema.Array(
	Schema.Struct({
		version: Schema.String,
		date: Schema.String,
		// Pre-0.6.3 entries carry `npm: false`. The npm version is informational
		// and never compared, so a sentinel is better than dropping the release.
		npm: Schema.optionalKey(Schema.Union([Schema.String, Schema.Boolean])),
	}),
);

const NodeScheduleFeed = Schema.Record(
	Schema.String,
	Schema.Struct({
		start: Schema.String,
		lts: Schema.optionalKey(Schema.String),
		maintenance: Schema.optionalKey(Schema.String),
		end: Schema.String,
		codename: Schema.optionalKey(Schema.String),
	}),
);

const decodeDate = Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString);

/**
 * Parse a version string, yielding `None` rather than failing.
 *
 * The feeds carry tags this package cannot and need not understand (release
 * candidates, `bun-v1.0.0-canary`, ancient `0.0.0-N` Deno tags). One of them is
 * not a reason to fail the whole load; it is a reason to skip that entry.
 */
export const tryParseSemVer = (raw: string): Effect.Effect<Option.Option<SemVer>> =>
	SemVer.parse(raw).pipe(
		Effect.map(Option.some),
		Effect.catchTag("InvalidVersionError", () => Effect.succeed(Option.none<SemVer>())),
	);

const tryParseDate = (raw: string): Effect.Effect<Option.Option<DateTime.Utc>> =>
	decodeDate(raw).pipe(
		Effect.map(Option.some),
		Effect.catch(() => Effect.succeed(Option.none<DateTime.Utc>())),
	);

/** Strip a leading `v` or `bun-v` from a tag name. */
export const stripTagPrefix = (tag: string): string => {
	const withoutBun = tag.startsWith("bun-") ? tag.slice(4) : tag;
	return withoutBun.startsWith("v") || withoutBun.startsWith("V") ? withoutBun.slice(1) : withoutBun;
};

// ── Node ─────────────────────────────────────────────────────────────────────

/** Fetch nodejs.org's dist index. Unauthenticated — this is not a GitHub API. */
export const fetchNodeReleases = (): Effect.Effect<ReadonlyArray<RawNodeRelease>, GitHubError, HttpClient.HttpClient> =>
	getJson(NODE_DIST_URL, NodeDistIndex).pipe(
		Effect.mapError(mapHttpFailure),
		Effect.map((entries) =>
			entries.map(
				(entry): RawNodeRelease => ({
					version: entry.version.replace(/^v/, ""),
					npm: typeof entry.npm === "string" ? entry.npm : "0.0.0",
					date: entry.date,
				}),
			),
		),
	);

/** Fetch the `nodejs/Release` schedule. Also unauthenticated: raw.githubusercontent.com. */
export const fetchNodeSchedule = (): Effect.Effect<NodeScheduleData, GitHubError, HttpClient.HttpClient> =>
	getJson(NODE_SCHEDULE_URL, NodeScheduleFeed).pipe(Effect.mapError(mapHttpFailure));

/** Build Node releases, skipping entries this package cannot parse. */
export const buildNodeReleases = (
	raw: ReadonlyArray<RawNodeRelease>,
): Effect.Effect<ReadonlyArray<NodeRelease>, InvalidVersionError> =>
	Effect.forEach(raw, (entry) =>
		Effect.gen(function* () {
			const version = yield* tryParseSemVer(entry.version);
			const npm = yield* tryParseSemVer(entry.npm);
			const date = yield* tryParseDate(entry.date);
			if (Option.isNone(version) || Option.isNone(npm) || Option.isNone(date)) return Option.none<NodeRelease>();
			return Option.some(NodeRelease.make({ version: version.value, npm: npm.value, date: date.value }));
		}),
	).pipe(Effect.map((results) => results.flatMap(Option.toArray)));

// ── GitHub-hosted runtimes (Bun, Deno) ───────────────────────────────────────

/**
 * Fetch a runtime's releases from GitHub, dropping drafts and prereleases.
 *
 * Bun and Deno differ by a repository name and a tag prefix. v3 had two fetcher
 * services, two service files and two `*Live` layers for that difference.
 */
export const fetchGitHubReleases = (
	client: GitHubClient["Service"],
	owner: string,
	repo: string,
): Effect.Effect<ReadonlyArray<RawRelease>, GitHubError> =>
	client.listReleases(owner, repo).pipe(
		Effect.map((releases) =>
			releases
				.filter((release) => !release.draft && !release.prerelease)
				.flatMap((release): ReadonlyArray<RawRelease> => {
					const date = release.published_at;
					// A release with no publication date carries no orderable time; skip it
					// rather than inventing `new Date()` the way v3 did, which made every
					// undated historical release look like it shipped today.
					if (date === null) return [];
					return [{ version: stripTagPrefix(release.tag_name), date }];
				}),
		),
	);

/** Build a release list of `{ version, date }` records, skipping unparseable entries. */
export const buildReleases = <R>(
	raw: ReadonlyArray<RawRelease>,
	make: (fields: { readonly version: SemVer; readonly date: DateTime.Utc }) => R,
): Effect.Effect<ReadonlyArray<R>> =>
	Effect.forEach(raw, (entry) =>
		Effect.gen(function* () {
			const version = yield* tryParseSemVer(entry.version);
			const date = yield* tryParseDate(entry.date);
			if (Option.isNone(version) || Option.isNone(date)) return Option.none<R>();
			return Option.some(make({ version: version.value, date: date.value }));
		}),
	).pipe(Effect.map((results) => results.flatMap(Option.toArray)));
