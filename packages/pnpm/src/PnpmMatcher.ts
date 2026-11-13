// pnpm's package-name pattern lists, as `@pnpm/matcher`'s `createMatcher`
// composes them. The engine lives in `internal/peerPatterns.ts`.

import { peerNameMatcher } from "./internal/peerPatterns.js";

/**
 * pnpm's package-name pattern lists, compiled to predicates.
 *
 * @remarks
 * pnpm reads `peerDependencyRules.ignoreMissing` and
 * `peerDependencyRules.allowAny` through `@pnpm/matcher`, and
 * {@link PnpmMatcher.compile} restates its rules:
 *
 * - a lone `*` matches every name; any other `*` is a wildcard over any run of
 *   characters, `/` included; a pattern without `*` is plain equality;
 * - a leading `!` negates the pattern after it;
 * - a list of includes matches when any include matches; a list of negations
 *   matches unless a negation matches; a mixed list is walked in order, and a
 *   later matching negation resets an earlier include, so `["*", "!redux"]`
 *   excludes `redux` and `["!redux", "*"]` does not;
 * - an empty list matches nothing.
 *
 * A pattern names the package only. The peer lists read no parent, so
 * `react-dom>react` is a literal name that matches nothing; the
 * `allowedVersions` key grammar does not apply here. Matching is a linear
 * scan, never a `RegExp` built from the configured pattern.
 *
 * @example
 * ```ts
 * import { PnpmMatcher } from "@effected/pnpm";
 *
 * const ignored = PnpmMatcher.compile(["@types/*", "!@types/node"]);
 * console.log(ignored("@types/react"), ignored("@types/node"));
 * // => true false
 * ```
 *
 * @public
 */
export class PnpmMatcher {
	private constructor() {}

	/**
	 * Compile one pattern list into a predicate over package names.
	 *
	 * @param patterns - The list as configured, negations included.
	 * @returns A predicate that is `true` for a name the list matches.
	 */
	static compile(patterns: ReadonlyArray<string>): (name: string) => boolean {
		return peerNameMatcher(patterns);
	}
}
