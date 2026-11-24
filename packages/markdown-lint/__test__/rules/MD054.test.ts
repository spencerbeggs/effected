// MD054 `link-image-style`, held to markdownlint's own MD054 over the
// upstream fixture corpus (LF and CRLF), the link grid (see `linkGrid`), the
// reference grid (see `referenceGrid`) and the link-style grid (see
// `linkStyleGrid`), under each style its settings disallow. Every style is
// allowed by default, which reports nothing.

import { assert, describe, it } from "@effect/vitest";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import { MD054 } from "../../src/rules/MD054.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { linkGrid } from "../helpers/link-grid.js";
import { linkStyleGrid } from "../helpers/link-style-grid.js";
import { labelShapes, paragraphBreakShapes, referenceGrid, tabbedDefinitions } from "../helpers/reference-grid.js";

const extra = [...linkGrid, ...referenceGrid, ...labelShapes, ...linkStyleGrid];

// A named divergence, not of the port: markdownlint's undefined-reference shim copies an autolink's events into the
// artificial reference it builds, so an autolink in an undefined reference's label is a second `autolink` token there
// and reported twice. The kit reports it once (see MD033's record of the same copy).
const COPIED_AUTOLINKS = [
	"reference-links-and-images-inlines.md",
	"reference-links-and-images-inlines.md (CRLF)",
	"autolink in a label",
];

const assertCopiedAutolinks = (divergences: ReadonlyArray<{ readonly fixture: string; readonly reason: string }>) => {
	for (const divergence of divergences) {
		assert.include(COPIED_AUTOLINKS, divergence.fixture);
		assert.match(
			divergence.reason,
			/^(?:missing finding \d+|finding \d+ \(line \d+\) (?:lineNumber|range|context|fixInfo))/,
		);
	}
};

const run = runRule(MD054);

describe("MD054 link-image-style", () => {
	it(
		"agrees with markdownlint with default settings, which allow every style",
		() => {
			const result = differential(MD054, { extra });
			// The corpus's own configure comments disallow styles in some fixtures, none of them autolinks.
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each style disallowed alone and together; every setting changes markdownlint's findings.
	for (const settings of [
		{ autolink: false },
		{ inline: false },
		{ full: false },
		{ collapsed: false },
		{ shortcut: false },
		{ url_inline: false },
		{ url_inline: false, autolink: false },
		{ inline: false, autolink: false },
		{ full: false, collapsed: false, shortcut: false },
		{ autolink: false, inline: false, full: false, collapsed: false, shortcut: false, url_inline: false },
	]) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD054, { config: settings, extra });
				assertCopiedAutolinks(result.divergences);
				if (settings.autolink === false) assert.lengthOf(result.divergences, COPIED_AUTOLINKS.length);
				assert.isAbove(result.oracleFindings, 0);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads each setting as `x === undefined || !!x`.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD054,
				[{ autolink: 0 }, { inline: "" }, { full: null }, { shortcut: "no" }, { url_inline: 0, autolink: 1 }],
				[...linkStyleGrid.filter((_, index) => index % 5 === 0), ...SETTINGS_PROBES],
			);
			assertCopiedAutolinks(result.divergences);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	it("reports a full reference with a fix to the inline form", () => {
		const source = "See [the docs][d].\n\n[d]: https://d.example/a(b)\n";
		const findings = run(source, { full: false });
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.deepStrictEqual(finding?.context, Option.some("[the docs][d]"));
		assert.deepStrictEqual(finding?.range, Option.some([5, 13] as const));
		assert.strictEqual(
			MarkdownEdit.applyAll(
				source,
				findings.flatMap((each) => Option.toArray(each.edit)),
			),
			"See [the docs](https://d.example/a\\(b\\)).\n\n[d]: https://d.example/a(b)\n",
		);
	});

	// A definition's whitespace may be tabs (CommonMark §4.7), as markdownlint reads it.
	it(
		"agrees with markdownlint over definitions whose whitespace is a tab",
		() => {
			const result = differential(MD054, {
				config: { full: false, shortcut: false, inline: false, url_inline: false },
				extra: tabbedDefinitions,
			});
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_TABBED);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// After a math block or a directive line micromark starts a paragraph the kit's parser does not: its references,
	// and the definitions opening it, read as markdownlint reads them.
	it(
		"agrees with markdownlint after a line micromark ends a paragraph at",
		() => {
			const result = differential(MD054, {
				config: { full: false, collapsed: false, shortcut: false },
				extra: paragraphBreakShapes,
			});
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_BREAKS);
		},
		DIFFERENTIAL_TIMEOUT,
	);
});

// markdownlint's MD054 findings over the corpus (LF and CRLF) and the grids, where the corpus's own comments
// disallow styles.
const ORACLE_FINDINGS_DEFAULT = 482;

// markdownlint's MD054 findings over the corpus (LF and CRLF) and the tabbed definitions.
const ORACLE_FINDINGS_TABBED = 1606;

// markdownlint's MD054 findings over the corpus (LF and CRLF) and the shapes after a paragraph break.
const ORACLE_FINDINGS_BREAKS = 832;
