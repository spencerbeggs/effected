// node-semver's view of a parsed range: the comparator sets its `Range#set`
// holds. Unlike `normalize.ts`, which sorts for the range algebra, this keeps
// the written order and applies node-semver's own set rules, so a caller that
// must reproduce node-semver (a release tool rewriting a range the way
// `@changesets/apply-release-plan` does) reads them instead of re-deriving
// them.

import { formatComparator } from "./grammar.js";
import type { ComparatorParts } from "./order.js";

/** The fields of a comparator the set rules read; both `ComparatorParts` and a `Comparator` have them. */
interface ComparatorLike {
	readonly operator: string;
	readonly version: {
		readonly major: number;
		readonly minor: number;
		readonly patch: number;
		readonly prerelease: ReadonlyArray<string | number>;
	};
}

const isZero = (c: ComparatorLike): boolean => c.version.major === 0 && c.version.minor === 0 && c.version.patch === 0;

const isPrereleaseZero = (c: ComparatorLike): boolean =>
	c.version.prerelease.length === 1 && c.version.prerelease[0] === 0;

/**
 * node-semver's `GTE0` / `GTE0PRE`: `>=0.0.0`, or `>=0.0.0-0` when
 * prereleases are included, the floor it reads as "any version".
 */
export const isAnyFloor = (c: ComparatorLike, includePrerelease: boolean): boolean =>
	c.operator === ">=" && isZero(c) && (includePrerelease ? isPrereleaseZero(c) : c.version.prerelease.length === 0);

/** node-semver's `isNullSet`: `<0.0.0-0`, which admits nothing. */
export const isNullComparator = (c: ComparatorLike): boolean => c.operator === "<" && isZero(c) && isPrereleaseZero(c);

/**
 * Whether a set places no bound under node-semver's rules: it is empty, or
 * holds nothing but the any-version floor and no null comparator.
 */
export const isAnySet = (set: ReadonlyArray<ComparatorLike>, includePrerelease: boolean): boolean =>
	set.every((c) => isAnyFloor(c, includePrerelease));

// One set as node-semver's `parseRange` leaves it: a null comparator anywhere
// makes the set just that comparator; otherwise the any-version floor is
// dropped and a duplicate keeps its first position. A set of nothing but the
// floor comes out empty, the form this package gives "any version".
const writtenSet = (
	set: ReadonlyArray<ComparatorParts>,
	includePrerelease: boolean,
): ReadonlyArray<ComparatorParts> => {
	const nullComparator = set.find(isNullComparator);
	if (nullComparator !== undefined) return [nullComparator];
	const seen = new Set<string>();
	return set.filter((c) => {
		if (isAnyFloor(c, includePrerelease)) return false;
		const key = formatComparator(c);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

/**
 * Every set as node-semver's `Range` constructor leaves them: beside another
 * set, a null set is dropped (all of them null keeps the first), and an
 * any-version set then stands for the whole range.
 */
export const writtenSets = (
	sets: ReadonlyArray<ReadonlyArray<ComparatorParts>>,
	includePrerelease: boolean,
): ReadonlyArray<ReadonlyArray<ComparatorParts>> => {
	const each = sets.map((set) => writtenSet(set, includePrerelease));
	if (each.length <= 1) return each;
	const isNullSet = (set: ReadonlyArray<ComparatorParts>): boolean =>
		set.length === 1 && isNullComparator(set[0] as ComparatorParts);
	const kept = each.filter((set) => !isNullSet(set));
	if (kept.length === 0) return [each[0] as ReadonlyArray<ComparatorParts>];
	const any = kept.find((set) => set.length === 0);
	return any !== undefined && kept.length > 1 ? [any] : kept;
};
