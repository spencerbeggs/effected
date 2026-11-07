// Kit offsets to markdownlint's 1-based lines, columns, ranges and one-line
// fixes. The one place a position is translated: both hosts and every
// diagnostic go through it, so the programmatic linter and the markdownlint
// adapter cannot disagree about where a finding is.
//
// The line table is `@effected/source`'s `LineIndex` (re-exported by
// `@effected/markdown`, whose positions it already builds), with its default
// "lsp" line breaks: `\n`, `\r\n` and a bare `\r` — exactly markdownlint's
// own `\r\n?|\n` split, so a line here is a line in `params.lines`.

import type { MarkdownDocument, MarkdownNode, MarkdownRangeLike, SourceIndex } from "@effected/markdown";
import { LineIndex, MarkdownEdit } from "@effected/markdown";
import { Option } from "effect";
import type { LintRange } from "./LintDiagnostic.js";
import { LintFixInfo } from "./LintDiagnostic.js";

/**
 * A kit text edit as {@link PositionMapping.fixInfo} and `LintReport.fix`
 * take it: a `MarkdownEdit` instance or a plain `{ offset, length, content }`
 * literal — only those three fields are read.
 *
 * @public
 */
export type LintEditLike =
	| MarkdownEdit
	| { readonly offset: number; readonly length: number; readonly content: string };

/**
 * Translates kit source offsets into markdownlint's coordinates: 1-based line
 * numbers, 1-based columns, `range` tuples and one-line `fixInfo` edits.
 *
 * @remarks
 * Built over one source text. Offsets are UTF-16 code units, as every kit
 * position is; a column is an offset into its line plus one, so it agrees
 * with markdownlint's `range` and `editColumn`, which index the JavaScript
 * string of the line.
 *
 * Setext headings, multi-line nodes and frontmatter need no special case:
 * a position is always its start offset's line, so a setext heading reports
 * on its text line (where markdownlint's `setextHeading` token starts), a
 * multi-line node on its first line, and a node after a frontmatter block on
 * the line an editor shows it on. A `\r\n` is one terminator; an offset on
 * its `\n` reads as the end of the line.
 *
 * @example
 * ```ts
 * import { PositionMapping } from "@effected/markdown-lint";
 * import { Option } from "effect";
 *
 * const mapping = PositionMapping.of("Title\n=====\n\nSome *text*\n");
 * console.log(mapping.lineNumber(13), mapping.column(18)); // => 4 6
 * console.log(Option.getOrNull(mapping.range({ offset: 18, length: 6 }))); // => [ 6, 6 ]
 * ```
 *
 * @public
 */
export class PositionMapping {
	private constructor(private readonly index: SourceIndex) {}

	/**
	 * Index `source` for mapping.
	 *
	 * @param source - The full source text, frontmatter included.
	 * @returns The mapping.
	 */
	static of(source: string): PositionMapping {
		return new PositionMapping(LineIndex.make(source));
	}

	/**
	 * Map positions in `document`, reusing the line index its parse already
	 * built.
	 *
	 * @param document - A parsed (or constructed) document.
	 * @returns The mapping over `document.source`.
	 */
	static fromDocument(document: MarkdownDocument): PositionMapping {
		return new PositionMapping(document.lineIndex);
	}

	/** The number of lines in the source, at least `1`. */
	get lineCount(): number {
		return this.index.lineCount;
	}

	/**
	 * Every line of the source without its terminator, split exactly as
	 * markdownlint splits `params.lines`.
	 *
	 * @returns The lines, first to last.
	 */
	lines(): ReadonlyArray<string> {
		const lines: Array<string> = [];
		for (let line = 0; line < this.index.lineCount; line++) lines.push(this.index.lineText(line));
		return lines;
	}

	/**
	 * The text of a 1-based line, without its terminator; a line past either
	 * end reads as the nearest line.
	 *
	 * @param lineNumber - The 1-based line.
	 * @returns The line's text.
	 */
	lineText(lineNumber: number): string {
		return this.index.lineText(lineNumber - 1);
	}

	/**
	 * The 1-based line containing `offset`.
	 *
	 * @param offset - A UTF-16 offset, clamped to the source; an offset at a
	 *   terminator belongs to the line it ends.
	 * @returns The line number.
	 */
	lineNumber(offset: number): number {
		return this.index.lineAt(offset) + 1;
	}

	/**
	 * The 1-based column of `offset` on its line.
	 *
	 * @param offset - A UTF-16 offset, clamped to the source.
	 * @returns The column; an offset inside a `\r\n` reads as one past the
	 *   line's last character.
	 */
	column(offset: number): number {
		return this.index.positionAt(offset).character + 1;
	}

