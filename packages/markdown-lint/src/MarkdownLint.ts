// The programmatic host: lint a markdown string (or an already-parsed
// document) with a list of rules, purely and synchronously, with no
// markdownlint and no unified anywhere in the graph.

import type { MarkdownDialect, MarkdownDocument } from "@effected/markdown";
import { MarkdownEdit } from "@effected/markdown";
import { Effect, Option, Result } from "effect";
import { lintReading, maskContent, parseSettings, readDocument, readSource, splitLines } from "./internal/host.js";
import { frontMatterLineCount } from "./internal/reading.js";
import type { LintConfigRecord } from "./LintConfig.js";
import { LintDiagnostic } from "./LintDiagnostic.js";
import type { LintRule } from "./LintRule.js";

/** `finding` with its kit edit moved `shift` code units right, to address the BOM-prefixed source. */
const shiftEdit = (finding: LintDiagnostic, shift: number): LintDiagnostic =>
	Option.isNone(finding.edit)
		? finding
		: LintDiagnostic.make({
				...finding,
				edit: Option.some(
					MarkdownEdit.make({
						offset: finding.edit.value.offset + shift,
						length: finding.edit.value.length,
						content: finding.edit.value.content,
					}),
				),
			});

/**
 * Options for {@link MarkdownLint.lint}.
 *
 * @public
 */
export interface MarkdownLintOptions {
	/** The name rules see as `LintContext.name`; defaults to `"<input>"`. */
	readonly name?: string;
	/** The dialect to parse with; defaults to `"gfm"`. */
	readonly dialect?: MarkdownDialect;
	/**
	 * Read markdownlint's front matter block as front matter rather than
	 * parsing its lines as markdown; defaults to `true`, as markdownlint
	 * always strips front matter before its rules run. Off, the rules see no
	 * `frontmatter` and the fences parse as markdown.
	 */
	readonly frontmatter?: boolean;
	/**
	 * The markdownlint configuration object: which rules run, at what
	 * severity, with what settings; defaults to `{ default: true }`.
	 */
	readonly config?: LintConfigRecord;
	/**
	 * Ignore markdownlint's inline comments (`<!-- markdownlint-disable -->`
	 * and friends), as markdownlint's `noInlineConfig` does; defaults to
	 * `false`.
	 */
	readonly noInlineConfig?: boolean;
}

/**
 * Options for {@link MarkdownLint.lintDocument}.
 *
 * @public
 */
export interface MarkdownLintDocumentOptions {
	/** The name rules see as `LintContext.name`; defaults to `"<input>"`. */
	readonly name?: string;
	/**
	 * The markdownlint configuration object: which rules run, at what
	 * severity, with what settings; defaults to `{ default: true }`.
	 */
	readonly config?: LintConfigRecord;
	/**
	 * Ignore markdownlint's inline comments (`<!-- markdownlint-disable -->`
	 * and friends), as markdownlint's `noInlineConfig` does; defaults to
	 * `false`.
	 */
	readonly noInlineConfig?: boolean;
}

const runOf = (options: MarkdownLintDocumentOptions | undefined) => ({
	name: options?.name ?? "<input>",
	config: options?.config ?? { default: true },
	noInlineConfig: options?.noInlineConfig ?? false,
});

const requireDistinctNames = (rules: ReadonlyArray<LintRule>): void => {
	const seen = new Map<string, string>();
	for (const rule of rules) {
		for (const name of rule.names) {
			const upper = name.toUpperCase();
			const owner = seen.get(upper);
			if (owner !== undefined) {
				throw new Error(`Rule name "${name}" of rule "${rule.name}" is already used by rule "${owner}"`);
			}
			seen.set(upper, rule.name);
		}
	}
};

/**
 * The programmatic lint host: run {@link LintRule}s over markdown and collect
 * their {@link LintDiagnostic}s. Not instantiable.
 *
 * @example
 * ```ts
 * import { LintRule, MarkdownLint } from "@effected/markdown-lint";
 *
 * const noEmptyHeading = LintRule.make({
 *   names: ["no-empty-heading"],
 *   description: "Headings have text",
 *   tags: ["headings"],
 *   check: (context, report) => {
 *     for (const node of context.document.findAll("heading")) {
 *       if (node.children.length === 0) report(context.diagnostic({ at: node, detail: "Empty heading" }));
 *     }
 *   },
 * });
 *
 * const findings = MarkdownLint.lint("---\ntitle: x\n---\n\n##\n", [noEmptyHeading]);
 * console.log(findings.map((finding) => [finding.ruleNames[0], finding.lineNumber]));
 * // => [ [ "no-empty-heading", 5 ] ]
 * ```
 *
 * @public
 */
export class MarkdownLint {
	private constructor() {}

