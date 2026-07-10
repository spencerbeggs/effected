// The smol-toml differential oracle: property tests cross-checking the engine
// against the reference implementation (smol-toml 1.7.0, exact-pinned), plus
// a corpus-wide differential over every toml-test valid file. This is the
// ONLY file that may import smol-toml.
//
// Probe-derived decisions (all probed against the installed 1.7.0 before the
// normalizer was written):
// - Datetimes are EXCLUDED from generation: smol-toml models all four TOML
//   date-time types as TomlDate (a Date subclass) and truncates fractional
//   seconds to milliseconds (`.999999999` parses back as `.999`,
//   `07:32:00.123456` as `.123`) — lossy against our nanosecond-carrying
//   classes. The corpus differential still cross-checks every corpus
//   datetime, compared modulo the oracle's millisecond truncation.
// - The oracle always parses with `{ integersAsBigInt: true }`: default-mode
//   smol-toml throws "integer value cannot be represented losslessly" at the
//   int64 extremes the corpus and the generator both exercise. Under the
//   option EVERY integer comes back bigint, so the canonicalizer unifies
//   integral bigints within ±(2^53 − 1) to number on BOTH sides before any
//   comparison.
// - smol-toml stringify accepts bigint inputs natively (probed: `123n` emits
//   `x = 123`, int64 max emits its exact digits), so the oracle-stringify
//   property passes generated values through unmapped.
// - Lone surrogates are excluded from generation: smol-toml stringify happily
//   emits `\ud800` as a basic-string escape, which is invalid TOML (escaped
//   values must be Unicode scalar values) and our parser correctly rejects.
// - NaN is excluded from the equality properties (canonicalized to a sentinel
//   defensively for the corpus side) and round-trips in a dedicated test.

import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { FastCheck as fc } from "effect/testing";
import { parse as oracleParse, stringify as oracleStringify } from "smol-toml";
import { Toml } from "../src/Toml.js";
import { TomlLocalDate, TomlLocalDateTime, TomlLocalTime, TomlOffsetDateTime } from "../src/TomlDateTime.js";
import { assertMatchesTagged } from "./e2e/taggedJson.js";

// ── The canonicalizer ──────────────────────────────────────────────────────

const MAX_SAFE_BIG = BigInt(Number.MAX_SAFE_INTEGER);

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$/i;

/** The oracle's millisecond truncation, applied to a fraction-digits string. */
const fractionToMs = (fraction: string | undefined): number =>
	fraction === undefined ? 0 : Number(fraction.padEnd(3, "0").slice(0, 3));

/** `Z`/`+hh:mm`/`-hh:mm` → signed minutes, with `-00:00` canonicalized to 0. */
const offsetToMinutes = (offset: string): number => {
	if (offset.toUpperCase() === "Z") {
		return 0;
	}
	const total = Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6));
	return offset.startsWith("-") && total !== 0 ? -total : total;
};

/**
 * A smol-toml TomlDate (the one Date subclass covering all four TOML
 * date-time kinds), keyed off its custom `toISOString` output shape and
 * mapped onto the same tagged record our classes canonicalize to.
 */
const canonOracleDate = (value: Date): unknown => {
	const iso = value.toISOString();
	const dateTime = DATETIME_RE.exec(iso);
	if (dateTime !== null) {
		const base = {
			year: Number(dateTime[1]),
			month: Number(dateTime[2]),
			day: Number(dateTime[3]),
			hour: Number(dateTime[4]),
			minute: Number(dateTime[5]),
			second: Number(dateTime[6]),
			ms: fractionToMs(dateTime[7]),
		};
		const offset = dateTime[8];
		return offset === undefined
			? { $dt: "datetime-local", ...base }
			: { $dt: "datetime", ...base, offset: offsetToMinutes(offset) };
	}
	const date = DATE_RE.exec(iso);
	if (date !== null) {
		return { $dt: "date-local", year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) };
	}
	const time = TIME_RE.exec(iso);
	if (time !== null) {
		return {
			$dt: "time-local",
			hour: Number(time[1]),
			minute: Number(time[2]),
			second: Number(time[3]),
			ms: fractionToMs(time[4]),
		};
	}
	return { $dt: "unrecognized", iso };
};

/**
 * Map either parser's result onto one comparable model: integral bigints
 * within ±(2^53 − 1) become number, NaN becomes a sentinel record, our
 * datetime classes and the oracle's TomlDate both become tagged records
 * truncated to millisecond precision (the oracle's ceiling), containers
 * recurse.
 */
