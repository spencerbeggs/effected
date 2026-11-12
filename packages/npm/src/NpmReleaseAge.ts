// The `NpmReleaseAge` concept: npm's own release-age window, as the pure
// analogue of pnpm's gate. npm reads `min-release-age` (a number of DAYS, off
// when unset) and `min-release-age-exclude` (package names or minimatch globs
// exempt from the window). A version is admitted when it was published at or
// before `now - days`, or when the package name is excluded.

import { GlobPattern } from "@effected/glob";
import { Option, Result, Schema } from "effect";
import type { NpmConfig } from "./NpmConfig.js";

const MS_PER_DAY = 86_400_000;

// A usable window: a finite, non-negative number. Anything else reads as off.
const parseDays = (raw: string | undefined): Option.Option<number> => {
	if (raw === undefined || raw.trim() === "") return Option.none();
	const days = Number(raw);
	return Number.isFinite(days) && days >= 0 ? Option.some(days) : Option.none();
};

/**
 * npm's release-age window: `min-release-age` (days; `None` means off) and
 * `min-release-age-exclude` (package names or minimatch globs exempt from it).
 *
 * @remarks
 * Not pnpm's `minimumReleaseAge`: npm counts days where pnpm counts minutes,
 * and npm's exclude list is matched with minimatch (`*` does not cross `/`)
 * where pnpm's `*` matches any run of characters. The clock is the caller's.
 * `fromConfig` reads the scalar `min-release-age-exclude=` line; array-form
 * settings (`min-release-age-exclude[]=`) are not surfaced by `NpmConfig`.
 *
 * @public
 */
export class NpmReleaseAge extends Schema.Class<NpmReleaseAge>("NpmReleaseAge")({
	/** Days a published version must age; `None` means the window is off. */
	days: Schema.Option(Schema.Number),
	/** Package names or minimatch globs exempt from the window. */
	exclude: Schema.Array(Schema.String),
}) {
	/**
	 * Reads the window from a resolved npm configuration. An absent,
	 * non-numeric or negative `min-release-age` is off.
	 *
	 * @param config - The resolved npm configuration.
	 */
	static fromConfig(config: NpmConfig): NpmReleaseAge {
		const exclude = Object.hasOwn(config.settings, "min-release-age-exclude")
			? [config.settings["min-release-age-exclude"] as string]
			: [];
		return NpmReleaseAge.make({
			days: parseDays(
				Object.hasOwn(config.settings, "min-release-age") ? config.settings["min-release-age"] : undefined,
			),
			exclude,
		});
	}

	/**
	 * Whether a version of `name` published at `publishedAt` passes the window
	 * at `now`: always when the window is off or the name matches an exclude
	 * pattern, otherwise when it is at least `days` old.
	 *
	 * @param name - The package name.
	 * @param publishedAt - When the version was published.
	 * @param now - The caller's clock.
	 */
	admits(name: string, publishedAt: Date, now: Date): boolean {
		if (Option.isNone(this.days)) return true;
		const excluded = this.exclude.some((source) => {
			const compiled = GlobPattern.compileResult(source);
			return Result.isSuccess(compiled) && compiled.success.matches(name);
		});
		if (excluded) return true;
		return publishedAt.getTime() <= now.getTime() - this.days.value * MS_PER_DAY;
	}
}
