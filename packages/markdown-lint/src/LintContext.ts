// What a lint rule's check is handed: the parsed document, the source, its
// lines, the frontmatter facts, the position mapping, and the one builder a
// rule reports through. Type-only — both hosts build contexts the same way,
// so a rule cannot tell which host is running it.

import type { Frontmatter, MarkdownDocument, MarkdownNode, MarkdownRangeLike, Root } from "@effected/markdown";
import type { Option } from "effect";
import type { LintDiagnostic } from "./LintDiagnostic.js";
import type { LintEditLike, PositionMapping } from "./PositionMapping.js";

/**
 * The front matter block a lint context saw at the head of the source, read
 * as markdownlint reads it.
 *
 * @remarks
 * `lineCount` and `lines` are markdownlint's own front matter: its default
 * pattern's `---`, `+++` or `{…}` block, with the blank lines its closing
 * fence swallows, in both hosts. `node` is the kit's capture when the kit
 * captured that block too (its closed `---`/`+++` fence grammar); for a block
 * the kit does not capture (a `{…}` block, a `...`-closed one) it is
 * `Option.none()`, and the parse saw those lines as spaces, so no tree node
 * lies inside them.
 *
 * @public
 */
export interface LintFrontmatter {
	/** The kit capture node — its `format`, raw `value` and `position` — when the kit captured the block. */
	readonly node: Option.Option<Frontmatter>;
	/**
	 * How many lines the block occupies, fences and swallowed blank lines
	 * included: markdownlint's `frontMatterLines.length`. The content starts
	 * on the line after it.
	 */
	readonly lineCount: number;
	/** Those lines, without terminators: markdownlint's `frontMatterLines`. */
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
	/**
	 * Whether `fix` deletes the diagnostic's whole line, as markdownlint's
	 * `deleteCount: -1` does: its `fixInfo` is that delete whatever the
	 * edit's span (the only line of a source with no line ending has no
	 * terminator to take), and `MarkdownLint.applyFixes` removes the line as
	 * markdownlint does, a run of deleted lines at the source's end taking the
	 * line break before it. The edit should span the line.
	 */
	readonly deletesLine?: boolean;
}

/**
 * Everything a lint rule's check reads, and the builder it reports through.
 *
 * @remarks
 * `source` is the WHOLE text the host linted, frontmatter included, and every
 * line number counts from its first line. Both hosts hand a rule the text
 * markdownlint hands its rules: no leading byte order mark, and the body of
 * every HTML comment after the front matter replaced by `.` runs of the same
 * length (spaces and line breaks kept), which markdownlint hides from every
 * rule; the tree is parsed from that same text. Under markdownlint the
 * adapter rebuilds it from `params.frontMatterLines` and `params.lines`, so
 * it also carries `\n` line endings. Positions are unaffected by any of it.
 * `MarkdownLint.lintDocument` re-reads a document whose comments it would
 * mask, so it hands a rule the same masked text. A comment's text is
 * therefore not available to a rule on either host, in the tree's `html`
 * nodes either, as under markdownlint: a check on what a comment says belongs
 * outside a lint rule.
 *
 * `frontmatter` is markdownlint's front matter block (see
 * {@link LintFrontmatter}). A kit capture sits at the head of
 * `root.children`; a rule that walks them sees the `frontmatter` node first
 * and decides for itself whether it is content. When the kit did not capture
 * the block, `document.source` has those lines as spaces while `source`
 * keeps them.
 *
 * `config` is the rule's settings from the markdownlint configuration, with
 * `enabled` and `severity` removed — markdownlint's `params.config`.
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
	/** The linted text, as markdownlint hands it to rules. */
	readonly source: string;
	/** Every line of `source` without its terminator, first to last. */
	readonly lines: ReadonlyArray<string>;
	/** markdownlint's front matter block at the head of `source`, when there is one. */
	readonly frontmatter: Option.Option<LintFrontmatter>;
	/**
	 * The offset-to-line mapping over `source` every diagnostic position comes
	 * from. A host builds one per reading and every rule's context over that
	 * reading shares it; the built-in rules cache what they derive from the
	 * document under it, so a context built by hand for another document or
	 * front matter needs its own mapping.
	 */
	readonly mapping: PositionMapping;
	/** The rule's settings, without `enabled` and `severity`; frozen. */
	readonly config: Readonly<Record<string, unknown>>;
	/**
	 * Build the {@link LintDiagnostic} for a report, stamped with the running
	 * rule's names and positioned by `mapping`. Pass the result to the
	 * check's `report` callback.
	 */
	readonly diagnostic: (report: LintReport) => LintDiagnostic;
}
