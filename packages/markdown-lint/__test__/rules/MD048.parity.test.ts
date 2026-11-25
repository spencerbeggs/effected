// MD048 `code-fence-style`, held to markdownlint's own MD048 over the
// upstream fixture corpus (LF and CRLF) and over inputs its setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Corpus, Depth } from "@effected/testing";
import { Option } from "effect";
import { MD048 } from "../../src/rules/MD048.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";

const extra = [
	{ name: "backtick first", source: "```\na\n```\n\n~~~\nb\n~~~\n" },
	{ name: "tilde first", source: "~~~\na\n~~~\n\n```\nb\n```\n" },
	{ name: "long fences", source: "````\na\n````\n\n~~~~~\nb\n~~~~~\n" },
	{ name: "indented fence", source: "   ~~~\na\n   ~~~\n\n```\nb\n```\n" },
	{ name: "in containers", source: "> ~~~\n> a\n> ~~~\n\n- ```\n  b\n  ```\n" },
	{ name: "unclosed fence", source: "~~~\na\n\n```\nb\n" },
	{ name: "indented code is no fence", source: "    ~~~\n\n```\nb\n```\n" },
	{ name: "in math", source: "$$\n~~~\nx\n~~~\n$$\n\n```\nb\n```\n" },
	{ name: "front matter", source: "---\ntitle: x\n---\n~~~\na\n~~~\n\n```\nb\n```\n" },
	{ name: "CRLF", source: "```\r\na\r\n```\r\n\r\n~~~\r\nb\r\n~~~\r\n" },
];

const run = runRule(MD048);

describe("MD048 code-fence-style", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD048, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the default spelled out changes nothing.
	for (const [settings, changes] of [
		[{ style: "backtick" }, true],
		[{ style: "tilde" }, true],
		[{ style: "consistent" }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD048, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) Depth.whenFull(() => assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT));
				else Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `String(style || "consistent")`: a falsy value is the default, any other its text.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD048,
				[{ style: 0 }, { style: null }, { style: "" }, { style: "Tilde" }, { style: 1 }, { style: ["tilde"] }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a fence in the other style with the expected and actual style", () => {
		const findings = run("```\na\n```\n\n~~~\nb\n~~~\n");
		assert.lengthOf(findings, 1);
		assert.strictEqual(findings[0]?.lineNumber, 5);
		assert.deepStrictEqual(findings[0]?.detail, Option.some("Expected: backtick; Actual: tilde"));
		assert.deepStrictEqual(findings[0]?.fixInfo, Option.none());
	});
});

// markdownlint's MD048 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 33;
