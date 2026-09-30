/**
 * The symbols a theme draws with.
 *
 * @public
 */
export interface GlyphSet {
	/** Which set this is. */
	readonly kind: "unicode" | "ascii";
	/** The truncation marker. */
	readonly ellipsis: string;
	/** The frames of a spinner, in order. */
	readonly spinner: ReadonlyArray<string>;
	/** A list bullet. */
	readonly bullet: string;
	/** A directional arrow. */
	readonly arrow: string;
}

/**
 * The two glyph sets: Unicode, and a plain-ASCII fallback for terminals that cannot draw it.
 *
 * @public
 */
export class Glyphs {
	private constructor() {}

	/** Unicode symbols. */
	static readonly unicode: GlyphSet = {
		kind: "unicode",
		ellipsis: "…",
		spinner: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
		bullet: "•",
		arrow: "→",
	};

	/** ASCII-only symbols. */
	static readonly ascii: GlyphSet = {
		kind: "ascii",
		ellipsis: "...",
		spinner: ["-", "\\", "|", "/"],
		bullet: "*",
		arrow: "->",
	};
}
