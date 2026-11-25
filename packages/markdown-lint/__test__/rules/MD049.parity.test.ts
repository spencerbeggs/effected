// MD049 `emphasis-style`, held to markdownlint's own MD049 over the upstream
// fixture corpus (LF and CRLF), over a grid of emphasis shapes (see
// `emphasisStyleGrid`) and over inputs its setting changes.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Corpus, Depth } from "@effected/testing";
import { Option } from "effect";
import { MD049 } from "../../src/rules/MD049.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { emphasisStyleGrid } from "../helpers/emphasis-grid.js";

const run = runRule(MD049);

describe("MD049 emphasis-style", () => {
	it(
		"agrees with markdownlint with default settings over the corpus and the grid",
		() => {
			const result = differential(MD049, { extra: emphasisStyleGrid });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the default spelled out changes nothing.
	for (const [settings, changes] of [
		[{ style: "asterisk" }, true],
		[{ style: "underscore" }, true],
		[{ style: "consistent" }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD049, { config: settings, extra: emphasisStyleGrid });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) Depth.whenFull(() => assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT));
				else Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `style || undefined`, then the default `consistent`: a falsy value is the default, and any
	// other is compared as it is, so an unknown style reports every span and fixes it to the underscore.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD049,
				[{ style: 0 }, { style: null }, { style: "" }, { style: "Asterisk" }, { style: 1 }, { style: ["asterisk"] }],
				[...emphasisStyleGrid.slice(0, 12), ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports both markers of an emphasis in the other style, with fixes that swap them", () => {
		const source = "*a* and _b_\n";
		const findings = run(source);
		assert.lengthOf(findings, 2);
		assert.deepStrictEqual(findings[0]?.detail, Option.some("Expected: asterisk; Actual: underscore"));
		assert.deepStrictEqual(findings[0]?.range, Option.some([9, 1] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"*a* and *b*\n",
		);
	});
});

// markdownlint's MD049 findings over the corpus (LF and CRLF) and the grid.
const ORACLE_FINDINGS_DEFAULT = 192;
