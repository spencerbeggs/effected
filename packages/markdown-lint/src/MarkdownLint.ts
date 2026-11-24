// The programmatic host: lint a markdown string (or an already-parsed
// document) with a list of rules, purely and synchronously, with no
// markdownlint and no unified anywhere in the graph.

import type { MarkdownDialect, MarkdownDocument } from "@effected/markdown";
import { MarkdownEdit } from "@effected/markdown";
import { Effect, Option, Result } from "effect";
import { applyFixes as applyFixesPolicy } from "./internal/apply-fixes.js";
import { alignedReading, lintReading, parseSettings, readSource } from "./internal/host.js";
import { frontMatterLineCount, maskContent, splitLines } from "./internal/reading.js";
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
	/**
	 * The dialect to re-read the source with when the given parse is not
	 * already markdownlint's reading (see {@link MarkdownLint.lintDocument});
	 * defaults to `"gfm"`, as {@link MarkdownLint.lint} does. A document does
	 * not record the dialect it was parsed with, so a caller who parsed as
	 * commonmark passes `dialect: "commonmark"`.
	 */
	readonly dialect?: MarkdownDialect;
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
		// Counted on the source as given: the count drops one mark itself, as markdownlint does, so a second
		// mark is text and no front matter follows it.
		const frontMatterLines = frontMatterLineCount(source);
		const reading = readSource(maskContent(text, frontMatterLines), frontMatterLines, parseSettings(options), text);
		const findings = lintReading(reading, splitLines(text), rules, runOf(options));
		return shift === 0 ? findings : findings.map((finding) => shiftEdit(finding, shift));
	}

	/**
	 * Run every rule over an already-parsed document.
	 *
	 * @remarks
	 * For a caller that holds a `MarkdownDocument` already — an editor
	 * re-linting the document it just parsed. A rule sees exactly what
	 * {@link MarkdownLint.lint} would show it for `document.source`, and the
	 * findings equal `lint`'s. The given parse is reused when it already is
	 * that reading: no leading byte order mark, no HTML comment for
	 * markdownlint to mask, and a front matter capture exactly where
	 * markdownlint reads a block the kit's grammar takes. Otherwise the
	 * source is re-read as `lint` reads it, with `options.dialect` — the
	 * document cannot say which dialect it was parsed with, so a caller who
	 * parsed as commonmark passes `dialect: "commonmark"`. Same ordering,
	 * naming check and throws as {@link MarkdownLint.lint}, and the same
	 * refusal reporting on a re-read.
	 *
	 * @param document - The parsed document.
	 * @param rules - The rules to run, in order.
	 * @param options - The name, configuration, inline-comment switch and re-read dialect.
	 * @returns Every finding.
	 */
	static lintDocument(
		document: MarkdownDocument,
		rules: ReadonlyArray<LintRule>,
		options?: MarkdownLintDocumentOptions,
	): ReadonlyArray<LintDiagnostic> {
		const aligned = alignedReading(document);
		if (Option.isNone(aligned)) return MarkdownLint.lint(document.source, rules, options);
		requireDistinctNames(rules);
		return lintReading(Result.succeed(aligned.value), splitLines(document.source), rules, runOf(options));
	}

	/**
	 * Apply findings' fixes to `source` as markdownlint's `applyFixes` does —
	 * the fix that `markdownlint-cli2 --fix` would make.
	 *
	 * @remarks
	 * Several findings can ask for fixes that meet: two headings each asking
	 * for the blank line between them, an insert and a delete at one column.
	 * `MarkdownEdit.applyAll` would apply them all (and refuse an overlap);
	 * this applies them under markdownlint's policy, ported from its
	 * `applyFixes`: fixes ordered bottom to top, whole-line deletes last on a
	 * line, right to left, longer inserts first; a fix identical to another
	 * applied once; an insert and a delete at one line and column made one
	 * replace; at most one fix applied where fixes run into each other on a
	 * line; and a whole-line delete taking every other fix on its line with
	 * it.
	 *
	 * Like markdownlint, it returns the text with one line ending throughout:
	 * every line break (CRLF, LF or a lone CR) becomes the one the original
	 * text uses most, LF winning a tie, then CRLF, whether or not a fix
	 * applied. A text with no line break keeps none; an inserted line break
	 * there stays `\n`, where markdownlint writes the platform's.
	 *
	 * It works on the findings' kit `edit`s, not on markdownlint's line fixes,
	 * so it differs where those differ: each fix is ordered and matched by its
	 * finding's `fixInfo`, and an edit with no `fixInfo` (one crossing a line
	 * break, which markdownlint cannot say) by its own start line and column.
	 * Findings without a fix are ignored. Edits address `source` as given, as
	 * {@link MarkdownLint.lint} reports them, byte order mark included, which
	 * is kept. Pure and synchronous.
	 *
	 * @param source - The text the findings were reported on.
	 * @param findings - The findings, from any number of rules, in any order.
	 * @returns The fixed text.
	 */
	static applyFixes(source: string, findings: ReadonlyArray<LintDiagnostic>): string {
		return applyFixesPolicy(source, findings);
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
