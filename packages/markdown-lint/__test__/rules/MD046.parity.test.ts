// MD046 `code-block-style`, held to markdownlint's own MD046 over the
// upstream fixture corpus (LF and CRLF) and over inputs its setting changes.

import { assert, describe, it } from "@effect/vitest";
import { Corpus, Depth } from "@effected/testing";
import { Option } from "effect";
import { MD046 } from "../../src/rules/MD046.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { directiveBlockGrid, directiveListEnds } from "../helpers/table-grid.js";

const extra = [
	{ name: "fenced first", source: "```\na\n```\n\ntext\n\n    b\n" },
	{ name: "indented first", source: "text\n\n    a\n\n```\nb\n```\n" },
	{ name: "tilde fence", source: "~~~\na\n~~~\n\n    b\n" },
	{ name: "in containers", source: "> ```\n> a\n> ```\n\n- text\n\n      b\n" },
	{ name: "unclosed fence", source: "    a\n\n```\nb\n" },
	{ name: "indented after a list", source: "- a\n\n      code\n\n```\nb\n```\n" },
	{ name: "in math", source: "$$\n```\nx\n```\n$$\n\n    b\n" },
	{ name: "in html", source: "<div>\n\n    a\n\n</div>\n\n```\nb\n```\n" },
	{ name: "front matter", source: "---\ntitle: x\n---\n```\na\n```\n\n    b\n" },
	{ name: "CRLF", source: "```\r\na\r\n```\r\n\r\n    b\r\n" },
];

const run = runRule(MD046);

describe("MD046 code-block-style", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD046, { extra });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the default spelled out changes nothing.
	for (const [settings, changes] of [
		[{ style: "fenced" }, true],
		[{ style: "indented" }, true],
		[{ style: "consistent" }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD046, { config: settings, extra });
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
				MD046,
				[{ style: 0 }, { style: null }, { style: "" }, { style: "Fenced" }, { style: 1 }, { style: ["fenced"] }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a block in the other style with the expected and actual style", () => {
		const findings = run("```\na\n```\n\ntext\n\n    b\n");
		assert.lengthOf(findings, 1);
		assert.strictEqual(findings[0]?.lineNumber, 7);
		assert.deepStrictEqual(findings[0]?.detail, Option.some("Expected: fenced; Actual: indented"));
		assert.deepStrictEqual(findings[0]?.fixInfo, Option.none());
	});

	// markdownlint's directive extension ends a paragraph (and a lazy list item, and a table) before a directive line,
	// and reads an indented line after one as code: beside each block kind, in each container.
	it(
		"agrees with markdownlint beside directive lines",
		() => {
			const result = differential(MD046, { extra: [...directiveBlockGrid, ...directiveListEnds] });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DIRECTIVE_BLOCKS);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD046 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 47;

// markdownlint's MD046 findings over the corpus (LF and CRLF) and the blocks beside directive lines.
const ORACLE_FINDINGS_DIRECTIVE_BLOCKS = 38;
