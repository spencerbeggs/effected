// MD055 `table-pipe-style`, held to markdownlint's own MD055 over the
// upstream fixture corpus (LF and CRLF) and the table grid (see `tableGrid`),
// under each style. A row's leading and trailing pipes are read from its raw
// line as micromark tokenizes it.

import { assert, describe, it } from "@effect/vitest";
import { Corpus, Depth } from "@effected/testing";
import { Option } from "effect";
import { MD055 } from "../../src/rules/MD055.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { lonePipeRows, tableGrid } from "../helpers/table-grid.js";

const run = runRule(MD055);

describe("MD055 table-pipe-style", () => {
	it(
		"agrees with markdownlint with default settings over the corpus and the table grid",
		() => {
			const result = differential(MD055, { extra: tableGrid });
			assert.deepStrictEqual(result.divergences, []);
			Corpus.pin(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	for (const style of [
		"leading_only",
		"trailing_only",
		"leading_and_trailing",
		"no_leading_or_trailing",
		"per_table",
	]) {
		it(
			`agrees with markdownlint under style ${style}`,
			() => {
				const result = differential(MD055, { config: { style }, extra: tableGrid });
				assert.deepStrictEqual(result.divergences, []);
				Depth.whenFull(() => assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT));
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `String(style || "consistent")`: a falsy value is the default, an unknown name expects both
	// pipes and is named in the detail.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD055,
				[{ style: "" }, { style: 0 }, { style: "unknown" }, { style: 5 }, { style: ["leading_only"] }, { style: true }],
				[...tableGrid.filter((_, index) => index % 9 === 0), ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// A named parser-reading difference: a lone `|` row continues micromark's table, where the kit's parser, as
	// cmark-gfm does, ends the table before it.
	it(
		"pins the lone pipe row as a parser-reading difference",
		() => {
			const result = differential(MD055, { config: { style: "no_leading_or_trailing" }, extra: lonePipeRows });
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				lonePipeRows.map((input) => input.name),
			);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a row missing its trailing pipe against the table's first row", () => {
		const findings = run("| a | b |\n| - | - |\n| c | d\n");
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.strictEqual(finding?.lineNumber, 3);
		assert.deepStrictEqual(
			finding?.detail,
			Option.some("Expected: leading_and_trailing; Actual: leading_only; Missing trailing pipe"),
		);
		assert.deepStrictEqual(finding?.range, Option.some([7, 1] as const));
	});
});

// markdownlint's MD055 findings over the corpus (LF and CRLF) and the table grid.
const ORACLE_FINDINGS_DEFAULT = 376;
