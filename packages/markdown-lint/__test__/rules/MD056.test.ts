// MD056 `table-column-count`, held to markdownlint's own MD056 over the
// upstream fixture corpus (LF and CRLF) and the table grid (see
// `tableGrid`). A row's cells are counted from its raw line as micromark
// tokenizes it. The rule has no settings.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD056 } from "../../src/rules/MD056.js";
import { DIFFERENTIAL_TIMEOUT, differential, runRule } from "../helpers/differential.js";
import { directiveGrid, lonePipeRows, tableGrid } from "../helpers/table-grid.js";

const run = runRule(MD056);

describe("MD056 table-column-count", () => {
	it(
		"agrees with markdownlint over the corpus and the table grid",
		() => {
			const result = differential(MD056, { extra: tableGrid });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// markdownlint's directive extension ends a table before a leaf directive, a container directive's opening and an
	// open container directive's closing fence, in every container.
	it(
		"agrees with markdownlint where a directive line ends a table",
		() => {
			const result = differential(MD056, { extra: directiveGrid });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DIRECTIVES);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// The lone pipe row (see MD055): one cell, so markdownlint reports it too few; the kit reads no row there.
	it(
		"pins the lone pipe row as a parser-reading difference",
		() => {
			const result = differential(MD056, { extra: lonePipeRows });
			assert.deepStrictEqual(
				result.divergences.map((divergence) => divergence.fixture),
				lonePipeRows.map((input) => input.name),
			);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports too few and too many cells against the header", () => {
		const findings = run("| a | b |\n| - | - |\n| c |\n| d | e | f |\n");
		assert.deepStrictEqual(
			findings.map((finding) => [finding.lineNumber, finding.detail, finding.range]),
			[
				[
					3,
					Option.some("Expected: 2; Actual: 1; Too few cells, row will be missing data"),
					Option.some([5, 1] as const),
				],
				[
					4,
					Option.some("Expected: 2; Actual: 3; Too many cells, extra data will be missing"),
					Option.some([9, 5] as const),
				],
			],
		);
	});
});

// markdownlint's MD056 findings over the corpus (LF and CRLF) and the table grid.
const ORACLE_FINDINGS_DEFAULT = 109;

// markdownlint's MD056 findings over the corpus (LF and CRLF) and the directive grid.
const ORACLE_FINDINGS_DIRECTIVES = 150;
