import type { AudienceKind, ColorLevel } from "@effected/env";
import type { LinkTarget } from "./Doc.js";
import type { GlyphSet } from "./Glyphs.js";
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
