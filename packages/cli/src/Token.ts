/**
 * A named terminal colour: the eight ANSI colours and their bright variants.
 *
 * @public
 */
export type NamedColor =
	| "black"
	| "red"
	| "green"
	| "yellow"
	| "blue"
	| "magenta"
	| "cyan"
	| "white"
	| "brightBlack"
	| "brightRed"
	| "brightGreen"
	| "brightYellow"
	| "brightBlue"
	| "brightMagenta"
	| "brightCyan"
	| "brightWhite";

/**
 * A terminal style: an optional foreground colour and text attributes.
 *
 * @remarks
 * A style is data; it carries no escape sequences. `CliTheme.paint` renders it for the terminal's colour
 * level, and at level `none` rendering is the identity. A hex foreground that is not `#rgb` or `#rrggbb` is
 * ignored when rendered rather than failing.
 *
 * @public
 */
export interface Style {
	/** The foreground: a named colour or a `#rrggbb` hex. */
	readonly fg?: NamedColor | `#${string}`;
	/** Bold. */
	readonly bold?: boolean;
	/** Dim, or faint. */
	readonly dim?: boolean;
	/** Italic. */
	readonly italic?: boolean;
	/** Underline. */
	readonly underline?: boolean;
}

/**
 * The semantic tokens a theme resolves to a {@link Style}.
 *
 * @public
 */
export type TokenName = "success" | "failure" | "warning" | "info" | "error" | "muted" | "accent" | "emphasis";

/**
 * Constructors for {@link Style} values.
 *
 * @public
 */
export class Token {
	private constructor() {}

	/**
	 * A foreground from a hex colour.
	 *
	 * @param hex - `#rrggbb` (or `#rgb`)
	 */
	static readonly hex = (hex: `#${string}`): Style => ({ fg: hex });

	/**
	 * A foreground from a named colour.
	 *
	 * @param color - the colour
	 */
	static readonly named = (color: NamedColor): Style => ({ fg: color });

	/**
	 * A style, as written. Exists so a style reads as a token at a call site.
	 *
	 * @param style - the style
	 */
	static readonly style = (style: Style): Style => style;
}
