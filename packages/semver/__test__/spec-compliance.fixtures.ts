/** [initial, operation, expected] */
export const incrementTests: ReadonlyArray<[string, "major" | "minor" | "patch", string]> = [
	["0.0.0", "major", "1.0.0"],
	["0.0.0", "minor", "0.1.0"],
	["0.0.0", "patch", "0.0.1"],
	["1.2.3", "major", "2.0.0"],
	["1.2.3", "minor", "1.3.0"],
	["1.2.3", "patch", "1.2.4"],
	["1.0.0-alpha", "major", "2.0.0"],
	["1.0.0-alpha", "minor", "1.1.0"],
	["1.0.0-alpha", "patch", "1.0.1"],
	["0.9.9", "major", "1.0.0"],
	["0.9.9", "minor", "0.10.0"],
	["0.9.9", "patch", "0.9.10"],
];
/** [range, version, expected_result] */
export const rangeTests: ReadonlyArray<[string, string, boolean]> = [
	// Basic ranges
	[">=1.0.0", "1.0.0", true],
	[">=1.0.0", "0.9.9", false],
	[">1.0.0", "1.0.1", true],
	[">1.0.0", "1.0.0", false],
	["<2.0.0", "1.9.9", true],
	["<2.0.0", "2.0.0", false],
	["<=2.0.0", "2.0.0", true],
	["<=2.0.0", "2.0.1", false],
	["1.0.0", "1.0.0", true],
	["1.0.0", "1.0.1", false],
	// Tilde ranges
	["~1.2.3", "1.2.3", true],
	["~1.2.3", "1.2.9", true],
	["~1.2.3", "1.3.0", false],
	["~1.2", "1.2.0", true],
	["~1.2", "1.2.999", true],
	["~1.2", "1.3.0", false],
	["~1", "1.0.0", true],
	["~1", "1.999.999", true],
	["~1", "2.0.0", false],
	// Caret ranges
	["^1.2.3", "1.2.3", true],
	["^1.2.3", "1.9.9", true],
	["^1.2.3", "2.0.0", false],
	["^0.2.3", "0.2.3", true],
	["^0.2.3", "0.2.9", true],
	["^0.2.3", "0.3.0", false],
	["^0.0.3", "0.0.3", true],
	["^0.0.3", "0.0.4", false],
	// Hyphen ranges
	["1.0.0 - 2.0.0", "1.5.0", true],
	["1.0.0 - 2.0.0", "2.0.0", true],
	["1.0.0 - 2.0.0", "2.0.1", false],
	["1.0.0 - 2.0.0", "0.9.9", false],
	// X-ranges
	["*", "1.0.0", true],
	["*", "999.999.999", true],
	["1.x", "1.0.0", true],
	["1.x", "1.999.0", true],
	["1.x", "2.0.0", false],
	["1.2.x", "1.2.0", true],
	["1.2.x", "1.2.999", true],
	["1.2.x", "1.3.0", false],
	// OR ranges
	[">=1.0.0 <2.0.0 || >=3.0.0", "1.5.0", true],
	[">=1.0.0 <2.0.0 || >=3.0.0", "2.5.0", false],
	[">=1.0.0 <2.0.0 || >=3.0.0", "3.0.0", true],
	// Prerelease
	[">=1.0.0-alpha", "1.0.0-beta", true],
	[">=1.0.0-alpha", "1.0.0", true],
	[">=1.0.0-alpha <1.0.1", "1.0.0-rc", true],
	// Prerelease tuple restriction
	[">=1.0.0 <2.0.0", "1.5.0-alpha", false],
	// Wildcard-major sugar matches every release; > and < a wildcard match nothing
	["^*", "1.0.0", true],
	["~*", "7.2.4", true],
	["^x", "1.0.0", true],
	["~x.x", "1.0.0", true],
	[">*", "1.0.0", false],
	["<*", "0.0.0", false],
	[">=*", "1.0.0", true],
	// Hyphen with a wildcard side drops that side's comparator
	["* - 0.0.0-1", "0.0.0-0", true],
	["* - 2", "2.9.9", true],
	["* - 2", "3.0.0", false],
	// Whitespace: any \s separates, and may follow an operator
	[">= 1.0.0", "1.0.0", true],
	[">= 18", "16.0.0", false],
	[">=1.0.0\t<2.0.0", "1.5.0", true],
	[">=1.0.0\n<2.0.0", "2.0.0", false],
	// Build metadata in a range is dropped
	["1.2.3+build", "1.2.3", true],
];
/**
 * [range, version, default, includePrerelease] — the answer node-semver gives
 * for `satisfies(version, range)` and for
 * `satisfies(version, range, { includePrerelease: true })`. Pinned from
 * node-semver 7.8.5 so a desugaring change that only shows up under
 * `includePrerelease` (a wildcard floor that forgot its `-0`, a full hyphen
 * floor that kept its release form) fails here, not in a consumer. Ranges
 * with a `*` alternative are left out: node-semver collapses `* || x` to `*`,
 * while this package and core keep every alternative.
 */
