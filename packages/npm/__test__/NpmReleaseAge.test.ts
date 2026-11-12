import { assert, describe, it } from "@effect/vitest";
import { Option, Result } from "effect";
import { NpmConfig } from "../src/NpmConfig.js";
import { NpmReleaseAge } from "../src/NpmReleaseAge.js";

// Setting names, unit and default confirmed against npm's own definitions:
//   workspaces/config/lib/definitions/definitions.js, `min-release-age`
//   (default null, type [null, Number], hint <days>; npm 12.2.2 line 1541,
//   npm 11 line 1472) and `min-release-age-exclude` (default [], type
//   [Array, String], "package names or `minimatch` glob patterns"; npm 12.2.2
//   line 1577, npm 11 line 1508). Both settings exist on npm 11 and npm 12.
const config = (...lines: string[]): NpmConfig => {
	const result = NpmConfig.fromSourcesResult([{ text: lines.join("\n") }], {});
	if (Result.isFailure(result)) throw new Error("config failed");
	return result.success;
};

const DAY = 86_400_000;
const now = new Date("2026-11-12T00:00:00Z");
const daysAgo = (n: number): Date => new Date(now.getTime() - n * DAY);

describe("NpmReleaseAge", () => {
	it("min-release-age is off by default", () => {
		const age = NpmReleaseAge.fromConfig(config());
		assert.isTrue(Option.isNone(age.days));
		assert.deepStrictEqual(age.exclude, []);
		assert.isTrue(age.admits("left-pad", now, now));
	});

	it("reads days from npmrc", () => {
		const age = NpmReleaseAge.fromConfig(config("min-release-age=3"));
		assert.deepStrictEqual(age.days, Option.some(3));
	});

	it("treats a non-numeric or negative value as off", () => {
		assert.isTrue(Option.isNone(NpmReleaseAge.fromConfig(config("min-release-age=soon")).days));
		assert.isTrue(Option.isNone(NpmReleaseAge.fromConfig(config("min-release-age=-1")).days));
	});

	it("reads the exclude setting", () => {
		const age = NpmReleaseAge.fromConfig(config("min-release-age=3", "min-release-age-exclude=@scope/*"));
		assert.deepStrictEqual(age.exclude, ["@scope/*"]);
	});

	it("admits a version older than the cutoff", () => {
		const age = NpmReleaseAge.fromConfig(config("min-release-age=3"));
		assert.isTrue(age.admits("left-pad", daysAgo(4), now));
		assert.isTrue(age.admits("left-pad", daysAgo(3), now));
		assert.isFalse(age.admits("left-pad", daysAgo(2), now));
	});

	it("rejects a younger version unless excluded by a minimatch pattern", () => {
		const age = NpmReleaseAge.make({ days: Option.some(3), exclude: ["@scope/*"] });
		assert.isFalse(age.admits("left-pad", daysAgo(1), now));
		assert.isTrue(age.admits("@scope/pkg", daysAgo(1), now));
		// minimatch: `*` does not cross `/`
		assert.isFalse(age.admits("@scope/a/b", daysAgo(1), now));
	});

	it("a zero window admits everything", () => {
		const age = NpmReleaseAge.fromConfig(config("min-release-age=0"));
		assert.isTrue(age.admits("left-pad", now, now));
	});
});
