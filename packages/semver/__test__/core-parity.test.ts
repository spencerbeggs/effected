// Differential test against core `effect/SemVer` and `effect/SemVerRange`.
//
// This package stays independent of core's SemVer modules (both
// `@stability unstable`; see okf/decisions/semver-stays-independent-of-core-semver.md),
// and core is used here as a free oracle instead: every version parse, every
// ordering and every range match must agree with it, except for the
// divergences this file allowlists by name. A disagreement outside the
// allowlist is either a kit bug (the #1040 parity probe found seven, all on
// the kit side) or a core change worth reading before the next Effect advance.
//
// Deliberate divergences:
// - TRIM: `SemVer.parseResult` and `Range.parseResult` trim surrounding
//   whitespace (node-semver does too); core rejects padded input.
// - BUILD-IN-RANGE: a range or comparator carrying build metadata parses and
//   drops it here (npm strips it); core rejects it.
// - EQUAL-WITH-BUILD: `Equal.equals` on `SemVer` follows precedence and
//   ignores build metadata (SemVer §10). Core deliberately separates a
//   structural `Equivalence` (build included) from its precedence `Order`
//   (build ignored), so the two equalities differ on `1.0.0+a` vs `1.0.0+b`.
//   Never mix kit and core values in one hash-keyed collection.

import { assert, describe, it } from "@effect/vitest";
import { SemVer as CoreSemVer, Effect, Equal, Result, SemVerRange } from "effect";
import { Range, SemVer } from "../src/index.js";
import { comparisonPairs, invalidVersions, rangeTests, validVersions } from "./spec-compliance.fixtures.js";

const sign = (n: number): -1 | 0 | 1 => (n < 0 ? -1 : n > 0 ? 1 : 0);

// TRIM: padded input is the one version-parse divergence.
const isPadded = (input: string): boolean => input.trim() !== input;

// BUILD-IN-RANGE: any `+` in a range means build metadata.
const carriesBuild = (input: string): boolean => input.includes("+");

const versionCorpus: ReadonlyArray<string> = [
	...validVersions,
	...invalidVersions.map((row) => row.input),
	" 1.2.3",
	"1.2.3 ",
	"\t1.2.3\n",
	"1.2.3-9007199254740991",
	"9007199254740992.0.0",
];

// Versions every range is matched against: releases, prereleases on and off
// the comparator tuples the ranges below use, and the minimum `0.0.0-0`.
const probeVersions: ReadonlyArray<string> = [
	"0.0.0-0",
	"0.0.0",
	"0.0.1",
	"0.1.0",
	"0.2.3",
	"0.2.9",
	"1.0.0-0",
	"1.0.0-alpha",
	"1.0.0-beta",
	"1.0.0",
	"1.2.0-beta",
	"1.2.2",
	"1.2.3-beta",
	"1.2.3-beta.2",
	"1.2.3",
	"1.2.4-alpha",
	"1.2.9",
	"1.3.0",
	"1.9.9",
	"2.0.0-0",
	"2.0.0-rc.1",
	"2.0.0",
	"2.3.4",
	"2.4.0",
	"3.0.0",
	"7.2.4",
	"10.3.1",
	"18.0.0",
	"999.999.999",
];

const rangeCorpus: ReadonlyArray<string> = [
	...rangeTests.map(([range]) => range),
	"",
	"*",
	"x",
	"X",
	"1",
	"1.2",
	"^*",
	"~*",
	"^x",
	"~x.x",
	">*",
	"<*",
	">=*",
	"<=*",
	"=*",
	">x.x",
	"^1.2.3 <*",
	"3.3.1-beta.2 || ^*",
	"* - 0.0.0-1",
	"* - 2",
	"1.2.3 - *",
	"* - *",
	"1.2 - 2.3",
	"1.2.3 - 2",
	"1.2.3-beta - 2.0.0-rc.1",
	"^0",
	"^0.0",
	"^0.0.3",
	"^0.0.0",
	"^0.2",
	"^1.2.3-beta",
	"~1.2.3-beta",
	"~0",
	"<=1.x",
	">1.2.x",
	"<1.2.x",
	"<1.x",
	">=1.0.0-alpha <1.x",
	">=1.2.0-alpha <1.2.x",
	"* <=0.0.0-1",
	"^* >=0.0.0-0",
	"~x <=0.0.0-1",
	">=* <=0.0.0-1",
	">=1.x",
	">= 1.0.0",
	"> 1.0.0 < 2.0.0",
	"^ 1.2.3",
	"~ 1.2.3",
	">= 18",
	">=1.0.0\t<2.0.0",
	">=1.0.0\n<2.0.0",
	"^1.0.0\t||\t^2.0.0",
	"1.0.0\t-\t2.0.0",
	"1.0.0  -  2.0.0",
	"* || ^1.2.3-beta",
	"1.*.3",
	"x.1.2",
	"*.1",
	"1.x.3-beta",
	">=1.2.3<2.0.0",
	"1.2.3 -2.0.0",
	"1.2.3- 2.0.0",
	"~>1.0.0",
	"v1.2.3",
	"^1.0.0 ||",
	"1.2.3+build",
	">=1.2.3+build <2.0.0",
];