const canon = (value: unknown): unknown => {
	switch (typeof value) {
		case "bigint":
			return value >= -MAX_SAFE_BIG && value <= MAX_SAFE_BIG ? Number(value) : value;
		case "number":
			return Number.isNaN(value) ? { $nan: true } : value;
		case "string":
		case "boolean":
			return value;
		default:
			break;
	}
	if (value instanceof TomlOffsetDateTime) {
		return {
			$dt: "datetime",
			year: value.year,
			month: value.month,
			day: value.day,
			hour: value.hour,
			minute: value.minute,
			second: value.second,
			ms: Math.floor(value.nanosecond / 1_000_000),
			offset: value.offsetMinutes === 0 ? 0 : value.offsetMinutes,
		};
	}
	if (value instanceof TomlLocalDateTime) {
		return {
			$dt: "datetime-local",
			year: value.year,
			month: value.month,
			day: value.day,
			hour: value.hour,
			minute: value.minute,
			second: value.second,
			ms: Math.floor(value.nanosecond / 1_000_000),
		};
	}
	if (value instanceof TomlLocalDate) {
		return { $dt: "date-local", year: value.year, month: value.month, day: value.day };
	}
	if (value instanceof TomlLocalTime) {
		return {
			$dt: "time-local",
			hour: value.hour,
			minute: value.minute,
			second: value.second,
			ms: Math.floor(value.nanosecond / 1_000_000),
		};
	}
	if (value instanceof Date) {
		return canonOracleDate(value);
	}
	if (Array.isArray(value)) {
		return value.map(canon);
	}
	if (typeof value === "object" && value !== null) {
		const record = value as Record<string, unknown>;
		return Object.fromEntries(Object.keys(record).map((key) => [key, canon(record[key])]));
	}
	return value;
};

/** Parse through the oracle in the mode the canonicalizer expects. */
const oracle = (text: string): unknown => oracleParse(text, { integersAsBigInt: true });

// ── The arbitraries ────────────────────────────────────────────────────────
// Recursive TOML-representable plain values, bounded at depth 4 and width 5.
// Array form ONLY for it.effect.prop: the named-record form silently discards
// Schema conversion in @effect/vitest 4.0.0-beta.94.

/** Any Unicode scalar value from space upward (escaping handled by emitters). */
const scalarCharArb = fc
	.integer({ min: 0x20, max: 0x10ffff })
	.filter((codePoint) => codePoint < 0xd800 || codePoint > 0xdfff)
	.map((codePoint) => String.fromCodePoint(codePoint));

/** The characters that stress escaping: quotes, backslashes, controls, DEL. */
const nastyCharArb = fc.constantFrom('"', "\\", "\n", "\r", "\t", "\b", "\f", "\u0000", "\u001f", "\u007f", "'", " ");

const stringArb = fc
	.array(fc.oneof({ arbitrary: scalarCharArb, weight: 5 }, { arbitrary: nastyCharArb, weight: 3 }), { maxLength: 12 })
	.map((chars) => chars.join(""));

const bareKeyArb = fc
	.array(fc.constantFrom(..."abzAZ_-019"), { minLength: 1, maxLength: 8 })
	.map((chars) => chars.join(""));

/** Keys that force quoting: dots, spaces, the empty key, quotes, unicode. */
const quotedKeyArb = fc.oneof(
	fc.constantFrom("", "a.b", "a b", 'quo"te', "back\\slash", "uni é中", "\ttab", "new\nline"),
	stringArb,
);

const keyArb = fc.oneof({ arbitrary: bareKeyArb, weight: 3 }, { arbitrary: quotedKeyArb, weight: 2 });

const integerArb = fc.oneof(fc.integer(), fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }));

const INT64_MAX = 2n ** 63n - 1n;

const bigintArb = fc.bigInt({ min: -INT64_MAX, max: INT64_MAX });

/** Finite-or-infinite doubles — NaN stays out of the equality properties. */
const floatArb = fc.double({ noNaN: true });

const leafArb: fc.Arbitrary<unknown> = fc.oneof(
	{ arbitrary: stringArb, weight: 3 },
	{ arbitrary: integerArb, weight: 2 },
	{ arbitrary: floatArb, weight: 2 },
	{ arbitrary: bigintArb, weight: 1 },
	{ arbitrary: fc.boolean(), weight: 1 },
);

function valueArb(depth: number): fc.Arbitrary<unknown> {
	if (depth <= 0) {
		return leafArb;
	}
	return fc.oneof(
		{ arbitrary: leafArb, weight: 4 },
		{ arbitrary: fc.array(valueArb(depth - 1), { maxLength: 5 }), weight: 2 },
		{ arbitrary: tableArb(depth - 1), weight: 2 },
	);
}

function tableArb(depth: number): fc.Arbitrary<Record<string, unknown>> {
	return fc.array(fc.tuple(keyArb, valueArb(depth)), { maxLength: 5 }).map((entries) => Object.fromEntries(entries));
}

