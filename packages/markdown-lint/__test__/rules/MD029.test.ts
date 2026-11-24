// MD029 `ol-prefix`, held to markdownlint's own MD029 over the upstream
// fixture corpus (LF and CRLF) and over inputs its setting changes. An
// ordered list's style is inferred from its first two numbers unless set; a
// list is right-aligned when every item's prefix (number, delimiter and the
// whitespace after) ends at one column.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD029 } from "../../src/rules/MD029.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";

const extra = [
	{ name: "one style", source: "1. a\n1. b\n2. c\n" },
	{ name: "ordered style", source: "1. a\n2. b\n4. c\n" },
	{ name: "zero start", source: "0. a\n1. b\n3. c\n" },
	{ name: "zeros", source: "0. a\n0. b\n1. c\n" },
	{ name: "starts at three", source: "3. a\n4. b\n6. c\n" },
	{ name: "single item", source: "5. a\n" },
	{ name: "right-aligned", source: " 8. a\n 9. b\n11. c\n" },
	{ name: "zero-padded", source: "08. a\n09. b\n11. c\n" },
	{ name: "paren delimiter", source: "1) a\n3) b\n" },
	{ name: "nested", source: "1. a\n   1. b\n   3. c\n2. d\n" },
	{ name: "loose", source: "1. a\n\n3. b\n\n2. c\n" },
	{ name: "blockquote", source: "> 1. a\n> 3. b\n" },
	{ name: "under a bullet", source: "- a\n  2. b\n  2. c\n" },
	{ name: "wide numbers", source: "99. a\n100. b\n" },
	{ name: "list in math", source: "$$\n1. a\n3. b\n$$\n" },
	{ name: "list in code", source: "```\n1. a\n3. b\n```\n" },
	{ name: "front matter", source: "---\ntitle: x\n---\n1. a\n3. b\n" },
	{ name: "CRLF", source: "1. a\r\n3. b\r\n" },
	{ name: "interrupting a paragraph", source: "- Item\n  1. a\n  3. b\n\ntext\n10. c\n11. d\n" },
];

const run = runRule(MD029);

describe("MD029 ol-prefix", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD029, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the default spelled out changes nothing.
	// Recorded divergence "a list opening `01.` interrupts a paragraph": micromark lets an ordered list interrupt a
	// paragraph only when its number's first digit is `1`, where the kit (CommonMark's reference parser) reads the
	// number, so `- Item\n  01. One` nests a list here and continues the paragraph there. Under `one` and `zero`
	// the kit then reports that list's items; under the inferred styles they agree.
	const interrupting = ["list-item-prefix-alignment.md", "list-item-prefix-alignment.md (CRLF)"];
	for (const [settings, changes, divergent] of [
		[{ style: "one" }, true, interrupting],
		[{ style: "ordered" }, true, []],
		[{ style: "zero" }, true, interrupting],
		[{ style: "one_or_ordered" }, false, []],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD029, { config: settings, extra });
				assert.deepStrictEqual(
					result.divergences.map((divergence) => divergence.fixture),
					[...divergent],
				);
				for (const divergence of result.divergences)
					assert.match(divergence.reason, /lineNumber: kit 4[34], markdownlint 5[78]$/);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `String(style)`: a value naming no style reads as the inferred one.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD029,
				[{ style: null }, { style: 1 }, { style: ["one"] }, { style: "ONE" }, { style: "" }],
				[...extra, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a number out of order, with its prefix as the range and a fix that renumbers it", () => {
		const source = "1. a\n2. b\n4. c\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 3);
		assert.deepStrictEqual(finding?.detail, Option.some("Expected: 3; Actual: 4; Style: 1/2/3"));
		assert.deepStrictEqual(finding?.range, Option.some([1, 3] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"1. a\n2. b\n3. c\n",
		);
	});
});

// markdownlint's MD029 findings over the corpus (LF and CRLF) and the extras.
const ORACLE_FINDINGS_DEFAULT = 287;