describe("core parity: versions", () => {
	for (const input of versionCorpus) {
		it(`parse agrees on ${JSON.stringify(input)}`, () => {
			const kit = Result.isSuccess(SemVer.parseResult(input));
			const core = Result.isSuccess(CoreSemVer.parse(input));
			if (isPadded(input) && input.trim().length > 0) {
				// TRIM: the kit accepts what core rejects, and only that way round.
				assert.isFalse(core, "core is expected to reject padded input");
				assert.strictEqual(kit, Result.isSuccess(CoreSemVer.parse(input.trim())));
				return;
			}
			assert.strictEqual(kit, core);
		});
	}

	it("the trim allowlist discriminates (control)", () => {
		assert.isTrue(Result.isSuccess(SemVer.parseResult(" 1.2.3")));
		assert.isTrue(Result.isFailure(CoreSemVer.parse(" 1.2.3")));
	});

	for (const [lower, higher] of comparisonPairs) {
		it(`ordering agrees on ${lower} < ${higher}`, () => {
			const a = Result.getOrThrow(SemVer.parseResult(lower));
			const b = Result.getOrThrow(SemVer.parseResult(higher));
			const ca = CoreSemVer.parseUnsafe(lower);
			const cb = CoreSemVer.parseUnsafe(higher);
			assert.strictEqual(a.compare(b), sign(CoreSemVer.Order(ca, cb)));
			assert.strictEqual(b.compare(a), sign(CoreSemVer.Order(cb, ca)));
		});
	}

	it.effect.prop("compare's sign matches core Order on generated versions", [SemVer, SemVer], ([a, b]) =>
		Effect.sync(() => {
			const ca = CoreSemVer.parseUnsafe(a.toString());
			const cb = CoreSemVer.parseUnsafe(b.toString());
			assert.strictEqual(a.compare(b), sign(CoreSemVer.Order(ca, cb)), `${a} vs ${b}`);
		}),
	);

	it("EQUAL-WITH-BUILD: kit Equal follows precedence, core Equivalence includes build", () => {
		const a = Result.getOrThrow(SemVer.parseResult("1.0.0+a"));
		const b = Result.getOrThrow(SemVer.parseResult("1.0.0+b"));
		const ca = CoreSemVer.parseUnsafe("1.0.0+a");
		const cb = CoreSemVer.parseUnsafe("1.0.0+b");
		assert.isTrue(Equal.equals(a, b));
		assert.strictEqual(a.compare(b), 0);
		assert.isFalse(CoreSemVer.Equivalence(ca, cb));
		assert.strictEqual(CoreSemVer.Order(ca, cb), 0);
	});
});

describe("core parity: ranges", () => {
	it("the corpus exercises tab and newline separators", () => {
		assert.isTrue(rangeCorpus.some((r) => r.includes("\t")));
		assert.isTrue(rangeCorpus.some((r) => r.includes("\n")));
	});

	for (const input of rangeCorpus) {
		it(`parse and match agree on ${JSON.stringify(input)}`, () => {
			const kit = Range.parseResult(input);
			const core = SemVerRange.parse(input);

			if (carriesBuild(input)) {
				// BUILD-IN-RANGE: the kit strips build metadata, core rejects it.
				// Matching must equal the build-free spelling's.
				assert.isTrue(Result.isFailure(core), "core is expected to reject build metadata in a range");
				const stripped = input.replace(/\+[0-9A-Za-z.-]+/gu, "");
				assert.isTrue(Equal.equals(Result.getOrThrow(kit), Result.getOrThrow(Range.parseResult(stripped))));
				return;
			}

			assert.strictEqual(Result.isSuccess(kit), Result.isSuccess(core), "parse acceptance differs");
			if (Result.isFailure(kit) || Result.isFailure(core)) return;

			for (const v of probeVersions) {
				const expected = SemVerRange.matches(core.success, CoreSemVer.parseUnsafe(v));
				const actual = kit.success.test(Result.getOrThrow(SemVer.parseResult(v)));
				assert.strictEqual(actual, expected, `${JSON.stringify(input)} against ${v}`);
			}
		});
	}
});
