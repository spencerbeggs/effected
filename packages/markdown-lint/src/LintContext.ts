// What a lint rule's check is handed: the parsed document, the source, its
// lines, the frontmatter facts, the position mapping, and the one builder a
// rule reports through. Type-only — both hosts build contexts the same way,
// so a rule cannot tell which host is running it.

import type { Frontmatter, MarkdownDocument, MarkdownNode, MarkdownRangeLike, Root } from "@effected/markdown";
import type { Option } from "effect";
import type { LintDiagnostic } from "./LintDiagnostic.js";
import type { LintEditLike, PositionMapping } from "./PositionMapping.js";

/**
 * The frontmatter block a lint context saw at the head of the source.
 *
 * @public
 */
export interface LintFrontmatter {
	/** The kit capture node: its `format`, raw `value` and `position`. */
	readonly node: Frontmatter;
	/**
	 * How many lines the block occupies, fences included: the 1-based line of
	 * its closing fence. The body starts on the line after it.
	 */
	readonly lineCount: number;
	/**
	 * Those lines, without terminators: the kit capture's lines. markdownlint's
	 * `frontMatterLines` can differ — its closing `---` also swallows trailing
	 * blank lines, and it strips `{…}` JSON and `...`-closed blocks the kit's
	 * fence grammar does not capture — so never read this as markdownlint's
	 * block. Line numbers are unaffected: the adapter renumbers by
	 * markdownlint's own count.
	 */
	readonly lines: ReadonlyArray<string>;
}

/**
 * What a rule reports: where, what, and optionally a range and a fix — every
 * position as a kit node or offset span. {@link LintContext} turns it into a
 * {@link LintDiagnostic}.
 *
 * @public
 */
export interface LintReport {
	/**
	 * Where the finding is: a node from the context's tree, or an offset span.
	 * Its start offset gives the diagnostic's `lineNumber` and `column`.
	 */
	readonly at: MarkdownNode | MarkdownRangeLike;
	/** What is wrong, for a reader; becomes markdownlint's `detail`. */
	readonly detail?: string;
	/** The offending text; becomes markdownlint's `context`. */
	readonly context?: string;
	/**
	 * The span to underline. `true` uses `at`'s own span; a span names
	 * another. Either way it is cut to the diagnostic's line — the line `at`
	 * starts on — because markdownlint's range lies on that line (see
	 * {@link PositionMapping.range}); a named span with no part on that line
	 * reports no range. Absent or `false` reports no range.
	 */
	readonly range?: boolean | MarkdownRangeLike;
	/** A fix, as a kit offset edit over the context's `source`. */
	readonly fix?: LintEditLike;
}

/**
 * Everything a lint rule's check reads, and the builder it reports through.
 *
 * @remarks
 * `source` is the WHOLE text the host linted, frontmatter included, and every
 * line number counts from its first line. Under markdownlint the adapter
 * rebuilds that text from `params.frontMatterLines` and `params.lines`, so it
 * carries markdownlint's own normalizations: no leading byte order mark
 * (the programmatic host drops one too), `\n` line endings, and HTML
 * comment bodies replaced by `.` runs of the same length, which markdownlint
 * hides from every rule. Positions are unaffected by any of them.
 *
 * `frontmatter` is the kit's capture at the head of `root.children`, read
 * with the closed `---`/`+++`/`---json` fence grammar, whichever host runs
 * the rule. A rule that walks `root.children` sees the `frontmatter` node
 * first and decides for itself whether it is content.
 *
 * @public
 */
export interface LintContext {
	/** The name of the linted text: a file path, or the host's label for it. */
	readonly name: string;
	/** The parsed document: tree, diagnostics, definitions, line index. */
	readonly document: MarkdownDocument;
	/** The document's tree — `document.root`. */
	readonly root: Root;
	/** The linted text — `document.source`. */
	readonly source: string;
	/** Every line of `source` without its terminator, first to last. */
	readonly lines: ReadonlyArray<string>;
	/** The frontmatter block at the head of `source`, when the parse captured one. */
	readonly frontmatter: Option.Option<LintFrontmatter>;
	/** The offset-to-line mapping every diagnostic position comes from. */
	readonly mapping: PositionMapping;
	/**
	 * Build the {@link LintDiagnostic} for a report, stamped with the running
	 * rule's names and positioned by `mapping`. Pass the result to the
	 * check's `report` callback.
	 */
	readonly diagnostic: (report: LintReport) => LintDiagnostic;
}
