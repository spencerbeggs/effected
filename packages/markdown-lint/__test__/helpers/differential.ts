// The differential harness every built-in rule port is proven by: run one kit
// rule and the markdownlint rule of the same name alone, over every upstream
// fixture (as written, LF, and converted to CRLF) plus any extra inputs, and
// report every place the two disagree. Strict by construction: findings are
// compared as an ordered list, so a missing or an extra finding diverges, and
// every field markdownlint reports is compared, then the applied fixes.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Option } from "effect";
import { applyFixesCounted } from "../../src/internal/apply-fixes.js";
import type { LintDiagnostic } from "../../src/LintDiagnostic.js";
import type { LintRule } from "../../src/LintRule.js";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import type { OracleFinding } from "./markdownlint-oracle.js";
import { oracleApplyFixes, oracleLint } from "./markdownlint-oracle.js";

/**
 * The timeout of a test that runs a rule over the whole fixture corpus: a differential pass lints the corpus twice
 * in two engines, and under a parallel run it outlasts the default.
 */
export const DIFFERENTIAL_TIMEOUT = 60_000;

/** Lint `source` with `rule` alone, under `settings` (`true`, its defaults, when absent). */
export const runRule =
	(rule: LintRule) =>
	(source: string, settings?: Record<string, unknown>): ReadonlyArray<LintDiagnostic> =>
		MarkdownLint.lint(source, [rule], { config: { default: false, [rule.name]: settings ?? true } });

/** One place the kit rule and markdownlint disagree. */
export interface Divergence {
	readonly fixture: string;
	readonly reason: string;
}

/** A named input to compare on. */
export interface DifferentialInput {
	readonly name: string;
	readonly source: string;
}

const fixturesDir = join(import.meta.dirname, "..", "fixtures", "markdownlint");

/** The upstream fixture corpus: every `.md` file but the README, by name. */
export const corpus: ReadonlyArray<DifferentialInput> = readdirSync(fixturesDir)
	.filter((file) => file.endsWith(".md") && file !== "README.md")
	.sort()
	.map((file) => ({ name: file, source: readFileSync(join(fixturesDir, file), "utf8") }));

// markdownlint's result-level normalization of `detail` and `context`, which it
// applies to every rule's report: line breaks become spaces, empty is absent.
const asResultText = (text: Option.Option<string>): string | null =>
	Option.match(text, { onNone: () => null, onSome: (value) => value.replace(/\r\n?|\n/g, " ") || null });

interface ComparableFinding {
	readonly lineNumber: number;
	readonly ruleNames: ReadonlyArray<string>;
	readonly detail: string | null;
	readonly context: string | null;
	readonly range: ReadonlyArray<number> | null;
	readonly fixInfo: {
		readonly lineNumber: number;
		readonly editColumn: number;
		readonly deleteCount: number;
		readonly insertText: string;
	} | null;
	readonly severity: string;
}

interface FixInfoLike {
	readonly lineNumber?: number;
	readonly editColumn?: number;
	readonly deleteCount?: number;
	readonly insertText?: string;
}

// markdownlint's `normalizeFixInfo`: two fixes markdownlint applies identically compare equal, whichever optional
// fields they spell out. `insertText` is compared raw, so a line break must be `\n` on both sides, as markdownlint's
// `applyFix` expects it.
const normalizeFix = (fix: FixInfoLike, lineNumber: number): ComparableFinding["fixInfo"] => ({
	lineNumber: fix.lineNumber || lineNumber,
	editColumn: fix.editColumn || 1,
	deleteCount: fix.deleteCount || 0,
	insertText: fix.insertText || "",
});

const fromOracle = (finding: OracleFinding): ComparableFinding => ({
	lineNumber: finding.lineNumber,
	ruleNames: [...finding.ruleNames],
	detail: finding.errorDetail,
	context: finding.errorContext,
	range: finding.errorRange === null ? null : [...finding.errorRange],
	fixInfo: finding.fixInfo === null ? null : normalizeFix(finding.fixInfo as FixInfoLike, finding.lineNumber),
	severity: finding.severity,
});