export const includePrereleaseTests: ReadonlyArray<[string, string, boolean, boolean]> = [
	// Wildcards include the lowest version there is
	["*", "1.2.3-foo", false, true],
	["*", "0.0.0-0", false, true],
	["", "1.0.0-0", false, true],
	// Caret: a full floor keeps its release form, a partial floor is lowered
	["^1.2.3", "1.8.9-pre", false, true],
	["^1.2.3", "2.0.0-pre", false, false],
	["^1.2.3", "1.2.3-pre", false, false],
	["^1.2.3", "1.2.4-pre", false, true],
	["^1.2", "1.2.0-alpha", false, true],
	["^1.2", "1.9.0-rc.1", false, true],
	["^1", "1.0.0-0", false, true],
	["^0.0.3", "0.0.3-alpha", false, false],
	["^0.0.3", "0.0.4-0", false, false],
	["^0.1", "0.1.0-beta", false, true],
	["^0.0", "0.0.5-rc", false, true],
	["^1.2.3-beta.1", "1.2.3-beta.2", true, true],
	["^1.2.3-beta.1", "1.3.0-rc.1", false, true],
	["^1.2.3-beta.1", "1.2.3-alpha", false, false],
	// Tilde
	["~1.2.3", "1.2.4-beta", false, true],
	["~1.2.3", "1.3.0-0", false, false],
	["~1.2.3", "1.2.3-alpha", false, false],
	["~1.2", "1.2.0-0", false, true],
	["~1", "1.0.0-0", false, true],
	// X-ranges and partials
	["1.2.x", "1.2.0-alpha", false, true],
	["1.2.x", "1.3.0-0", false, false],
	["1.x", "1.0.0-0", false, true],
	["1.2", "1.2.9-beta", false, true],
	[">1.2", "1.3.0-alpha", false, true],
	[">1.2", "1.2.9", false, false],
	[">=1.2", "1.2.0-alpha", false, true],
	// A literal full floor is not lowered: `>=1.2.0` differs from `>=1.2`
	[">=1.2.0", "1.2.0-alpha", false, false],
	[">1.2.3", "1.2.4-pre", false, true],
	[">1.2.3", "1.2.3-pre", false, false],
	["<2.0.0", "2.0.0-pre", false, true],
	["<2.0.0", "1.9.9-beta", false, true],
	["<=2.0.0", "2.0.0-rc.1", false, true],
	["<1.x", "1.0.0-0", false, false],
	["<1.x", "0.9.9-beta", false, true],
	["<=1.x", "2.0.0-0", false, false],
	// Hyphen: a full lower bound without a prerelease is lowered too
	["1.2.3 - 2", "1.2.3-0", false, true],
	["1.2.3 - 2", "3.0.0-0", false, false],
	["1.2.3 - 2.3.4", "1.2.3-alpha", false, true],
	["1.2.3 - 2.3.4", "2.3.4-rc", false, true],
	["1.2 - 2", "1.2.0-0", false, true],
	["1.2.3-beta - 2", "1.2.3-alpha", false, false],
	// Unions, exact versions and primitive sets
	["^1.0.0 || ^2.0.0", "2.5.0-beta", false, true],
	["^1.0.0 || ^2.0.0", "1.5.0-alpha.1", false, true],
	["^1.0.0 || ^2.0.0", "3.0.0-0", false, false],
	["1.0.0", "1.0.0-pre", false, false],
	["=1.0.0", "1.0.0", true, true],
	[">=1.0.0-alpha <1.1.0", "1.0.5-beta", false, true],
	[">=1.0.0 <2.0.0", "1.5.0-alpha", false, true],
	[">=1.0.0 <2.0.0", "1.5.0", true, true],
];
/**
 * [version, identifier, expected] for `bump.prerelease(identifier)`, pinned
 * from node-semver 7.8.5 `inc(version, "prerelease", identifier)`. The
 * right-most numeric identifier increments wherever it sits, and `0` is
 * appended only when there is none. Rows where node-semver resets to
 * `[identifier, 0]` because the *second* identifier is not numeric
 * (`1.0.0-1.beta` with `"1"`, `1.0.0-alpha.beta` with `"alpha"`, `1.0.0-0`
 * with `"0"`) are left out: this package follows core there and increments
 * instead.
 */
