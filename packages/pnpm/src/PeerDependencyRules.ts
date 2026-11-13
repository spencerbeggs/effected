// pnpm's `peerDependencyRules` block. The per-pattern grammar lives in
// `internal/peerPatterns.ts`, public as `PnpmMatcher.compile`.

import { Schema } from "effect";
import { PnpmMatcher } from "./PnpmMatcher.js";

/**
 * pnpm's `peerDependencyRules` block: the suppression policy pnpm applies
 * after computing peer violations.
 *
 * @remarks
 * `ignoreMissing` and `allowAny` are lists of peer-name patterns in
 * `@pnpm/matcher`'s grammar (see {@link PnpmMatcher}), not `parent>peer` keys,
 * which match nothing on those two axes. `ignoreMissing` hides only a required
 * peer that resolved to nothing; `allowAny` hides only a peer that resolved
 * outside its wanted range; the two never cross. `allowedVersions` maps a key
 * (`peer`, `parent>peer` or `parent@version>peer`) to the version or range the
 * rule permits. pnpm splits those keys on a plain first `>` and never fails on
 * one, so they are not `OverrideKey` selectors and must not be parsed with it. Every axis is optional, and an absent
 * axis means none. Build one with `PeerDependencyRules.make`, and never pass an
 * explicit `undefined` for an axis.
 *
 * @example
 * ```ts
 * import { PeerDependencyRules } from "@effected/pnpm";
 *
 * const rules = PeerDependencyRules.make({ ignoreMissing: ["@types/*"] });
 * console.log(rules.matchesIgnoreMissing("@types/react"));
 * // => true
 * ```
 *
 * @public
 */
export class PeerDependencyRules extends Schema.Class<PeerDependencyRules>("PeerDependencyRules")({
	/** Peer-name patterns whose absence pnpm does not report. */
	ignoreMissing: Schema.optionalKey(Schema.Array(Schema.String)),
	/** Peer-name patterns for which any resolved version is accepted. */
	allowAny: Schema.optionalKey(Schema.Array(Schema.String)),
	/** A key to the peer version or range the rule permits. */
	allowedVersions: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
}) {
	/** Every axis present and empty; the instance and each axis are frozen, since it is shared. */
	static readonly empty: PeerDependencyRules = (() => {
		// `make` copies each axis, so the frozen axes are the instance's own.
		const rules = this.make({ allowedVersions: {}, ignoreMissing: [], allowAny: [] });
		Object.freeze(rules.allowedVersions);
		Object.freeze(rules.ignoreMissing);
		Object.freeze(rules.allowAny);
		return Object.freeze(rules);
	})();

	/**
	 * Whether `ignoreMissing` matches the peer name.
	 *
	 * @param name - The peer package name.
	 */
	matchesIgnoreMissing(name: string): boolean {
		return PnpmMatcher.compile(this.ignoreMissing ?? [])(name);
	}

	/**
	 * Whether `allowAny` matches the peer name.
	 *
	 * @param name - The peer package name.
	 */
	matchesAllowAny(name: string): boolean {
		return PnpmMatcher.compile(this.allowAny ?? [])(name);
	}
}
