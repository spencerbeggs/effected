// YAML 1.2 §5.4: a line break (`b-break`) is `\r\n`, `\r` or `\n`, and every
// one of them breaks a line the same way, so a document parses to one value
// under each. The fixed cases are in `line-breaks.test.ts`.

import { assert, describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
import { Arbitrary, Result, Schema } from "effect";
import { Yaml } from "../src/index.js";

const CR = String.fromCodePoint(13);
const LF = String.fromCodePoint(10);
const CRLF = `${CR}${LF}`;

const parsedValue = (text: string): string => {
	const result = Yaml.parseAllResult(text);
	return Result.isSuccess(result) ? JSON.stringify(result.success) : "ERR";
};

const withBreaks = (lf: string, lineBreak: string): string => lf.split(LF).join(lineBreak);

// A YAML-shaped alphabet without line breaks of its own; LF is the one break,
// and each document is compared with its CR and CRLF twins.
const ALPHABET = [
	"a",
	"b",
	"1",
	":",
	"-",
	" ",
	"  ",
	LF,
	"#",
	"? ",
	"...",
	"---",
	'"',
	"'",
	"[",
	"]",
	"{",
	"}",
	",",
	"&x",
	"*x",
	"!t",
	"|",
	">",
	"\\",
] as const;
const document = Arbitrary.array(Arbitrary.schema(Schema.Literals(ALPHABET)), { maxLength: 16 }).pipe(
	Arbitrary.map((pieces) => pieces.join("")),
);

describe("line breaks — property", () => {
	it.prop(
		"a document parses to the same value under LF, bare CR and CRLF",
		[document],
		([lf]) => {
			const expected = parsedValue(lf);
			assert.strictEqual(parsedValue(withBreaks(lf, CR)), expected, `CR twin of ${JSON.stringify(lf)}`);
			assert.strictEqual(parsedValue(withBreaks(lf, CRLF)), expected, `CRLF twin of ${JSON.stringify(lf)}`);
		},
		{ arbitrary: { runs: Depth.pick({ sample: 400, full: 4000 }), size: 16 } },
	);
});