export const prereleaseBumpTests: ReadonlyArray<[string, string | undefined, string]> = [
	["1.0.0", undefined, "1.0.1-0"],
	["1.0.0", "alpha", "1.0.1-alpha.0"],
	["1.0.0", "1", "1.0.1-1.0"],
	["1.0.0-0", undefined, "1.0.0-1"],
	["1.0.0-0", "alpha", "1.0.0-alpha.0"],
	["1.0.0-alpha", undefined, "1.0.0-alpha.0"],
	["1.0.0-alpha", "alpha", "1.0.0-alpha.0"],
	["1.0.0-alpha", "beta", "1.0.0-beta.0"],
	["1.0.0-alpha", "1", "1.0.0-1.0"],
	["1.0.0-alpha.0", undefined, "1.0.0-alpha.1"],
	["1.0.0-alpha.0", "alpha", "1.0.0-alpha.1"],
	["1.0.0-alpha.0", "beta", "1.0.0-beta.0"],
	["1.0.0-alpha.9", undefined, "1.0.0-alpha.10"],
	["1.0.0-alpha.9", "alpha", "1.0.0-alpha.10"],
	["1.0.0-1.beta", undefined, "1.0.0-2.beta"],
	["1.0.0-1.beta", "alpha", "1.0.0-alpha.0"],
	["1.0.0-1.beta.2", undefined, "1.0.0-1.beta.3"],
	["1.0.0-1.beta.2", "rc", "1.0.0-rc.0"],
	["1.0.0-alpha.1.beta", undefined, "1.0.0-alpha.2.beta"],
	["1.0.0-alpha.1.beta", "alpha", "1.0.0-alpha.2.beta"],
	["1.0.0-alpha.1.beta", "beta", "1.0.0-beta.0"],
	["1.0.0-alpha.beta", undefined, "1.0.0-alpha.beta.0"],
	["1.0.0-alpha.beta", "beta", "1.0.0-beta.0"],
	["1.0.0-0.0", undefined, "1.0.0-0.1"],
	["1.0.0-0.0", "0", "1.0.0-0.1"],
	["1.0.0-0.0", "1", "1.0.0-1.0"],
	["1.0.0-rc.1+build.5", undefined, "1.0.0-rc.2"],
	["1.0.0-rc.1+build.5", "rc", "1.0.0-rc.2"],
	["1.0.0-rc.1+build.5", "alpha", "1.0.0-alpha.0"],
	["2.3.4-beta.1.x", undefined, "2.3.4-beta.2.x"],
	["2.3.4-beta.1.x", "beta", "2.3.4-beta.2.x"],
	["2.3.4-beta.1.x", "rc", "2.3.4-rc.0"],
];
export const validVersions: ReadonlyArray<string> = [
	"0.0.0",
	"1.0.0",
	"0.1.0",
	"0.0.1",
	"1.2.3",
	"999.999.999",
	"1.0.0-alpha",
	"1.0.0-alpha.1",
	"1.0.0-0.3.7",
	"1.0.0-x.7.z.92",
	"1.0.0-alpha+001",
	"1.0.0+20130313144700",
	"1.0.0-beta+exp.sha.5114f85",
	"1.0.0--",
	"1.0.0-0alpha",
	"1.0.0+001",
	"1.0.0-0.0.0",
	"1.0.0-0-0",
	"1.0.0-0.0.0.0",
	"1.0.0---",
	"0.0.0-0",
	"10.20.30",
	"1.1.2-prerelease+meta",
	"1.0.0-alpha.beta",
	"1.0.0-alpha.beta.1",
	"1.0.0-alpha.1.beta",
	"1.0.0-alpha-1",
	"1.0.0-1.0.0-alpha",
];

export const invalidVersions: ReadonlyArray<{
	input: string;
	reason: string;
}> = [
	{ input: "", reason: "empty string" },
	{ input: "1", reason: "missing minor and patch" },
	{ input: "1.0", reason: "missing patch" },
	{ input: "1.0.0.0", reason: "extra component" },
	{ input: "v1.0.0", reason: "v-prefix" },
	{ input: "V1.0.0", reason: "V-prefix" },
	{ input: "01.0.0", reason: "leading zero major" },
	{ input: "1.02.0", reason: "leading zero minor" },
	{ input: "1.0.03", reason: "leading zero patch" },
	{ input: "1.0.0-01", reason: "leading zero numeric prerelease" },
	{ input: "1.0.0-alpha.01", reason: "leading zero in prerelease id" },
	{ input: "-1.0.0", reason: "negative major" },
	{ input: "1.0.0-alpha_1", reason: "underscore in prerelease" },
	{ input: "=1.0.0", reason: "equals prefix" },
	{ input: "1.0.0 garbage", reason: "trailing garbage" },
	{ input: "a.b.c", reason: "non-numeric" },
	{ input: "1.0.0-alpha..beta", reason: "double dot prerelease" },
	{ input: "1.0.0+build..meta", reason: "double dot build" },
];

/** Pairs where the first is strictly less than the second (SemVer 2.0.0 §11) */
export const comparisonPairs: ReadonlyArray<[string, string]> = [
	["0.0.0", "0.0.1"],
	["1.0.0", "2.0.0"],
	["1.0.0", "1.1.0"],
	["1.0.0", "1.0.1"],
	["1.0.0-alpha", "1.0.0-alpha.1"],
	["1.0.0-alpha.1", "1.0.0-alpha.beta"],
	["1.0.0-alpha.beta", "1.0.0-beta"],
	["1.0.0-beta", "1.0.0-beta.2"],
	["1.0.0-beta.2", "1.0.0-beta.11"],
	["1.0.0-beta.11", "1.0.0-rc.1"],
	["1.0.0-rc.1", "1.0.0"],
	["1.0.0-alpha", "1.0.0"],
	["1.0.0-0", "1.0.0-1"],
	["1.0.0-1", "1.0.0-alpha"],
	["0.0.0", "999.999.999"],
	["1.0.0-alpha", "1.0.0-beta"],
	["1.0.0-alpha.1", "1.0.0-alpha.2"],
];
