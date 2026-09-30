import type { AudienceKind, ColorLevel } from "@effected/env";
import type { Document, LinkTarget } from "./Doc.js";
import type { GlyphSet } from "./Glyphs.js";
import { renderAnsi } from "./internal/renderAnsi.js";
import { renderPlain } from "./internal/renderPlain.js";
import type { Style, TokenName } from "./Token.js";

/**
 * Everything a renderer needs to know about where its output is going.
 *
 * @remarks
 * A renderer is a pure function of a document and one of these, so two contexts give two renderings of the
 * same document. `paint` and `link` are plain functions: a context for a stream with no colour passes the
 * identity, and one whose hyperlinks are off passes a `link` that returns its label unchanged.
 *
 * @public
 */
export interface RenderContext {
	/** The display columns available. */
	readonly width: number;
	/** Who the output is for. */
	readonly audience: AudienceKind;
	/** The colour level of the stream being written. */
	readonly color: ColorLevel;
	/** Paints text in a token or a style; the identity at colour `none`. */
	readonly paint: (token: TokenName | Style, text: string) => string;
	/** The glyph set: status glyphs, separators, the ellipsis. */
	readonly glyphs: GlyphSet;
	/** Wraps a label as a link to a target; returns the label unchanged when links are off. */
	readonly link: (target: LinkTarget, label: string) => string;
	/** Turns an absolute path into its display form; the identity by default. */
	readonly displayPath: (absolute: string) => string;
}

/**
 * Pure renderers of a document: `(doc, context) => string`.
 *
 * @remarks
 * A renderer has no environment and no effects, so the same document and context always give the same string.
 * {@link Render.plain} is for agents; the rest of the set follows.
 *
 * @public
 */
export class Render {
	private constructor() {}

	/**
	 * Render a document as plain text for an agent.
	 *
	 * @remarks
	 * There are no escape sequences of any kind, whatever the context's colour or hyperlinks allow: `paint` and
	 * `link` are never called, and a control character in a document's text is removed. The audience is treated as
	 * `agent`, so a path joins with ` > `.
	 *
	 * - A heading is its text alone, code is in backticks, and a link is its label followed by the target in
	 *   parentheses, as `path:line:col` through `displayPath` for a file, unless the label already is the target.
	 * - A paragraph wraps to the width and is never truncated; a word longer than the width, such as a URL, stays
	 *   whole on its own line.
	 * - A list uses `- ` items, and past its cap the overflow row. A table is aligned text columns with a rule under
	 *   the header; a short row is padded with empty cells, a cell holding line breaks shows its first line and an
	 *   ellipsis, and cells are truncated only when the table is wider than the context, widest column first. A tree uses the glyph set's tree segments.
	 * - A collapsible is its title and the indented body, a callout its upper-case kind and the body, a code block
	 *   four-space indented, and a diff `- expected` lines then `+ received` lines, the cap limiting each side.
	 * - Counts take their total and their visible counters from {@link Doc.total} and {@link Doc.visibleCounters}.
	 *   Inline gives `3/5 passed, 1 failed (1.2s)`: the first counter is the headline and shows its share of the
	 *   total. Columns gives aligned label and number pairs, and row one line of cells.
	 * - Top-level blocks are consecutive lines; a section separates its title and children with blank lines.
	 *
	 * @param doc - the document
	 * @param ctx - where the output is going
	 */
	static readonly plain = (doc: Document, ctx: RenderContext): string => renderPlain(doc, ctx);

	/**
	 * Render a document for a person: the same layout as {@link Render.plain}, painted and linked.
	 *
	 * @remarks
	 * The context's `paint` and `link` do the styling, so a context at colour `none` with links off gives exactly
	 * what `plain` gives, apart from two things: code has no backticks (it is painted `accent` instead), and a path
	 * joins with the audience's separator (`›` for a person) rather than ` > `. Tokens:
	 *
	 * - headings, section and collapsible titles, and table headers are `emphasis`; the rule under a header, tree
	 *   lines and overflow rows are `muted`;
	 * - a status glyph takes its definition's token, and a diff's `-` lines are `failure` and `+` lines `success`;
	 * - a callout's label takes its kind's token (`note` info, `tip` success, `important` accent, `warning` warning,
	 *   `caution` error), and a counter the token of its status, with the qualifier and the duration `muted`.
	 *
	 * A link goes through `ctx.link`, which makes an OSC 8 hyperlink only when the policy allows it. When it does
	 * not (it returns the label unchanged), the target follows the label in parentheses, muted, as in plain text.
	 *
	 * Text is cut and wrapped before it is painted, so a colour or a hyperlink is never cut in half, and a table
	 * cut to the width keeps the colour of what remains. Tables are plain aligned columns, never box drawing:
	 * box drawing costs two columns of every row for nothing a rule and the padding do not already say, and it
	 * cannot be matched to plain text.
	 *
	 * @param doc - the document
	 * @param ctx - where the output is going
	 */
	static readonly ansi = (doc: Document, ctx: RenderContext): string => renderAnsi(doc, ctx);
}