const fromKit = (finding: LintDiagnostic): ComparableFinding => ({
	lineNumber: finding.lineNumber,
	ruleNames: [...finding.ruleNames],
	detail: asResultText(finding.detail),
	context: asResultText(finding.context),
	range: Option.match(finding.range, { onNone: () => null, onSome: (range) => [...range] }),
	fixInfo: Option.match(finding.fixInfo, {
		onNone: () => null,
		onSome: (fix) => normalizeFix(fix, finding.lineNumber),
	}),
	severity: finding.severity,
});

const fields = ["lineNumber", "ruleNames", "detail", "context", "range", "fixInfo", "severity"] as const;

const firstDifference = (
	kit: ReadonlyArray<ComparableFinding>,
	oracle: ReadonlyArray<ComparableFinding>,
): string | undefined => {
	for (let index = 0; index < Math.max(kit.length, oracle.length); index++) {
		const a = kit[index];
		const b = oracle[index];
		if (a === undefined) return `missing finding ${index + 1}: markdownlint ${JSON.stringify(b)}`;
		if (b === undefined) return `extra finding ${index + 1}: kit ${JSON.stringify(a)}`;
		for (const field of fields) {
			if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) {
				return `finding ${index + 1} (line ${b.lineNumber}) ${field}: kit ${JSON.stringify(a[field])}, markdownlint ${JSON.stringify(b[field])}`;
			}
		}
	}
	return undefined;
};

interface Comparison {
	readonly oracleFindings: number;
	readonly reason: string | undefined;
}

const compareOne = (rule: LintRule, config: Record<string, unknown>, input: DifferentialInput): Comparison => {
	const found = (reason: string | undefined): Comparison => ({ oracleFindings: oracleFindings.length, reason });
	let oracleFindings: ReadonlyArray<OracleFinding>;
	try {
		oracleFindings = oracleLint(input.source, config).filter((finding) => finding.ruleNames[0] === rule.name);
	} catch (error) {
		// markdownlint itself can fail on an input (an upstream bug). Nothing compares against it, but the kit
		// side still runs, and what it did goes in the reason, so a pin can say what the kit reports there.
		const message = (thrown: unknown) => (thrown instanceof Error ? thrown.message : String(thrown));
		let kit: string;
		try {
			kit = `kit: ${MarkdownLint.lint(input.source, [rule], { config }).length} findings`;
		} catch (kitError) {
			kit = `kit throws: ${message(kitError)}`;
		}
		return { oracleFindings: 0, reason: `markdownlint throws: ${message(error)}; ${kit}` };
	}
	// markdownlint sorts by rule name, then line, stably; one rule leaves line order.
	const kitFindings = [...MarkdownLint.lint(input.source, [rule], { config })].sort(
		(a, b) => a.lineNumber - b.lineNumber,
	);
	const difference = firstDifference(kitFindings.map(fromKit), oracleFindings.map(fromOracle));
	if (difference !== undefined) return found(difference);
	const expected = oracleApplyFixes(input.source, oracleFindings);
	let actual: string;
	try {
		const applied = applyFixesCounted(input.source, kitFindings);
		// The public applyFixes forgives an edit that reaches into one already applied; markdownlint's policy
		// never gets there, so any such skip is a kit edit whose span disagrees with its fixInfo.
		if (applied.skipped > 0) return found(`kit edits do not apply: ${applied.skipped} skipped by the splice`);
		actual = applied.text;
	} catch (error) {
		return found(`kit edits do not apply: ${error instanceof Error ? error.message : String(error)}`);
	}
	return found(
		actual === expected
			? undefined
			: `applied fixes differ: kit ${JSON.stringify(actual)}, markdownlint ${JSON.stringify(expected)}`,
	);
};

/**
 * Run `rule` alone over every corpus file, as written and converted to CRLF,
 * plus `extra` inputs, in both engines, with only `rule` enabled by the base
 * config (a fixture's own inline comments still apply in both). Each input
 * whose findings or applied fixes differ is one divergence, naming the first
 * difference. `compared` counts the inputs and `oracleFindings` the findings
 * markdownlint reported over them all, so a rule's test can assert the
 * comparison was not vacuous.
 */
