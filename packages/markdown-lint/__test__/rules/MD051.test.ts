// MD051 `link-fragments`, held to markdownlint's own MD051 over the upstream
// fixture corpus (LF and CRLF), the link grid (see `linkGrid`), the fragment
// grid (see `fragmentGrid`) and anchor shapes, and over inputs its settings
// change. A heading's fragment is GitHub's, as markdownlint builds it.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD051 } from "../../src/rules/MD051.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { anchorShapes, fragmentGrid } from "../helpers/fragment-grid.js";
import { linkGrid } from "../helpers/link-grid.js";

const extra = [...linkGrid, ...fragmentGrid, ...anchorShapes];

const run = runRule(MD051);

describe("MD051 link-fragments", () => {
	it(
		"agrees with markdownlint with default settings over the corpus, the fragment grid and anchor shapes",
		() => {
			const result = differential(MD051, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the defaults spelled out change nothing.
	for (const [settings, changes] of [
		[{ ignore_case: true }, true],
		[{ ignored_pattern: "^missing" }, true],
		[{ ignored_pattern: "^[A-Z]", ignore_case: true }, true],
		[{ ignore_case: false, ignored_pattern: "" }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD051, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `ignore_case || false` and `new RegExp(ignored_pattern || "^$")`: a number is its digits.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD051,
				[
					{ ignore_case: 1 },
					{ ignore_case: "" },
					{ ignored_pattern: 0 },
					{ ignored_pattern: 1 },
					{ ignored_pattern: null },
				],
				[...anchorShapes, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Named divergences, not of the port: markdownlint throws on a pattern that does not compile, and runs one whose
	// matching can take exponential time; the kit stays total and bounded, reading either as the default.
	it("reads an ignored_pattern markdownlint throws on, or one it could run unbounded, as the default", () => {
		const source = `# H\n\n[a](#${"a".repeat(40)}!)\n`;
		const lines = (settings: Record<string, unknown>) => run(source, settings).map((each) => each.lineNumber);
		const defaults = lines({});
		assert.deepStrictEqual(defaults, [3]);
		for (const ignored_pattern of ["(", "[a-", "(a+)+$", "(a|aa)*$", "(?:a*)*b", "(a{1,})+"]) {
			assert.deepStrictEqual(lines({ ignored_pattern }), defaults, ignored_pattern);
		}
		// A pattern with a quantifier that is not nested runs.
		assert.deepStrictEqual(lines({ ignored_pattern: "^a+!$" }), []);
		assert.deepStrictEqual(lines({ ignored_pattern: "^(ab)+$|^a" }), []);
	});

	it("reports a fragment differing only in case, with a fix to the heading's", () => {
		const source = "# Getting Started\n\nSee [the guide](#Getting-Started).\n";
		const findings = run(source);
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.deepStrictEqual(finding?.detail, Option.some("Expected: #getting-started; Actual: #Getting-Started"));
		assert.deepStrictEqual(finding?.context, Option.some("[the guide](#Getting-Started)"));
		assert.deepStrictEqual(finding?.range, Option.some([5, 29] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"# Getting Started\n\nSee [the guide](#getting-started).\n",
		);
	});
});

// markdownlint's MD051 findings over the corpus (LF and CRLF), the grids and the anchor shapes.
const ORACLE_FINDINGS_DEFAULT = 391;
