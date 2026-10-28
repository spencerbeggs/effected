// A lint fix is a style edit: applying it must never change what the
// document parses to. The tokens and lint lines a fix is computed from must
// break lines where the composer does, `\n` and `\r\n` only. When they
// broke at a bare `\r` too, the composer still read the `\r` as an ordinary
// character, so a fix aimed at a "line end" landed inside a scalar:
// `YamlLint.fix("a: 1\r")` appended `...` to the value `1`.

import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Result, Schema } from "effect";
import { Yaml, YamlLint, YamlLintConfig } from "../src/index.js";

const CR = String.fromCodePoint(13);
const LF = String.fromCodePoint(10);

const parsedValue = (text: string): string => {
	const result = Yaml.parseAllResult(text);
	return Result.isSuccess(result) ? JSON.stringify(result.success) : "ERR";
};

// The default preset plus the two document-marker rules, which are off by
// default: `document-end` is the fix that appended to a scalar.
const config = YamlLintConfig.make({
	rules: { ...YamlLintConfig.default.rules, "document-start": "error", "document-end": "error" },
});

const fixed = (text: string, preset: YamlLintConfig = YamlLintConfig.default): string => {
	const result = YamlLint.fix(text, YamlLint.builtins, preset);
	if (Result.isFailure(result)) throw new Error(`fix failed for ${JSON.stringify(text)}`);
	return result.success;
};

describe("YamlLint.fix keeps the parsed value of a bare-CR document", () => {
	it("document-end does not append its marker to the last scalar", () => {
		const text = `a: 1${CR}`;
		assert.deepStrictEqual(Yaml.parseResult(text), Result.succeed({ a: 1 }));
		const out = fixed(text, config);
		assert.deepStrictEqual(Yaml.parseAllResult(out), Yaml.parseAllResult(text), JSON.stringify(out));
	});

	it("empty-lines does not merge a bare-CR line into a key", () => {
		const text = `${CR}:${LF}b`;
		assert.strictEqual(parsedValue(text), parsedValue(`${LF}:${LF}b`));
		assert.strictEqual(parsedValue(fixed(text)), parsedValue(text));
	});

	it("eof-newline counts a trailing bare CR as the final line break, as the composer does", () => {
		const text = `a: 1${CR}b: 2${CR}`;
		assert.strictEqual(fixed(text), text);
	});
});

// The generator's domain is the one where the published linter already kept
// values; three pre-existing defects outside the bare-CR regression are
// excluded and tracked separately:
// - `colon-spacing` and `hyphen-spacing` rewrite `: :` / `- :` / `-  a` into
//   a different structure, CR or not (the two rules are left out);
// - `trailing-spaces` strips whitespace after a bare `\r` that the composer
//   reads as scalar content;
// - `empty-lines` deletes blank lines inside a multi-line plain scalar,
//   which folds them into its value.
const ALPHABET = ["a", "b", ":", "-", " ", LF, CR, `${CR}${LF}`, "1"] as const;
const text = Arbitrary.array(Arbitrary.schema(Schema.Literals(ALPHABET)), { maxLength: 14 }).pipe(
	Arbitrary.map((pieces) => pieces.join("")),
);
const preexisting = (input: string): boolean =>
	/\r[ \t]/.test(input) || /(\r\n|\n|\r)[ \t]*(\r\n|\n|\r)[ \t]*(\r\n|\n|\r)/.test(input);
const rules = YamlLint.builtins.filter((rule) => rule.id !== "colon-spacing" && rule.id !== "hyphen-spacing");

describe("YamlLint.fix — property", () => {
	it.prop(
		"applying every fix never changes the parsed value",
		[text],
		([input]) => {
			if (preexisting(input)) return;
			const result = YamlLint.fix(input, rules, config);
			if (Result.isFailure(result)) return;
			assert.strictEqual(
				parsedValue(result.success),
				parsedValue(input),
				`${JSON.stringify(input)} -> ${JSON.stringify(result.success)}`,
			);
		},
		{ arbitrary: { runs: 4000, size: 14 } },
	);
});