export const differential = (
	rule: LintRule,
	options?: {
		readonly config?: Record<string, unknown>;
		readonly extra?: ReadonlyArray<DifferentialInput>;
	},
): {
	readonly compared: number;
	readonly oracleFindings: number;
	readonly divergences: ReadonlyArray<Divergence>;
} => {
	const config = { default: false, [rule.name]: options?.config ?? true };
	const inputs: Array<DifferentialInput> = [];
	for (const entry of corpus) {
		inputs.push(entry, { name: `${entry.name} (CRLF)`, source: entry.source.replace(/\r?\n/g, "\r\n") });
	}
	inputs.push(...(options?.extra ?? []));
	const divergences: Array<Divergence> = [];
	let oracleFindings = 0;
	for (const input of inputs) {
		const comparison = compareOne(rule, config, input);
		oracleFindings += comparison.oracleFindings;
		if (comparison.reason !== undefined) divergences.push({ fixture: input.name, reason: comparison.reason });
	}
	return { compared: inputs.length, oracleFindings, divergences };
};

/**
 * Documents for comparing settings on, beside a rule's own extra inputs: one of each line shape the ported rules'
 * settings read (trailing spaces, tabs in text and code, blank runs, long lines, headings of both styles and
 * levels, punctuation, duplicates, lists, fences with and without a language, HTML in text and a table), and two
 * front matter blocks for `front_matter_title`.
 */
export const SETTINGS_PROBES: ReadonlyArray<DifferentialInput> = [
	{
		name: "settings probe",
		source: [
			"# Title",
			"",
			"text with trailing   ",
			"",
			"\tTabbed line",
			"",
			"",
			"",
			"three blanks above",
			"",
			`${"a".repeat(30)} ${"b".repeat(30)} ${"c".repeat(30)} tail`,
			"",
			"## Two.",
			"no blank",
			"# Second h1",
			"",
			"Setext two",
			"----------",
			"",
			"## Two.",
			"",
			"### Closed ###",
			"",
			"```",
			"\tcode tab",
			"```",
			"",
			"```js",
			"\tconst a = 1;",
			"```",
			"- a",
			"",
			"",
			"  ",
			"- b",
			"  ```",
			"  x",
			"  ```",
			"",
			"* c",
			"",
			"`code` \tx and <b>bold</b> <i>it</i>",
			"",
			"| a | b |",
			"|---|:-|",
			"| <br> |x|",
			"",
		].join("\n"),
	},
	{ name: "settings probe, title front matter", source: "---\ntitle: T\n---\n# H\n\n### Deep\n\n# Again\n" },
	{ name: "settings probe, front matter with 5", source: "---\nlayout: 5\n---\n\ntext first\n\n## H\n\n# One\n" },
];

/** One settings case on which the kit and markdownlint disagree. */
export interface SettingsDivergence extends Divergence {
	readonly settings: string;
}

/**
 * Compare `rule` and markdownlint under each of `cases` over `inputs` alone (no corpus): the check that a
 * non-canonical setting means to the kit what markdownlint's coercion makes of it. `oracleFindings` sums
 * markdownlint's findings over every case, so a test can assert the comparison was not vacuous.
 */
export const settingsDifferential = (
	rule: LintRule,
	cases: ReadonlyArray<Record<string, unknown>>,
	inputs: ReadonlyArray<DifferentialInput>,
): { readonly oracleFindings: number; readonly divergences: ReadonlyArray<SettingsDivergence> } => {
	const divergences: Array<SettingsDivergence> = [];
	let oracleFindings = 0;
	for (const settings of cases) {
		const config = { default: false, [rule.name]: settings };
		for (const input of inputs) {
			const comparison = compareOne(rule, config, input);
			oracleFindings += comparison.oracleFindings;
			if (comparison.reason !== undefined)
				divergences.push({ settings: JSON.stringify(settings), fixture: input.name, reason: comparison.reason });
		}
	}
	return { oracleFindings, divergences };
};

/**
 * The settings cases and inputs on which the text the kit's fixes leave differs from the text markdownlint's
 * leave: the check behind a divergence recorded as a `fixInfo` difference alone.
 */
export const settingsAppliedTextDivergences = (
	rule: LintRule,
	cases: ReadonlyArray<Record<string, unknown>>,
	inputs: ReadonlyArray<DifferentialInput>,
): ReadonlyArray<SettingsDivergence> => {
	const divergences: Array<SettingsDivergence> = [];
	for (const settings of cases) {
		const config = { default: false, [rule.name]: settings };
		for (const input of inputs) {
			const oracle = oracleLint(input.source, config).filter((finding) => finding.ruleNames[0] === rule.name);
			const kit = MarkdownLint.lint(input.source, [rule], { config });
			if (MarkdownLint.applyFixes(input.source, kit) !== oracleApplyFixes(input.source, oracle))
				divergences.push({ settings: JSON.stringify(settings), fixture: input.name, reason: "applied text differs" });
		}
	}
	return divergences;
};

