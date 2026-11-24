// MD052 `reference-links-images`, held to markdownlint's own MD052 over the
// upstream fixture corpus (LF and CRLF), the reference grid (see
// `referenceGrid`) and label shapes, and over inputs its settings change.
// markdownlint reads its reference link and image data, undefined references
// among them, as its micromark-parse shim records them.

import { assert, describe, it } from "@effect/vitest";
import { Option } from "effect";
import { MD052 } from "../../src/rules/MD052.js";
import {
	DIFFERENTIAL_TIMEOUT,
	SETTINGS_PROBES,
	differential,
	runRule,
	settingsDifferential,
} from "../helpers/differential.js";
import { oracleLint } from "../helpers/markdownlint-oracle.js";
import { labelShapes, referenceGrid } from "../helpers/reference-grid.js";

const extra = [...referenceGrid, ...labelShapes];

const run = runRule(MD052);

describe("MD052 reference-links-images", () => {
	it(
		"agrees with markdownlint with default settings over the corpus, the reference grid and label shapes",
		() => {
			const result = differential(MD052, { extra });
			assert.deepStrictEqual(result.divergences, []);
			assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Each setting changes markdownlint's findings over the same inputs; the defaults spelled out change nothing.
	for (const [settings, changes] of [
		[{ shortcut_syntax: true }, true],
		[{ shortcut_syntax: true, ignored_labels: ["r", "^n"] }, true],
		[{ ignored_labels: ["t", "r"] }, true],
		[{ shortcut_syntax: true, ignored_labels: [] }, true],
		[{ shortcut_syntax: false, ignored_labels: ["x"] }, false],
	] as const) {
		it(
			`agrees with markdownlint under ${JSON.stringify(settings)}`,
			() => {
				const result = differential(MD052, { config: settings, extra });
				assert.deepStrictEqual(result.divergences, []);
				if (changes) assert.notStrictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
				else assert.strictEqual(result.oracleFindings, ORACLE_FINDINGS_DEFAULT);
			},
			DIFFERENTIAL_TIMEOUT,
		);
	}

	// markdownlint reads `shortcut_syntax || false` and `new Set(ignored_labels || ["x"])`: a string is the set of
	// its characters.
	it(
		"reads a non-canonical setting as markdownlint does",
		() => {
			const result = settingsDifferential(
				MD052,
				[
					{ shortcut_syntax: 1 },
					{ shortcut_syntax: "yes" },
					{ shortcut_syntax: 0 },
					{ shortcut_syntax: true, ignored_labels: "rt" },
					{ shortcut_syntax: true, ignored_labels: "" },
					{ shortcut_syntax: true, ignored_labels: null },
					{ shortcut_syntax: true, ignored_labels: [1, null, "r"] },
				],
				[...labelShapes, ...SETTINGS_PROBES],
			);
			assert.deepStrictEqual(result.divergences, []);
			assert.isAbove(result.oracleFindings, 0);
		},
		DIFFERENTIAL_TIMEOUT,
	);

	// Where markdownlint throws (`new Set` of a number, `true` or a plain object), the kit reads the default.
	it("reads an ignored_labels markdownlint throws on as the default", () => {
		const source = "[a][x] [b][c]\n";
		const contexts = (settings: Record<string, unknown>) =>
			run(source, { shortcut_syntax: true, ...settings }).map((each) => each.context);
		const defaults = contexts({});
		assert.lengthOf(defaults, 1);
		for (const ignored_labels of [5, true, { r: 1 }]) {
			assert.deepStrictEqual(contexts({ ignored_labels }), defaults, JSON.stringify(ignored_labels));
		}
	});

	// A named divergence, not of the port: markdownlint parses with micromark only when an enabled rule's `parser` asks
	// for it, and its MD052 (`parser: "none"`) reads its reference data from those tokens. Enabled with no micromark
	// rule beside it (its default config enables many), it reads none and reports nothing; the kit reports.
	it("reports where markdownlint, with no micromark rule enabled, reads no reference data", () => {
		const source = "[a][b]\n";
		const config = { default: false, MD052: true };
		assert.lengthOf(oracleLint(source, config), 0);
		assert.lengthOf(
			oracleLint(source, config, { micromark: true }).filter((finding) => finding.ruleNames[0] === "MD052"),
			1,
		);
		assert.lengthOf(run(source), 1);
	});

	it("reports a reference to an undefined label with its source as the context and range", () => {
		const findings = run("See [the docs][docs] here.\n");
		assert.lengthOf(findings, 1);
		const [finding] = findings;
		assert.deepStrictEqual(finding?.detail, Option.some('Missing link or image reference definition: "docs"'));
		assert.deepStrictEqual(finding?.context, Option.some("[the docs][docs]"));
		assert.deepStrictEqual(finding?.range, Option.some([5, 16] as const));
		assert.deepStrictEqual(finding?.fixInfo, Option.none());
	});
});

// markdownlint's MD052 findings over the corpus (LF and CRLF), the grid and the label shapes.
const ORACLE_FINDINGS_DEFAULT = 200;
