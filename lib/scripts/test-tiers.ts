/**
 * The vitest tiers, derived from test file names (#1415).
 *
 * @remarks
 * `EFFECTED_TEST_TIER` selects a run and `EFFECTED_TEST_DEPTH` selects how much input a depth-aware test reads.
 * `vitest.config.ts` wires these functions to project discovery; the rules live here so they can be tested.
 *
 * - No tier (a local run): every file but the hostile ones, which need the runner to themselves.
 * - `fast` (`ci:test`, coverage on): the same, minus the slow files. Files leave by `exclude`, never by a tag
 *   filter, so the run stays a full run and keeps its coverage thresholds.
 * - `slow`: only the slow files.
 * - `hostile`: only the hostile files, which the config runs one file at a time.
 * - `full`: only the depth-aware files, at full depth.
 */
export const TIERS = ["fast", "slow", "hostile", "full"] as const;

/** A run `EFFECTED_TEST_TIER` selects. */
export type Tier = (typeof TIERS)[number];

/** The suffix of a hostile test file: adversarial inputs and growth checks. */
export const HOSTILE_SUFFIX = ".hostile.test.ts";

/** The suffixes of a depth-aware test file: one whose sample and full runs differ. */
export const DEPTH_SUFFIXES = [".parity.test.ts", ".corpus.test.ts", ".property.test.ts"] as const;

/** The glob that takes hostile files out of a run. */
export const HOSTILE_GLOB = "**/*.hostile.test.{ts,tsx}";

/** Whether `file` ends in `suffix`, or in its `.tsx` form. */
const hasSuffix = (file: string, suffix: string): boolean => file.endsWith(suffix) || file.endsWith(`${suffix}x`);

/** Whether `file` is a hostile test file. */
export const isHostile = (file: string): boolean => hasSuffix(file, HOSTILE_SUFFIX);

/** Whether `file` is a depth-aware test file. */
export const isDepthAware = (file: string): boolean => DEPTH_SUFFIXES.some((suffix) => hasSuffix(file, suffix));

/** The tier in `raw`: none when unset or empty, and anything unknown throws. */
export const parseTier = (raw: string | undefined): Tier | undefined => {
	if (raw === undefined || raw === "") return undefined;
	if ((TIERS as ReadonlyArray<string>).includes(raw)) return raw as Tier;
	throw new Error(`EFFECTED_TEST_TIER must be one of ${TIERS.join(", ")} or unset, got ${JSON.stringify(raw)}`);
};

/** The depth in `raw`: `sample` when unset, and anything but `sample` or `full` throws, the empty string too. */
export const parseDepth = (raw: string | undefined): "sample" | "full" => {
	if (raw === undefined || raw === "sample") return "sample";
	if (raw === "full") return "full";
	throw new Error(`EFFECTED_TEST_DEPTH must be "sample" or "full", or unset for "sample"; got ${JSON.stringify(raw)}`);
};

/**
 * Refuses lists that would drop a file from every tier or run it in two.
 *
 * @throws When a slow path does not exist, a slow path is a hostile file, or a legacy timing path is not a slow path.
 */
export const validateLists = (input: {
	readonly slow: ReadonlyArray<string>;
	readonly legacyTiming: ReadonlyArray<string>;
	readonly exists: (path: string) => boolean;
}): void => {
	const missing = input.slow.filter((file) => !input.exists(file));
	if (missing.length > 0) {
		throw new Error(`vitest.config.ts SLOW_TESTS names files that do not exist:\n  ${missing.join("\n  ")}`);
	}
	const hostile = input.slow.filter(isHostile);
	if (hostile.length > 0) {
		throw new Error(
			`vitest.config.ts SLOW_TESTS names hostile files, which their suffix already places:\n  ${hostile.join("\n  ")}`,
		);
	}
	const strays = input.legacyTiming.filter((file) => !input.slow.includes(file));
	if (strays.length > 0) {
		throw new Error(`vitest.config.ts TIMING_TESTS names files missing from SLOW_TESTS:\n  ${strays.join("\n  ")}`);
	}
};

/** What one project runs under a tier. */
export interface ProjectSelection {
	readonly include?: ReadonlyArray<string>;
	readonly exclude?: ReadonlyArray<string>;
	readonly env?: Readonly<Record<string, string>>;
}

/**
 * What one project runs under `tier`, or `null` to drop the project from the run.
 *
 * @param input - `slow` is the project's `SLOW_TESTS` files with the legacy timing files removed, `legacyTiming`
 *   its `TIMING_TESTS` files, and `files` every test file it has; all absolute paths.
 */
export const projectSelection = (input: {
	readonly tier: Tier | undefined;
	readonly slow: ReadonlyArray<string>;
	readonly legacyTiming: ReadonlyArray<string>;
	readonly files: ReadonlyArray<string>;
}): ProjectSelection | null => {
	const alone = [HOSTILE_GLOB, ...input.legacyTiming];
	switch (input.tier) {
		case undefined:
			return { exclude: alone };
		case "fast":
			return { exclude: [...alone, ...input.slow] };
		case "slow":
			return input.slow.length === 0 ? null : { include: [...input.slow] };
		case "hostile": {
			const include = [...input.files.filter(isHostile), ...input.legacyTiming];
			return include.length === 0 ? null : { include };
		}
		case "full": {
			const include = input.files.filter(isDepthAware);
			return include.length === 0 ? null : { include, env: { EFFECTED_TEST_DEPTH: "full" } };
		}
	}
};
