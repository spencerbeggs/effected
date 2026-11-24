// MD044 `proper-names`, held to markdownlint's own MD044 over the upstream
// fixture corpus (LF and CRLF), whose proper-names fixtures set `names` in
// their own configuration comments, and over a grid of names in every place a
// name sits (see `properNamesGrid`) under each setting.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD044 } from "../../src/rules/MD044.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { PROPER_NAMES, properNamesGrid } from "../helpers/proper-names-grid.js";

const run = runRule(MD044);

describe("MD044 proper-names", () => {
	it(
		"agrees with markdownlint with default settings",
		() => {
			const result = differential(MD044);
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	for (const settings of [
		{ names: PROPER_NAMES },
		{ names: PROPER_NAMES, code_blocks: false },
		{ names: PROPER_NAMES, html_elements: false },
		{ names: PROPER_NAMES, code_blocks: false, html_elements: false },
	]) {
		it(
			`agrees with markdownlint over the grid under ${JSON.stringify(settings)}`,
			() => {
				const result = settingsDifferential(MD044, [settings], properNamesGrid);
				assert.deepStrictEqual(result.divergences, []);
				assert.isAbove(result.oracleFindings, 0);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `names` only as a list, and `code_blocks` and `html_elements` as `x === undefined || !!x`.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD044,
				[
					{ names: "JavaScript" },
					{ names: null },
					{ names: ["JavaScript"], code_blocks: 0 },
					{ names: ["JavaScript"], html_elements: "" },
					{ names: ["JavaScript"], code_blocks: "no" },
				],
				[...properNamesGrid, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Where markdownlint throws or hangs, the kit stays total: a name that is no string (markdownlint calls string
	// methods on it) reads as no names; an empty name, whose pattern matches nothing at every word boundary and loops
	// markdownlint forever, is passed over.
	it("reads a setting markdownlint throws or hangs on as the default", () => {
		const source = "javascript and github\n";
		assert.deepStrictEqual(run(source, { names: ["JavaScript", 5] }), []);
		assert.deepStrictEqual(run(source, { names: [null] }), []);
		assert.deepStrictEqual(
			run(source, { names: ["", "GitHub"] }).map((each) => each.lineNumber),
			[1],
		);
	});

	it("reports a name in the wrong case, with a fix that writes it", () => {
		const source = "Use javascript here.\n";
		const findings = run(source, { names: ["JavaScript"] });
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.deepStrictEqual(finding?.detail, Option.some("Expected: JavaScript; Actual: javascript"));
		assert.deepStrictEqual(finding?.range, Option.some([5, 10] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"Use JavaScript here.\n",
		);
	});
});

// markdownlint's MD044 findings over the corpus (LF and CRLF).
const ORACLE_FINDINGS_DEFAULT = 196;