	/**
	 * Parse `source` and run every rule over it.
	 *
	 * @remarks
	 * Total: a markdown document always parses, except one nested past the
	 * kit's hardening cap. That one is reported rather than thrown — each rule
	 * reports one finding at the refusal, its `detail` the parse error's
	 * message — because markdownlint has no failure channel for a rule either,
	 * and the adapter reports the same refusal the same way, so the two hosts
	 * agree even here.
	 *
	 * A leading byte order mark (U+FEFF) is dropped before the parse, as
	 * markdownlint drops it, so a BOM-prefixed file's first line is markdown
	 * in both hosts and `LintContext.source` starts after the mark. A rule
	 * never sees the mark, but the result addresses the source as given: each
	 * finding's kit `edit` is moved past it, so
	 * `MarkdownEdit.applyAll(source, edits)` needs no knowledge of the mark.
	 * `lineNumber`, `column`, `range` and `fixInfo` stay in markdownlint's own
	 * coordinates, which count from the text after the mark.
	 *
	 * The file is read as markdownlint reads it: HTML comment bodies after
	 * the front matter are masked before the parse, and the front matter is
	 * markdownlint's own block (see `LintFrontmatter`). `options.config` and
	 * markdownlint's inline comments decide which rules run, on which lines,
	 * at what severity and with what `LintContext.config`, as in markdownlint;
	 * the comments are read from the unmasked text, front matter included.
	 *
	 * Findings come in rule order, then in the order each rule reported them;
	 * markdownlint instead sorts by rule name, then line. Line numbers count
	 * the whole source, frontmatter included.
	 *
	 * Throws, as a wiring error, when two rules share a name (ignoring case),
	 * and lets a rule's own `throw` propagate.
	 *
	 * @param source - The markdown text, frontmatter included.
	 * @param rules - The rules to run, in order.
	 * @param options - The name, dialect, frontmatter capture, configuration and inline-comment switch.
	 * @returns Every finding.
	 */
	static lint(
		source: string,
		rules: ReadonlyArray<LintRule>,
		options?: MarkdownLintOptions,
	): ReadonlyArray<LintDiagnostic> {
		requireDistinctNames(rules);
		// markdownlint drops a leading byte order mark before its rules run
		// (and before it numbers lines), so the programmatic host does too.
		const shift = source.charCodeAt(0) === 0xfeff ? 1 : 0;
		const text = source.slice(shift);
		const frontMatterLines = frontMatterLineCount(text);
		const reading = readSource(maskContent(text, frontMatterLines), frontMatterLines, parseSettings(options));
		const findings = lintReading(reading, splitLines(text), rules, runOf(options));
		return shift === 0 ? findings : findings.map((finding) => shiftEdit(finding, shift));
	}

	/**
	 * Run every rule over an already-parsed document.
	 *
	 * @remarks
	 * For a caller that holds a `MarkdownDocument` already — an editor
	 * re-linting the document it just parsed. The rules see exactly this
	 * document, so its parse options (dialect, frontmatter capture) are the
	 * ones that hold. A byte order mark is not dropped on this path: a
	 * BOM-prefixed document keeps it in its first line (so `\uFEFF# T` is not a
	 * heading) and edit offsets address `document.source`. A caller who wants
	 * {@link MarkdownLint.lint}'s reading strips a leading U+FEFF before parsing,
	 * or calls `lint`. The rules see the document as given, too: HTML
	 * comments unmasked, and `frontmatter` present only when the document
	 * captured a block (its `lineCount` stretched to markdownlint's when the
	 * capture lies inside markdownlint's block). Configuration and inline
	 * comments apply as in `lint`. Same ordering, naming check and throws as
	 * {@link MarkdownLint.lint}, and no refusal case: the parse already
	 * happened.
	 *
	 * @param document - The parsed document.
	 * @param rules - The rules to run, in order.
	 * @param options - The name rules see, the configuration and inline-comment switch.
	 * @returns Every finding.
	 */
	static lintDocument(
		document: MarkdownDocument,
		rules: ReadonlyArray<LintRule>,
		options?: MarkdownLintDocumentOptions,
	): ReadonlyArray<LintDiagnostic> {
		requireDistinctNames(rules);
		const reading = readDocument(document, frontMatterLineCount(document.source));
		return lintReading(Result.succeed(reading), splitLines(document.source), rules, runOf(options));
	}

	/**
	 * {@link MarkdownLint.lint} as an `Effect`, under a `MarkdownLint.lint`
	 * span.
	 *
	 * @remarks
	 * Defined in terms of `lint`, so the two cannot disagree. It never fails:
	 * a rule's `throw` or a rule-name clash dies as a defect.
	 *
	 * @param source - The markdown text, frontmatter included.
	 * @param rules - The rules to run, in order.
	 * @param options - The name, dialect and frontmatter capture.
	 * @returns An `Effect` succeeding with every finding.
	 */
	static readonly lintEffect: (
		source: string,
		rules: ReadonlyArray<LintRule>,
		options?: MarkdownLintOptions,
	) => Effect.Effect<ReadonlyArray<LintDiagnostic>> = Effect.fn("MarkdownLint.lint")(
		(source: string, rules: ReadonlyArray<LintRule>, options?: MarkdownLintOptions) =>
			Effect.sync(() => MarkdownLint.lint(source, rules, options)),
	);
}