/** A TOML document is a table: the root arbitrary is always an object. */
const documentArb = tableArb(3);

// ── The differential properties ────────────────────────────────────────────

/**
 * Fixed seed so a CI property failure reproduces locally: an unseeded run
 * draws a fresh seed per invocation, making a red CI run unreplayable. Bump
 * the seed deliberately (with a green run) when fresh coverage is wanted;
 * the corpus differential below is exhaustive and does not depend on it.
 */
const ORACLE_FC_PARAMS = { numRuns: 250, seed: 20260710 } as const;

describe("smol-toml differential oracle", () => {
	it.effect.prop(
		"our stringify parses identically under both parsers",
		[documentArb],
		([document]) =>
			Effect.gen(function* () {
				const text = yield* Toml.stringify(document);
				const ours = yield* Toml.parse(text);
				assert.deepStrictEqual(canon(ours), canon(oracle(text)), text);
			}),
		{ fastCheck: ORACLE_FC_PARAMS },
	);

	it.effect.prop(
		"the oracle's stringify parses identically under both parsers",
		[documentArb],
		([document]) =>
			Effect.gen(function* () {
				const text = oracleStringify(document);
				const ours = yield* Toml.parse(text);
				assert.deepStrictEqual(canon(ours), canon(oracle(text)), text);
			}),
		{ fastCheck: ORACLE_FC_PARAMS },
	);

	it.effect("NaN round-trips through our stringify into NaN under both parsers", () =>
		Effect.gen(function* () {
			const text = yield* Toml.stringify({ x: Number.NaN });
			const ours = (yield* Toml.parse(text)) as { readonly x: number };
			const theirs = oracle(text) as { readonly x: number };
			assert.isTrue(Number.isNaN(ours.x), "our parse must yield NaN");
			assert.isTrue(Number.isNaN(theirs.x), "the oracle's parse must yield NaN");
		}),
	);
});

// ── The corpus differential ────────────────────────────────────────────────
// Every toml-test valid file through both parsers, agreement asserted modulo
// `canon`. Where the oracle disagrees (rejects a valid file or parses it
// differently), OUR result is asserted against the corpus expectation instead
// and the file is recorded — the pinned list below is the console-free
// divergence log.

const CORPUS_DIR = resolve(import.meta.dirname, "fixtures/toml-test/valid");

// Guard against a silently-empty walk (count recorded in the fixture README).
const README_VALID_COUNT = 205;

const validCases: ReadonlyArray<string> = readdirSync(CORPUS_DIR, { recursive: true, encoding: "utf8" })
	.filter((entry) => entry.endsWith(".toml"))
	.map((entry) => entry.replaceAll("\\", "/"))
	.sort();

/**
 * The corpus files where smol-toml 1.7.0 diverges from the toml-test
 * expectation (and from us). Empty means full three-way agreement.
 */
const EXPECTED_ORACLE_DIVERGENCES: ReadonlyArray<string> = [];

interface Divergence {
	readonly file: string;
	readonly detail: string;
}

describe("corpus differential", () => {
	const divergences: Array<Divergence> = [];

	it("discovers the full valid corpus", () => {
		assert.isAtLeast(validCases.length, README_VALID_COUNT, "valid corpus walk came up short");
	});

	for (const relPath of validCases) {
		it.effect(relPath, () =>
			Effect.gen(function* () {
				const source = readFileSync(join(CORPUS_DIR, relPath), "utf8");
				const ours = yield* Toml.parse(source);
				let theirs: unknown;
				try {
					theirs = oracle(source);
				} catch (error) {
					divergences.push({ file: relPath, detail: `oracle rejected: ${String(error).split("\n")[0]}` });
					assertOursAgainstCorpus(ours, relPath);
					return;
				}
				if (isDeepStrictEqual(canon(ours), canon(theirs))) {
					return;
				}
				divergences.push({ file: relPath, detail: "oracle parse disagrees with ours" });
				assertOursAgainstCorpus(ours, relPath);
			}),
		);
	}

	// Defined last so every per-file test above has already run.
	it("pins the oracle divergence log", () => {
		assert.deepStrictEqual(divergences.map((divergence) => `${divergence.file}: ${divergence.detail}`).sort(), [
			...EXPECTED_ORACLE_DIVERGENCES,
		]);
	});
});

/** Where the oracle diverges, the corpus expectation decides: assert ours against it. */
function assertOursAgainstCorpus(ours: unknown, relPath: string): void {
	const expected: unknown = JSON.parse(readFileSync(join(CORPUS_DIR, relPath.replace(/\.toml$/, ".json")), "utf8"));
	assertMatchesTagged(ours, expected, "$");
}
