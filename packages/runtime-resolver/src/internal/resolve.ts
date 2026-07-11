/**
 * The resolution pipeline, shared by all three runtimes.
 *
 * v3 wrote this loop three times — once per resolver — and the copies had
 * drifted: only Node grouped by minor correctly, and all three collapsed an
 * invalid range into "no versions found".
 *
 * @internal
 */

import type { InvalidRangeError } from "@effected/semver";
import { Range } from "@effected/semver";
import { Effect, Option } from "effect";
import type { NodePhase } from "../NodeSchedule.js";
import type { Increments, Runtime } from "../ResolvedVersions.js";
import { NoMatchingVersionError, ResolvedVersions, UnresolvableDefaultError } from "../ResolvedVersions.js";
import type { ReleaseIndex, Versioned } from "./releaseIndex.js";
import { groupByIncrements } from "./releaseIndex.js";

/**
 * Filter, group, rank and package a resolution.
 *
 * `refine` is where Node's phase filter plugs in; Bun and Deno pass everything
 * through. `pickLts` likewise: only Node has an LTS notion.
 */
export const resolveWith = <R extends Versioned>(args: {
	readonly index: ReleaseIndex<R>;
	readonly runtime: Runtime;
	readonly constraint: string;
	readonly increments: Increments;
	readonly defaultVersion: string | undefined;
	readonly refine: (releases: ReadonlyArray<R>) => ReadonlyArray<R>;
	readonly pickLts: (releases: ReadonlyArray<R>) => Option.Option<R>;
	/** When no explicit default was asked for, fall back to the LTS pick. Node only. */
	readonly defaultsToLts: boolean;
	/** Recorded on the error, so a caller can see what the search was restricted to. */
	readonly phases?: ReadonlyArray<NodePhase>;
}): Effect.Effect<ResolvedVersions, InvalidRangeError | NoMatchingVersionError | UnresolvableDefaultError> =>
	Effect.gen(function* () {
		const { index, runtime, constraint, increments, defaultVersion, refine, pickLts, defaultsToLts, phases } = args;

		// An unparseable range is the caller's bug and must reach them as such.
		// v3 caught this and returned an empty array, so a typo surfaced as
		// "no versions found" — the one error message guaranteed to mislead.
		const range = yield* Range.parse(constraint);

		const matching = yield* index.filter(range);
		const grouped = groupByIncrements(refine(matching), increments);

		if (grouped.length === 0) {
			return yield* new NoMatchingVersionError({
				runtime,
				constraint,
				...(phases !== undefined ? { phases } : {}),
			});
		}

		// The index is newest-first and grouping preserves that order.
		const versions = grouped.map((release) => release.version.toString());
		const lts = pickLts(grouped).pipe(Option.map((release) => release.version.toString()));

		// "No default was asked for" and "a default was asked for and does not
		// exist" are different answers, and collapsing them is how a caller who
		// names a version that is not there silently receives the LTS pick instead
		// (`defaultsToLts` is Node's). The absent case falls back; the unresolvable
		// case fails.
		const chosenDefault = yield* Option.match(Option.fromUndefinedOr(defaultVersion), {
			onNone: () => Effect.succeed(defaultsToLts ? lts : Option.none<string>()),
			onSome: (raw) =>
				Range.parse(raw).pipe(
					Effect.flatMap((defaultRange) => index.resolve(defaultRange)),
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.fail(new UnresolvableDefaultError({ runtime, defaultVersion: raw })),
							onSome: (release) => Effect.succeed(Option.some(release.version.toString())),
						}),
					),
				),
		});

		return ResolvedVersions.make({
			source: yield* index.source,
			versions,
			latest: versions[0],
			...(Option.isSome(lts) ? { lts: lts.value } : {}),
			...(Option.isSome(chosenDefault) ? { default: chosenDefault.value } : {}),
		});
	});
