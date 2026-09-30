import type { ColorLevel } from "@effected/env";
import { TerminalEnv } from "@effected/env";
import { Config, Context, Effect, Layer, Option } from "effect";
import { Prompt } from "effect/cli";
import type { GlyphSet } from "./Glyphs.js";
import { Glyphs } from "./Glyphs.js";
import { openSequence, paintStyle } from "./internal/ansi.js";
import type { Status } from "./Status.js";
import type { Style, TokenName } from "./Token.js";

/** The default style of every token. */
const DEFAULT_TOKENS: Readonly<Record<TokenName, Style>> = {
	success: { fg: "green" },
	failure: { fg: "red" },
	error: { fg: "red", bold: true },
	warning: { fg: "yellow" },
	info: { fg: "cyan" },
	muted: { dim: true },
	accent: { fg: "cyan" },
	emphasis: { bold: true },
};

/**
 * The shape of the {@link CliTheme} service: a colour level, a glyph set and the functions that use them.
 *
 * @remarks
 * The whole shape is one immutable value with no mockable behaviour, so `Layer.succeed` (via
 * {@link CliTheme.layerTest}) is the complete double.
 *
 * @public
 */
export interface CliThemeShape {
	/** Render `text` in a token or an explicit style; the identity when colour is `none`. */
	readonly paint: (token: TokenName | Style, text: string) => string;
	/** The raw opening SGR sequence of a token or style; `""` when colour is `none`. */
	readonly sgr: (token: TokenName | Style) => string;
	/** The glyph set in use. */
	readonly glyphs: GlyphSet;
	/** The colour level in use. */
	readonly color: ColorLevel;
	/** Render a status from a vocabulary: its glyph, painted with its token, then `text` when given. */
	readonly status: <N extends string>(vocab: Status<N>, name: N, text?: string) => string;
}

/**
 * Options for {@link CliTheme.layer}.
 *
 * @public
 */
export interface CliThemeOptions {
	/** Styles that replace the default of a token. */
	readonly tokens?: Partial<Record<TokenName, Style>> | undefined;
	/** The glyph set. `auto`, the default, is ASCII only when `TERM=dumb`. */
	readonly glyphs?: "unicode" | "ascii" | "auto" | undefined;
}

/**
 * Options for {@link CliTheme.layerTest}.
 *
 * @public
 */
export interface CliThemeTestOptions {
	/** The colour level; `none` by default. */
	readonly color?: ColorLevel | undefined;
	/** The glyph set; Unicode by default. */
	readonly glyphs?: "unicode" | "ascii" | undefined;
}

const make = (
	color: ColorLevel,
	glyphs: GlyphSet,
	overrides: Partial<Record<TokenName, Style>> | undefined,
): CliThemeShape => {
	const tokens = { ...DEFAULT_TOKENS, ...overrides };
	const resolve = (token: TokenName | Style): Style => (typeof token === "string" ? tokens[token] : token);
	const paint = (token: TokenName | Style, text: string): string => paintStyle(resolve(token), color, text);
	return {
		paint,
		sgr: (token) => openSequence(resolve(token), color),
		glyphs,
		color,
		status: (vocab, name, text) => {
			const def = vocab.def(name);
			const glyph = paint(def.token, glyphs.kind === "ascii" ? def.ascii : def.glyph);
			return text === undefined ? glyph : `${glyph} ${text}`;
		},
	};
};

/** The prompt glyphs that differ under ASCII; `Prompt.makeTheme` already holds the Unicode ones. */
const ASCII_PROMPT_GLYPHS = {
	prefix: "?",
	arrowUp: "^",
	arrowDown: "v",
	checkboxOn: "[x]",
	checkboxOff: "[ ]",
	tick: "+",
	pointerSmall: ">",
	pointer: ">",
} as const;

/**
 * The presentation of a CLI: colour tokens, glyphs and statuses, decided once from the terminal.
 *
 * @remarks
 * A `Context.Service`, not a `Reference`. A colour level is a fact about the terminal, not a preference with a
 * safe default, so there is nothing sensible for an unprovided theme to read; requiring it puts `CliTheme` in
 * `R` and a program that forgot to wire it fails to compile rather than printing plain text to a colour
 * terminal. {@link CliTheme.layer} reads `TerminalEnv`.
 *
 * @public
 */
export class CliTheme extends Context.Service<CliTheme, CliThemeShape>()("@effected/cli/CliTheme") {
	/**
	 * The theme for the terminal `TerminalEnv` describes.
	 *
	 * @remarks
	 * Bind the layer to a constant and provide it once. With `glyphs: "auto"` the glyph set is ASCII only when
	 * `TERM=dumb`, read through `Config`.
	 *
	 * @param options - token overrides and the glyph set
	 */
	static readonly layer = (options?: CliThemeOptions): Layer.Layer<CliTheme, never, TerminalEnv> =>
		Layer.effect(
			CliTheme,
			Effect.gen(function* () {
				const terminal = yield* TerminalEnv;
				const choice = options?.glyphs ?? "auto";
				const dumb =
					choice === "auto"
						? Option.contains(
								yield* Config.option(Config.String("TERM")).pipe(Effect.orElseSucceed(() => Option.none<string>())),
								"dumb",
							)
						: false;
				const glyphs = choice === "ascii" || dumb ? Glyphs.ascii : Glyphs.unicode;
				return make(terminal.stdout.color, glyphs, options?.tokens);
			}),
		);

	/**
	 * A fixed theme that needs nothing; `none` colour and Unicode glyphs unless told otherwise.
	 *
	 * @param options - the colour level and glyph set
	 */
	static readonly layerTest = (options?: CliThemeTestOptions): Layer.Layer<CliTheme> =>
		Layer.succeed(
			CliTheme,
			make(options?.color ?? "none", options?.glyphs === "ascii" ? Glyphs.ascii : Glyphs.unicode, undefined),
		);

	/**
	 * Sets core's `Prompt.Theme` from the tokens, so built-in prompts match the rest of the output.
	 *
	 * @remarks
	 * The colour fields are raw SGR openers and are empty strings when colour is `none`. Under ASCII glyphs the
	 * prompt symbols fall back to ASCII too. A colourless theme is not byte-clean: core's `Ansi.annotate`
	 * appends a `\x1b[0m` reset, and prompts write cursor and underline codes, whatever the theme says (see
	 * `okf/decisions/one-cancelled-for-two-prompt-engines.md`).
	 */
	static readonly promptTheme: Layer.Layer<never, never, CliTheme> = Layer.effect(
		Prompt.Theme,
		Effect.gen(function* () {
			const theme = yield* CliTheme;
			const open = (token: TokenName): string => theme.sgr(token);
			return Prompt.makeTheme({
				...(theme.glyphs.kind === "ascii" ? ASCII_PROMPT_GLYPHS : {}),
				ellipsis: theme.glyphs.ellipsis,
				primaryColor: open("accent"),
				mutedColor: open("muted"),
				successColor: open("success"),
				errorColor: open("error"),
				submittedColor: open("emphasis"),
			});
		}),
	);
}
