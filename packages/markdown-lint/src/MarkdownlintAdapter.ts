// The markdownlint host: turn a LintRule into an object markdownlint (and
// markdownlint-cli2, and the VS Code extension) accepts as a custom rule. No
// markdownlint import — the contract is matched structurally by the local
// types below, a subset of markdownlint's own declarations, so this package
// carries no dependency on it and a consumer brings their own copy.
//
// Contract source: markdownlint's `lib/markdownlint.d.mts` (`Rule`,
// `RuleParams`, `RuleOnError`, `RuleOnErrorInfo`, `RuleOnErrorFixInfo`),
// checked against markdownlint 0.42, the copy markdownlint-cli2 0.24 —
// this repository's own markdown linter — runs.

import type { MarkdownDialect, MarkdownDocument, MarkdownParseError } from "@effected/markdown";
import { Option, Result } from "effect";
import { parseDocument, parseSettings, refusalDiagnostic, runRule } from "./internal/host.js";
import type { LintDiagnostic } from "./LintDiagnostic.js";
import type { LintRule } from "./LintRule.js";

/**
 * The part of markdownlint's `RuleParams` the adapter reads.
 *
 * @remarks
 * markdownlint's own params object satisfies it; so does a hand-built
 * `{ name, lines, frontMatterLines }` in a test. `lines` is the content after
 * markdownlint removed the front matter, `\n`-split with HTML comment bodies
 * masked; `frontMatterLines` is the removed block, possibly empty.
 *
 * @public
 */
export interface MarkdownlintRuleParams {
	/** The file or string name. */
	readonly name: string;
	/** The content lines, front matter removed. */
	readonly lines: ReadonlyArray<string>;
	/** The front matter lines, fences included; empty when there is none. */
	readonly frontMatterLines: ReadonlyArray<string>;
}

/**
 * markdownlint's `RuleOnErrorFixInfo`: a one-line fix, 1-based.
 *
 * @public
 */
export interface MarkdownlintFixInfo {
	/** The line of the fix, when it is not the error's line. */
	lineNumber?: number;
	/** The column the edit starts at. */
	editColumn?: number;
	/** How many characters to delete; `-1` deletes the line. */
	deleteCount?: number;
	/** The text to insert after deleting. */
	insertText?: string;
}

/**
 * markdownlint's `RuleOnErrorInfo`: what one `onError` call reports.
 *
 * @public
 */
export interface MarkdownlintErrorInfo {
	/** The 1-based line, in `lines` — or in `frontMatterLines` when `frontMatter` is set. */
	lineNumber: number;
	/** True when `lineNumber` counts `frontMatterLines`. */
	frontMatter?: boolean;
	/** What is wrong. */
	detail?: string;
	/** The offending text. */
	context?: string;
	/** The 1-based column and length on the line. */
	range?: Array<number>;
	/** The fix. */
	fixInfo?: MarkdownlintFixInfo;
}

/**
 * markdownlint's `RuleOnError` callback.
 *
 * @public
 */
export type MarkdownlintOnError = (info: MarkdownlintErrorInfo) => void;

/**
 * An object satisfying markdownlint's custom-rule contract (`Rule`): pass it
 * in `customRules`, to `markdownlint`'s `lint` or to markdownlint-cli2.
 *
 * @remarks
 * Mutable arrays and the `"none"` parser on purpose: the type must be
 * assignable to markdownlint's own `Rule`, whose `names` and `tags` are
 * `string[]`, and the adapter needs no markdownlint parser — it parses with
 * the kit.
 *
 * @public
 */
export interface MarkdownlintRule {
	/** The rule's names. */
	names: Array<string>;
	/** The rule's description. */
	description: string;
	/** A link to the rule's documentation. */
	information?: URL;
	/** The rule's tags. */
	tags: Array<string>;
	/** The markdownlint parser the rule needs: none. */
	parser: "none";
	/** The rule body markdownlint calls. */
	function: (params: MarkdownlintRuleParams, onError: MarkdownlintOnError) => void;
}

/**
 * Options for {@link MarkdownlintAdapter.rule}.
 *
 * @public
 */
export interface MarkdownlintAdapterOptions {
	/** The dialect to parse with; defaults to `"gfm"`. */
	readonly dialect?: MarkdownDialect;
	/**
	 * Capture a leading frontmatter block with the kit's fence grammar;
	 * defaults to `true`, so a rule sees the same tree under markdownlint as
	 * under `MarkdownLint.lint`.
	 */
	readonly frontmatter?: boolean;
}

interface CachedParse {
	readonly frontMatterLines: ReadonlyArray<string>;
	readonly key: string;
	readonly result: Result.Result<MarkdownDocument, MarkdownParseError>;
}

// One parse per linted file, shared by every adapted rule markdownlint runs
// over it: markdownlint hands each rule a fresh params object but the same
// frozen `lines` array, so the array's identity is the file's identity.
const parses = new WeakMap<ReadonlyArray<string>, Array<CachedParse>>();

const sourceOf = (params: MarkdownlintRuleParams): string =>
	params.frontMatterLines.length === 0
		? params.lines.join("\n")
		: `${params.frontMatterLines.join("\n")}\n${params.lines.join("\n")}`;

