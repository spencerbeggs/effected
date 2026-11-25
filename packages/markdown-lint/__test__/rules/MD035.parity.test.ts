// MD035 `hr-style`, held to markdownlint's own MD035 over the upstream
// fixture corpus (LF and CRLF) and over inputs its setting changes. A
// thematic break's text is micromark's `thematicBreak` token: from its first
// marker to its line's end, trailing whitespace included.

import { assert, describe, it } from "@effect/vitest";
import { Corpus, Depth } from "@effected/testing";
import { Option } from "effect";
import { MD035 } from "../../src/rules/MD035.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";

const extra = [
	{ name: "mixed styles", source: "---\n\n***\n\n___\n\n- - -\n\n* * *\n" },
	{ name: "long and spaced", source: "-----\n\n---\n\n-  -  -\n\n- - - - -\n" },
	{ name: "trailing whitespace", source: "---\n\n---  \n\n---\t\n" },
	{ name: "indented", source: "---\n\n   ---\n\n  ***\n" },
	{ name: "in containers", source: "> ---\n>\n> ***\n\n- ---\n\n- * * *\n" },
	{ name: "setext underline is a heading", source: "***\n\nHeading\n---\n\n---\n" },
	{ name: "in code and html", source: "***\n\n```\n---\n```\n\n    ---\n\n<div>\n---\n</div>\n" },
	{ name: "in math", source: "***\n\n$$\n---\n$$\n" },
	{ name: "after front matter", source: "---\ntitle: T\n---\n\n***\n\n---\n" },
	{ name: "consistent text", source: "Not a rule\n\n---\n\n___\n" },
	{ name: "CRLF", source: "---\r\n\r\n***\r\n\r\n---  \r\n" },
];

const run = runRule(MD035);

describe("MD035 hr-style", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD035, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the default spelled out changes nothing.
	for (const [settings, changes] of [
		[{ style: "***" }, true],
		[{ style: "- - -" }, true],
		[{ style: "  ___  " }, true],
		[{ style: "consistent" }, false],
		[{ style: " consistent " }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD035, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) Depth.whenFull(() => assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT));
				else Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `String(style || "consistent").trim()`, so a non-string means its text and a falsy value
	// the default.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD035,
				[{ style: 5 }, { style: null }, { style: ["---"] }, { style: true }, { style: 0 }, { style: "" }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a rule unlike the first with the expected and actual text", () => {
		const findings = run("---\n\n* * *\n");
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 3);
		assert.deepStrictEqual(finding?.detail, Option.some("Expected: ---; Actual: * * *"));
		assert.deepStrictEqual(finding?.range, Option.none());
		assert.deepStrictEqual(finding?.fixInfo, Option.none());
	});
});

// markdownlint's MD035 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 184;
