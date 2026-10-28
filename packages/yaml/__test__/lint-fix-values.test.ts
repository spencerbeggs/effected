// A lint fix is a style edit: applying it must never change what the
// document parses to. A fix that cannot be applied safely declines: the
// finding is reported and the text is left alone.
//
// Two classes of fix broke that. Fixes computed from line positions landed
// inside scalars while the composer read a bare `\r` as content
// (`YamlLint.fix("a: 1\r")` appended `...` to the value `1`). And fixes keyed
// on the lexer's tokens edited what the composer reads as scalar content or
// structure: `colon-spacing` turned `- : 1` into `-: 1`, `hyphen-spacing`
// re-parented the lines below a moved collection, `trailing-spaces` and
// `empty-lines` deleted blank lines of a multi-line plain scalar, and
// `comments-spacing` edited a `#` the composer folds into one.

import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Result, Schema } from "effect";
import { Yaml, YamlLint, YamlLintConfig } from "../src/index.js";

const CR = String.fromCodePoint(13);
const LF = String.fromCodePoint(10);
const CRLF = `${CR}${LF}`;

const parsedValue = (text: string): string => {
	const result = Yaml.parseAllResult(text);
	return Result.isSuccess(result) ? JSON.stringify(result.success) : "ERR";
};

// Every built-in rule on with its default options: the default preset plus
// the two document-marker rules it leaves off.
const config = YamlLintConfig.make({
	rules: { ...YamlLintConfig.default.rules, "document-start": "error", "document-end": "error" },
});

const fixed = (text: string): string => {
	const result = YamlLint.fix(text, YamlLint.builtins, config);
	if (Result.isFailure(result)) throw new Error(`fix failed for ${JSON.stringify(text)}`);
	return result.success;
};

const assertKeepsValue = (text: string): void => {
	const out = fixed(text);
	assert.strictEqual(parsedValue(out), parsedValue(text), `${JSON.stringify(text)} -> ${JSON.stringify(out)}`);
};

describe("YamlLint.fix keeps the parsed value", () => {
	it("every built-in rule is enabled", () => {
		const enabled = new Set(Object.keys(config.rules));
		for (const rule of YamlLint.builtins) {
			if (rule.id !== "parse-validity") assert.isTrue(enabled.has(rule.id), rule.id);
		}
	});

	it("document-end does not append its marker to the last scalar of a bare-CR document", () => {
		assert.deepStrictEqual(Yaml.parseResult(`a: 1${CR}`), Result.succeed({ a: 1 }));
		assertKeepsValue(`a: 1${CR}`);
	});

	it("eof-newline counts a trailing bare CR as the final line break, as the composer does", () => {
		const text = `a: 1${CR}b: 2${CR}`;
		const result = YamlLint.fix(text, YamlLint.builtins, YamlLintConfig.default);
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result)) assert.strictEqual(result.success, text);
	});

	it("colon-spacing keeps `- :`, `a: :` and `*x :` apart", () => {
		for (const text of ["- : 1\n", "a: : 1\n", "a: &x k\n*x : 1\n", ": :\n"]) assertKeepsValue(text);
	});

	it("hyphen-spacing keeps a multi-line collection's column and a folded hyphen", () => {
		for (const text of ["-   a: 1\n    b: 2\n", "-   -\n    1\n", "b\n -  a\n"]) assertKeepsValue(text);
	});

	it("trailing-spaces keeps a blank line of a plain scalar between a bare CR and an LF", () => {
		assertKeepsValue(`a: b${CR} ${LF}  c${LF}`);
	});

	it("empty-lines keeps the blank lines of a multi-line plain scalar, with LF alone", () => {
		assertKeepsValue("a: one\n\n\n\n  two\n");
		assertKeepsValue(`a: one${CR}${CR}${CR}${CR}  two${CR}`);
	});

	it("comments-spacing keeps a # the composer folds into a plain scalar", () => {
		assertKeepsValue("a\n - #b\n");
	});

	it("document-start keeps a root block scalar's explicit indentation", () => {
		assertKeepsValue(">1\n #:a\n");
	});
});

// The value must survive EVERY fix, with every rule on, over documents from a
// YAML-shaped alphabet that holds all three line breaks.
const BASE = ["a", "b", "1", ":", "-", " ", "  ", "#", LF, CR, CRLF] as const;
const RICH = [...BASE, "? ", '"', "'", "[", "]", "{", "}", ",", "&x", "*x", "!t", "...", "---", ">", "|"] as const;

const documentOf = (alphabet: ReadonlyArray<string>, maxLength: number) =>
	Arbitrary.array(Arbitrary.schema(Schema.Literals(alphabet as [string, ...Array<string>])), { maxLength }).pipe(
		Arbitrary.map((pieces) => pieces.join("")),
	);

const keepsValue = ([input]: readonly [string]): void => {
	const result = YamlLint.fix(input, YamlLint.builtins, config);
	if (Result.isFailure(result)) return;
	assert.strictEqual(
		parsedValue(result.success),
		parsedValue(input),
		`${JSON.stringify(input)} -> ${JSON.stringify(result.success)}`,
	);
};

describe("YamlLint.fix — property", () => {
	it.prop("applying every fix never changes the parsed value", [documentOf(BASE, 16)], keepsValue, {
		arbitrary: { runs: 4000, size: 16 },
	});

	it.prop(
		"applying every fix never changes the parsed value, flow and block indicators included",
		[documentOf(RICH, 16)],
		keepsValue,
		{ arbitrary: { runs: 4000, size: 16 } },
	);
});
