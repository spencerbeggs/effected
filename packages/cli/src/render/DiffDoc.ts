import type { BlockOf, InlineInput } from "@effected/cli-kit";
import { Doc } from "@effected/cli-kit";
import type { DocumentDiff } from "@effected/engine/schema";

/**
 * How many diff rows `DiffDoc.render` shows per schema before it cuts the rest with a "… N more lines" tail: a
 * screenful of context that keeps a many-schema report readable.
 *
 * @public
 */
export const DEFAULT_MAX_DIFF_LINES = 40;

/** Options for {@link DiffDoc.render}. @public */
export interface DiffDocOptions {
	/** The most diff rows shown; {@link DEFAULT_MAX_DIFF_LINES} by default. */
	readonly maxLines?: number | undefined;
}

type Row = InlineInput;

// A renderer turns a tab into one space, which flattens a tab-indented document.
const expandTabs = (text: string): string => text.replaceAll("\t", "  ");

/**
 * A schema's line diff as a `Doc`, in git's shape: an `@@ path @@` header, context lines as they are, removes in the
 * `error` token and adds in the `success` token.
 *
 * @remarks
 * Each tab in a line's text is expanded to two spaces, so a tab-indented document keeps its shape. Every line's text
 * goes into the document as a `Doc.text` run, which is data: the renderers remove escape and control characters from it
 * and never read it as markup, so a diff of untrusted text cannot repaint the terminal.
 * A document with more than one hunk separates them with a muted `@@ -a,b +c,d @@` range row. The cap counts every
 * row after the header (diff lines, range rows and `\ No newline at end of file` markers) and the tail names exactly
 * how many were cut. Nothing here loads Ink or React.
 *
 * @public
 */
export class DiffDoc {
	private constructor() {}

	/**
	 * @param path - the schema file the diff is for, shown in the header
	 * @param diff - the diff
	 * @param options - `maxLines`, the cap on shown rows
	 */
	static render(path: string, diff: DocumentDiff, options?: DiffDocOptions): BlockOf<"Lines"> {
		const cap = Math.max(0, Math.floor(options?.maxLines ?? DEFAULT_MAX_DIFF_LINES));
		const rows: Array<Row> = [];
		diff.hunks.forEach((hunk) => {
			if (diff.hunks.length > 1) {
				rows.push(Doc.text(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`, "muted"));
			}
			for (const line of hunk.lines) {
				const text = expandTabs(line.text);
				rows.push(
					line.kind === "add"
						? Doc.text(`+${text}`, "success")
						: line.kind === "remove"
							? Doc.text(`-${text}`, "error")
							: Doc.text(` ${text}`),
				);
				if (line.noNewline === true) rows.push(Doc.text("\\ No newline at end of file", "muted"));
			}
		});
		const hidden = rows.length - cap;
		const shown = hidden > 0 ? rows.slice(0, cap) : rows;
		if (hidden > 0) shown.push(Doc.text(`… ${hidden} more ${hidden === 1 ? "line" : "lines"}`, "muted"));
		return Doc.lines([Doc.text(`@@ ${path} @@`, "accent"), ...shown], { wrap: false });
	}
}