	/**
	 * The 1-based line of a node's start — where markdownlint reports it.
	 *
	 * @param node - A node from this source's tree.
	 * @returns The line number.
	 */
	nodeLineNumber(node: MarkdownNode): number {
		return this.lineNumber(node.position.start.offset);
	}

	/**
	 * The markdownlint `range` for a span on one line: its start column and
	 * its length, cut to that line's text.
	 *
	 * @remarks
	 * markdownlint's `range` lives on the diagnostic's own line and rejects a
	 * range running past that line's end — not just this rule's finding: the
	 * lint of the whole file fails. So the span is intersected with ONE line:
	 * `lineNumber` when given (pass the diagnostic's line, as
	 * `LintContext.diagnostic` does), else the line the span starts on.
	 *
	 * A multi-line span (a paragraph, a fenced code block, a setext heading
	 * with its underline) therefore keeps only its part on that line, and a
	 * span that starts on an earlier line keeps the part that reaches it. A
	 * span with nothing on the line — empty, starting at the line's end, or
	 * lying wholly on another line — has no range, `Option.none()`, because
	 * markdownlint requires a length of at least 1.
	 *
	 * @param span - The span, in UTF-16 offsets.
	 * @param lineNumber - The 1-based line the range must lie on; defaults to
	 *   the line of `span.offset`.
	 * @returns The `[column, length]` range, or `Option.none()`.
	 */
	range(span: MarkdownRangeLike, lineNumber?: number): Option.Option<LintRange> {
		const line = lineNumber === undefined ? this.index.lineAt(span.offset) : lineNumber - 1;
		if (line < 0 || line >= this.index.lineCount) return Option.none();
		const start = this.index.lineStart(line);
		const end = this.index.lineEnd(line);
		const from = Math.max(span.offset, start);
		const to = Math.min(span.offset + span.length, end);
		return to - from < 1 ? Option.none() : Option.some([from - start + 1, to - from] as const);
	}

	/**
	 * The markdownlint `fixInfo` for a kit edit, reported by a diagnostic on
	 * `lineNumber`.
	 *
	 * @remarks
	 * markdownlint's `fixInfo` edits one line, so an edit maps when it:
	 *
	 * - stays within one line's text — `editColumn`, then `deleteCount` when
	 *   it deletes and `insertText` when it inserts; or
	 * - deletes exactly one whole line with its terminator and inserts nothing
	 *   — `deleteCount: -1`, markdownlint's whole-line delete.
	 *
	 * Anything else — an edit crossing a line break, one starting inside a
	 * `\r\n`, or one that changes nothing — is `Option.none()`. The fix is not
	 * lost: the diagnostic keeps it as a kit edit for `MarkdownEdit.applyAll`.
	 * `fixInfo.lineNumber` is set only when the edit's line differs from
	 * `lineNumber`, as markdownlint's built-in rules do.
	 *
	 * @param edit - The kit edit, in UTF-16 offsets.
	 * @param lineNumber - The 1-based line of the diagnostic carrying the fix.
	 * @returns The `fixInfo`, or `Option.none()`.
	 */
	fixInfo(edit: LintEditLike, lineNumber: number): Option.Option<LintFixInfo> {
		const line = this.index.lineAt(edit.offset);
		const start = this.index.lineStart(line);
		const end = this.index.lineEnd(line);
		const editLine = line + 1;
		const onLine = editLine === lineNumber ? {} : { lineNumber: editLine };
		if (edit.offset > end) return Option.none();
		const hasNext = line + 1 < this.index.lineCount;
		if (
			edit.offset === start &&
			edit.content === "" &&
			hasNext &&
			edit.offset + edit.length === this.index.lineStart(line + 1)
		) {
			return Option.some(LintFixInfo.make({ ...onLine, deleteCount: -1 }));
		}
		if (edit.offset + edit.length > end) return Option.none();
		if (edit.length === 0 && edit.content === "") return Option.none();
		return Option.some(
			LintFixInfo.make({
				...onLine,
				editColumn: edit.offset - start + 1,
				...(edit.length > 0 ? { deleteCount: edit.length } : {}),
				...(edit.content !== "" ? { insertText: edit.content } : {}),
			}),
		);
	}

	/**
	 * Copy a kit edit into a `MarkdownEdit`.
	 *
	 * @param edit - The edit, an instance or a plain literal.
	 * @returns The `MarkdownEdit`.
	 */
	static edit(edit: LintEditLike): MarkdownEdit {
		return edit instanceof MarkdownEdit
			? edit
			: MarkdownEdit.make({ offset: edit.offset, length: edit.length, content: edit.content });
	}
}