const documentFor = (
	params: MarkdownlintRuleParams,
	options: MarkdownlintAdapterOptions | undefined,
): Result.Result<MarkdownDocument, MarkdownParseError> => {
	const settings = parseSettings(options);
	const key = `${settings.dialect}|${settings.frontmatter}`;
	let entries = parses.get(params.lines);
	if (entries === undefined) {
		entries = [];
		parses.set(params.lines, entries);
	}
	const hit = entries.find((entry) => entry.key === key && entry.frontMatterLines === params.frontMatterLines);
	if (hit !== undefined) return hit.result;
	const result = parseDocument(sourceOf(params), settings);
	entries.push({ frontMatterLines: params.frontMatterLines, key, result });
	return result;
};

/**
 * Translate one finding into markdownlint's numbering and forward it.
 * Lines inside markdownlint's front matter keep their number and set
 * `frontMatter`; lines after it count from the first content line. A fix on
 * the other side of that boundary from its finding cannot be expressed and is
 * dropped from `fixInfo` (the finding still reports).
 */
const forward = (diagnostic: LintDiagnostic, frontMatterLineCount: number, onError: MarkdownlintOnError): void => {
	const inFrontMatter = diagnostic.lineNumber <= frontMatterLineCount;
	const relative = (line: number): number => (inFrontMatter ? line : line - frontMatterLineCount);
	const fixInfo = Option.flatMap(diagnostic.fixInfo, (fix): Option.Option<MarkdownlintFixInfo> => {
		if (fix.lineNumber !== undefined && fix.lineNumber <= frontMatterLineCount !== inFrontMatter) {
			return Option.none();
		}
		return Option.some({
			...(fix.lineNumber !== undefined ? { lineNumber: relative(fix.lineNumber) } : {}),
			...(fix.editColumn !== undefined ? { editColumn: fix.editColumn } : {}),
			...(fix.deleteCount !== undefined ? { deleteCount: fix.deleteCount } : {}),
			...(fix.insertText !== undefined ? { insertText: fix.insertText } : {}),
		});
	});
	onError({
		lineNumber: relative(diagnostic.lineNumber),
		...(inFrontMatter ? { frontMatter: true } : {}),
		...Option.match(diagnostic.detail, { onNone: () => ({}), onSome: (detail) => ({ detail }) }),
		...Option.match(diagnostic.context, { onNone: () => ({}), onSome: (context) => ({ context }) }),
		...Option.match(diagnostic.range, { onNone: () => ({}), onSome: (range) => ({ range: [range[0], range[1]] }) }),
		...Option.match(fixInfo, { onNone: () => ({}), onSome: (fix) => ({ fixInfo: fix }) }),
	});
};

/**
 * Run {@link LintRule}s inside markdownlint. Not instantiable.
 *
 * @example
 * ```ts
 * // .markdownlint-cli2.mjs
 * import { LintRule, MarkdownlintAdapter } from "@effected/markdown-lint";
 *
 * const noH1 = LintRule.make({
 *   names: ["no-h1"],
 *   description: "No level-1 headings",
 *   tags: ["headings"],
 *   check: (context, report) => {
 *     for (const node of context.root.children) {
 *       if (node.type === "heading" && node.depth === 1) report(context.diagnostic({ at: node, detail: "Use ##" }));
 *     }
 *   },
 * });
 *
 * export default { customRules: MarkdownlintAdapter.rules([noH1]) };
 * ```
 *
 * @public
 */
export class MarkdownlintAdapter {
	private constructor() {}

	/**
	 * Adapt one rule to markdownlint's custom-rule contract.
	 *
	 * @remarks
	 * The returned rule's `function` rebuilds the whole file from
	 * `params.frontMatterLines` and `params.lines`, parses it with the kit —
	 * once per file, however many adapted rules run, the parse is shared —
	 * runs the rule's check exactly as `MarkdownLint.lint` would, and forwards
	 * each finding with `onError`. Its findings are therefore the
	 * programmatic host's, translated: a line after the front matter counts
	 * from the first content line, as markdownlint requires; a line inside it
	 * keeps its number and sets `frontMatter: true`. markdownlint adds the
	 * front matter back when it reports, so its `lineNumber`s equal the
	 * programmatic host's.
	 *
	 * A document nested past the kit's hardening cap is reported, not
	 * thrown: one finding at the refusal, as `MarkdownLint.lint` reports it.
	 * A rule's own `throw` propagates to markdownlint, which reports or
	 * rethrows it per its `handleRuleFailures` option.
	 *
	 * Each call mints a fresh rule object; bind the result to a `const` when
	 * passing the same rule to several configurations.
	 *
	 * @param rule - The rule to adapt.
	 * @param options - The dialect and frontmatter capture.
	 * @returns A markdownlint custom rule.
	 */
	static rule(rule: LintRule, options?: MarkdownlintAdapterOptions): MarkdownlintRule {
		return {
			names: [...rule.names],
			description: rule.description,
			...(rule.information !== undefined ? { information: new URL(rule.information) } : {}),
			tags: [...rule.tags],
			parser: "none",
			function: (params, onError) => {
				const parsed = documentFor(params, options);
				const findings = Result.isFailure(parsed)
					? [refusalDiagnostic(parsed.failure, rule)]
					: runRule(parsed.success, rule, params.name);
				for (const finding of findings) forward(finding, params.frontMatterLines.length, onError);
			},
		};
	}

	/**
	 * Adapt every rule, in order — the array markdownlint-cli2's
	 * `customRules` takes.
	 *
	 * @param rules - The rules to adapt.
	 * @param options - The dialect and frontmatter capture, for every rule.
	 * @returns The markdownlint custom rules.
	 */
	static rules(rules: ReadonlyArray<LintRule>, options?: MarkdownlintAdapterOptions): Array<MarkdownlintRule> {
		return rules.map((rule) => MarkdownlintAdapter.rule(rule, options));
	}
}
