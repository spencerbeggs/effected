import { Schema } from "effect";
import { SemVer } from "./SemVer.js";

const arraysEqual = (a: ReadonlyArray<string | number>, b: ReadonlyArray<string | number>): boolean =>
	a.length === b.length && a.every((v, i) => v === b[i]);

const classifyDiff = (a: SemVer, b: SemVer): "major" | "minor" | "patch" | "prerelease" | "build" | "none" => {
	if (a.major !== b.major) return "major";
	if (a.minor !== b.minor) return "minor";
	if (a.patch !== b.patch) return "patch";
	if (!arraysEqual(a.prerelease, b.prerelease)) return "prerelease";
	if (!arraysEqual(a.build, b.build)) return "build";
	return "none";
};

/**
 * Schema-generated base class backing {@link VersionDiff}. Not meant to be
 * referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const VersionDiff_base: Schema.Class<
	VersionDiff,
	Schema.TaggedStruct<
		"VersionDiff",
		{
			readonly type: Schema.Literals<["major", "minor", "patch", "prerelease", "build", "none"]>;
			readonly from: typeof SemVer;
			readonly to: typeof SemVer;
			readonly major: typeof Schema.Number;
			readonly minor: typeof Schema.Number;
			readonly patch: typeof Schema.Number;
		}
	>,
	// biome-ignore lint/complexity/noBannedTypes: matches Schema.TaggedClass's own `Brand = {}` default
	{}
> = Schema.TaggedClass<VersionDiff>()("VersionDiff", {
	type: Schema.Literals(["major", "minor", "patch", "prerelease", "build", "none"]),
	from: SemVer,
	to: SemVer,
	major: Schema.Number,
	minor: Schema.Number,
	patch: Schema.Number,
});

/**
 * The difference between two {@link SemVer} versions: the classification of
 * the change plus signed numeric deltas. A `Schema.TaggedClass` — the one
 * concept in this package where serialized tag discrimination earns its
 * keep.
 *
 * The `type` field is the highest-precedence field that differs: `"major"`,
 * `"minor"`, `"patch"`, `"prerelease"` (only prerelease identifiers differ),
 * `"build"` (only build metadata differs) or `"none"`.
 *
 * @example
 * ```ts
 * import { SemVer, VersionDiff } from "@effected/semver";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const a = yield* SemVer.parse("1.2.3");
 *   const b = yield* SemVer.parse("2.0.0");
 *   const diff = VersionDiff.between(a, b);
 *   console.log(diff.type);  // "major"
 *   console.log(diff.major); // 1
 * });
 * ```
 *
 * @public
 */
export class VersionDiff extends VersionDiff_base {
	/** Compute the diff from `a` to `b`. */
	static between(a: SemVer, b: SemVer): VersionDiff {
		return VersionDiff.make({
			type: classifyDiff(a, b),
			from: a,
			to: b,
			major: b.major - a.major,
			minor: b.minor - a.minor,
			patch: b.patch - a.patch,
		});
	}

	/** Human-readable summary, e.g. `major (1.2.3 → 2.0.0)`. */
	override toString(): string {
		return `${this.type} (${this.from.toString()} → ${this.to.toString()})`;
	}
}
