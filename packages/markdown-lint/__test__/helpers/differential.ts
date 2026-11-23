// The differential harness every built-in rule port is proven by: run one kit
// rule and the markdownlint rule of the same name alone, over every upstream
// fixture (as written, LF, and converted to CRLF) plus any extra inputs, and
// report every place the two disagree. Strict by construction: findings are
// compared as an ordered list, so a missing or an extra finding diverges, and
// every field markdownlint reports is compared, then the applied fixes.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import type { LintDiagnostic } from "../../src/LintDiagnostic.js";
import type { LintRule } from "../../src/LintRule.js";
import { MarkdownLint } from "../../src/MarkdownLint.js";
import type { OracleFinding } from "./markdownlint-oracle.js";
import { oracleApplyFixes, oracleLineEnding, oracleLint } from "./markdownlint-oracle.js";

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

// markdownlint's `normalizeFixInfo`, and the line ending its `applyFix` writes
// an inserted line break as: two fixes markdownlint applies identically
// compare equal, whichever optional fields they spell out.
const normalizeFix = (fix: FixInfoLike, lineNumber: number, lineEnding: string): ComparableFinding["fixInfo"] => ({
	lineNumber: fix.lineNumber || lineNumber,
	editColumn: fix.editColumn || 1,
	deleteCount: fix.deleteCount || 0,
	insertText: (fix.insertText || "").replace(/\r\n?|\n/g, lineEnding),
});

const fromOracle = (finding: OracleFinding, lineEnding: string): ComparableFinding => ({
	lineNumber: finding.lineNumber,
	ruleNames: [...finding.ruleNames],
	detail: finding.errorDetail,
	context: finding.errorContext,
	range: finding.errorRange === null ? null : [...finding.errorRange],
	fixInfo:
		finding.fixInfo === null ? null : normalizeFix(finding.fixInfo as FixInfoLike, finding.lineNumber, lineEnding),
	severity: finding.severity,
});

const fromKit = (finding: LintDiagnostic, lineEnding: string): ComparableFinding => ({
	lineNumber: finding.lineNumber,
	ruleNames: [...finding.ruleNames],
	detail: asResultText(finding.detail),
	context: asResultText(finding.context),
	range: Option.match(finding.range, { onNone: () => null, onSome: (range) => [...range] }),
	fixInfo: Option.match(finding.fixInfo, {
		onNone: () => null,
		onSome: (fix) => normalizeFix(fix, finding.lineNumber, lineEnding),
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
	const lineEnding = oracleLineEnding(input.source);
	let oracleFindings: ReadonlyArray<OracleFinding>;
	try {
		oracleFindings = oracleLint(input.source, config).filter((finding) => finding.ruleNames[0] === rule.name);
	} catch (error) {
		// markdownlint itself can fail on an input (an upstream bug); that input compares nothing.
		return {
			oracleFindings: 0,
			reason: `markdownlint throws: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
	// markdownlint sorts by rule name, then line, stably; one rule leaves line order.
	const kitFindings = [...MarkdownLint.lint(input.source, [rule], { config })].sort(
		(a, b) => a.lineNumber - b.lineNumber,
	);
	const difference = firstDifference(
		kitFindings.map((finding) => fromKit(finding, lineEnding)),
		oracleFindings.map((finding) => fromOracle(finding, lineEnding)),
	);
	if (difference !== undefined) return found(difference);
	const expected = oracleApplyFixes(input.source, oracleFindings);
	let actual: string;
	try {
		actual = MarkdownEdit.applyAll(
			input.source,
			kitFindings.flatMap((finding) => Option.toArray(finding.edit)),
		);
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
