// A lint fix is a style edit: applying it must never change what the document
// parses to. The fixed cases, one per fix that once broke it, are in
// `lint-fix-values.test.ts`.

import { assert, describe, it } from "@effect/vitest";
import { Depth } from "@effected/testing";
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
		arbitrary: { runs: Depth.pick({ sample: 4_000, full: 40_000 }), size: 16 },
	});

	it.prop(
		"applying every fix never changes the parsed value, flow and block indicators included",
		[documentOf(RICH, 16)],
		keepsValue,
		{ arbitrary: { runs: Depth.pick({ sample: 4_000, full: 40_000 }), size: 16 } },
	);
});