/**
 * Run `rules` together, each under its defaults, over every corpus file as written, converted to CRLF and
 * converted to bare CR, plus `extra` inputs, in both engines, and compare the text each engine's `applyFixes`
 * leaves. Each input on which the texts differ is one divergence. The per-rule harness applies one rule's fixes
 * at a time; this is the check on fixes from several rules meeting. Findings are not compared here, so a recorded
 * finding divergence shows up as a text difference and is pinned by the caller. An edit the kit's splice skips is a
 * divergence too, as in the per-rule harness. `oracleFixes` counts the findings with a `fixInfo` markdownlint
 * reported over every input, and `meeting` the inputs on which fixes from two or more of `rules` land on one line,
 * so a test can assert the comparison was not vacuous and that the fixes it exists for do meet. `order` rearranges
 * the kit's findings before they are applied (the identity when absent), to check that the result does not depend
 * on the order they arrive in.
 */
export const fixesDifferential = (
	rules: ReadonlyArray<LintRule>,
	options?: {
		readonly extra?: ReadonlyArray<DifferentialInput>;
		readonly inputs?: ReadonlyArray<DifferentialInput>;
		readonly order?: (
			findings: ReadonlyArray<LintDiagnostic>,
			input: DifferentialInput,
		) => ReadonlyArray<LintDiagnostic>;
	},
): {
	readonly compared: number;
	readonly oracleFixes: number;
	readonly meeting: number;
	readonly divergences: ReadonlyArray<Divergence>;
} => {
	const names = new Set(rules.map((rule) => rule.name));
	const config = { default: false, ...Object.fromEntries([...names].map((name) => [name, true])) };
	const inputs: Array<DifferentialInput> = [];
	for (const entry of options?.inputs ?? corpus) {
		inputs.push(
			entry,
			{ name: `${entry.name} (CRLF)`, source: entry.source.replace(/\r?\n/g, "\r\n") },
			{ name: `${entry.name} (CR)`, source: entry.source.replace(/\r?\n/g, "\r") },
		);
	}
	inputs.push(...(options?.extra ?? []));
	const divergences: Array<Divergence> = [];
	let oracleFixes = 0;
	let meeting = 0;
	for (const input of inputs) {
		let oracle: ReadonlyArray<OracleFinding>;
		try {
			// A fixture's own inline config can enable a rule outside `rules`; only theirs are compared.
			oracle = oracleLint(input.source, config).filter((finding) => names.has(finding.ruleNames[0] ?? ""));
		} catch (error) {
			divergences.push({
				fixture: input.name,
				reason: `markdownlint throws: ${error instanceof Error ? error.message : String(error)}`,
			});
			continue;
		}
		const fixLines = new Map<number, Set<string>>();
		for (const finding of oracle) {
			const fix = finding.fixInfo as FixInfoLike | null | undefined;
			if (fix === null || fix === undefined) continue;
			oracleFixes++;
			const line = fix.lineNumber || finding.lineNumber;
			const names = fixLines.get(line) ?? new Set<string>();
			names.add(finding.ruleNames[0] ?? "");
			fixLines.set(line, names);
		}
		if ([...fixLines.values()].some((names) => names.size > 1)) meeting++;
		const expected = oracleApplyFixes(input.source, oracle);
		const kit = MarkdownLint.lint(input.source, rules, { config });
		const applied = applyFixesCounted(input.source, options?.order?.(kit, input) ?? kit);
		if (applied.skipped > 0) {
			divergences.push({
				fixture: input.name,
				reason: `kit edits do not apply: ${applied.skipped} skipped by the splice`,
			});
			continue;
		}
		const actual = applied.text;
		if (actual !== expected)
			divergences.push({
				fixture: input.name,
				reason: `applied fixes differ: kit ${JSON.stringify(actual)}, markdownlint ${JSON.stringify(expected)}`,
			});
	}
	return { compared: inputs.length, oracleFixes, meeting, divergences };
};
