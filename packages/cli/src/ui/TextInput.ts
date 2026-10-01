import type { ReactElement } from "react";
import { Fmt } from "../Fmt.js";
import type { Screen } from "./CliUi.js";
import { inkModules } from "./internal/ink.js";
import { lineText } from "./internal/lineText.js";
import { useScreenGuard } from "./internal/ScreenContext.js";
import { KeyHelp } from "./KeyHelp.js";
import { KeyTable } from "./KeyTable.js";
import { UiKey } from "./UiKey.js";
import { Styled, useGlyphs, useTerminalSize } from "./UiTheme.js";

/**
 * Where a {@link TextInput} is: its value, the cursor within it, and whether enter was pressed.
 *
 * @public
 */
export interface TextInputState {
	/** The text. */
	readonly value: string;
	/**
	 * The insertion point, from 0 to the value's length, in UTF-16 code units, always on a code-point boundary: an
	 * astral character (an emoji) is never split. Editing is by code point, not by grapheme, so a character built
	 * from several code points (a flag, a family emoji) is still crossed one code point at a time.
	 */
	readonly cursor: number;
	/** Whether enter was pressed; the view submits only when the value also validates. */
	readonly submitted: boolean;
}

/**
 * Options for {@link TextInput.init}.
 *
 * @public
 */
export interface TextInputInitOptions {
	/** The starting text; the cursor starts after it. */
	readonly initial?: string;
}

/**
 * Options for {@link TextInput.screen}.
 *
 * @public
 */
export interface TextInputScreenOptions {
	/** The question, shown above the input. */
	readonly message: string;
	/** The starting text. */
	readonly initial?: string;
	/** Shown, muted, while the value is empty. */
	readonly placeholder?: string;
	/** Returns a message when the value cannot be submitted, or `undefined` when it can. */
	readonly validate?: (value: string) => string | undefined;
}

/**
 * Props of {@link TextInput.View}.
 *
 * @public
 */
export interface TextInputViewProps extends TextInputScreenOptions {
	/** Receives the value when enter is pressed and it validates. */
	readonly onSubmit: (value: string) => void;
}

const init = (options: TextInputInitOptions = {}): TextInputState => {
	const value = options.initial ?? "";
	return { value, cursor: value.length, submitted: false };
};

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** The code-point boundary before `at`: one code unit back, two when that would land inside a surrogate pair. */
const previous = (value: string, at: number): number =>
	at >= 2 && isLow(value.charCodeAt(at - 1)) && isHigh(value.charCodeAt(at - 2)) ? at - 2 : Math.max(0, at - 1);

/** The code-point boundary after `at`. */
const following = (value: string, at: number): number =>
	at + 1 < value.length && isHigh(value.charCodeAt(at)) && isLow(value.charCodeAt(at + 1))
		? at + 2
		: Math.min(value.length, at + 1);

const insert = (state: TextInputState, text: string): TextInputState => ({
	value: state.value.slice(0, state.cursor) + text + state.value.slice(state.cursor),
	cursor: state.cursor + text.length,
	submitted: false,
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: the point is to split typed text at control characters
const CONTROLS = /([\u0000-\u001f\u007f])/;

// biome-ignore lint/suspicious/noControlCharactersInRegex: a paste's control characters are dropped
const PASTE_CONTROLS = /[\u0000-\u001f\u007f]/g;

/**
 * The keys one Ink input holds. Text read in one go (a fast typist, a paste) reaches `useInput` as one string, controls
 * and all, so it is split at its control characters: the printable runs are typed whole, `\r` is enter (and ends the
 * input: text after a submit is not typed into a submitted field), a backspace byte is backspace, a line feed is a
 * space (a pasted line break separates words in a one-line field), and a tab or any other control is dropped. A named
 * key, or a Ctrl or Meta combination, is the one key Ink reported.
 */
const typedKeys = (input: string, key: Parameters<typeof UiKey.fromInk>[1]): ReadonlyArray<UiKey> => {
	const single = UiKey.fromInk(input, key);
	if (single?._tag === "Named" || key.ctrl || key.meta || !CONTROLS.test(input) || [...input].length < 2) {
		return single === undefined ? [] : [single];
	}
	const keys: Array<UiKey> = [];
	for (const piece of input.split(CONTROLS)) {
		if (piece === "") continue;
		if (piece === "\r") {
			keys.push(UiKey.named("enter"));
			break;
		}
		if (piece === "\u007f" || piece === "\b") keys.push(UiKey.named("backspace"));
		else if (piece === "\n") keys.push(UiKey.char(" "));
		else if (!CONTROLS.test(piece)) keys.push(UiKey.char(piece));
	}
	return keys;
};

const step = (state: TextInputState, key: UiKey): TextInputState => {
	if (key._tag === "Char") return insert(state, key.char);
	const { value, cursor } = state;
	switch (key.name) {
		case "space":
			return insert(state, " ");
		case "backspace": {
			if (cursor === 0) return state;
			const from = previous(value, cursor);
			return { value: value.slice(0, from) + value.slice(cursor), cursor: from, submitted: false };
		}
		case "delete":
			return cursor === value.length
				? state
				: { value: value.slice(0, cursor) + value.slice(following(value, cursor)), cursor, submitted: false };
		case "left":
			return { ...state, cursor: previous(value, cursor), submitted: false };
		case "right":
			return { ...state, cursor: following(value, cursor), submitted: false };
		case "home":
			return { ...state, cursor: 0, submitted: false };
		case "end":
			return { ...state, cursor: value.length, submitted: false };
		case "enter":
			return { ...state, submitted: true };
		default:
			return state;
	}
};

/** Take code points from the end of `text` while they fit in `width` cells. */
const tail = (text: string, width: number): string => {
	const points = [...text];
	let out = "";
	let used = 0;
	for (let index = points.length - 1; index >= 0; index--) {
		const point = points[index] ?? "";
		const cells = Fmt.width(point);
		if (used + cells > width) break;
		out = point + out;
		used += cells;
	}
	return out;
};

/** Take code points from the start of `text` while they fit in `width` cells. */
const head = (text: string, width: number): string => {
	let out = "";
	let used = 0;
	for (const point of text) {
		const cells = Fmt.width(point);
		if (used + cells > width) break;
		out += point;
		used += cells;
	}
	return out;
};

/**
 * The text either side of the cursor, scrolled so the line fits `width` cells and the cursor stays in view: a cut
 * edge is marked with the ellipsis, the text after the cursor keeps up to a third of the room, and the text before
 * it the rest.
 */
const windowAround = (before: string, after: string, width: number, ellipsis: string): readonly [string, string] => {
	if (Fmt.width(before) + Fmt.width(after) <= width) return [before, after];
	const mark = Fmt.width(ellipsis);
	const afterRoom = Math.min(Fmt.width(after), Math.floor(width / 3));
	const beforeRoom = width - afterRoom;
	// The ellipsis marks a cut edge only when it fits with at least one cell of text beside it; on a terminal too narrow
	// for that (ASCII "..." in three cells), the text is simply cut.
	const shownBefore =
		Fmt.width(before) <= beforeRoom
			? before
			: beforeRoom > mark
				? `${ellipsis}${tail(before, beforeRoom - mark)}`
				: tail(before, Math.max(0, beforeRoom));
	const room = Math.max(0, width - Fmt.width(shownBefore));
	const shownAfter =
		Fmt.width(after) <= room ? after : room > mark ? `${head(after, room - mark)}${ellipsis}` : head(after, room);
	return [shownBefore, shownAfter];
};

/** Shown in the help line only; the input reads every key itself. */
const HELP: KeyTable<"submit"> = KeyTable.make<"submit">([{ keys: ["enter"], action: "submit", help: "submit" }]);

/**
 * One line of text: a pure reducer, a view and a ready-made screen.
 *
 * @remarks
 * Every typed character is text, `q` included: the input binds no letter, so Esc and Ctrl-C are the screen's root
 * keys and still cancel with `"escape"` and `"interrupt"`.
 *
 * @example
 * ```ts
 * import { CliUi, TextInput } from "@effected/cli/ui"
 * import { Effect } from "effect"
 *
 * const askName = Effect.gen(function* () {
 * 	const name = yield* CliUi.run(
 * 		TextInput.screen({
 * 			message: "Package name?",
 * 			placeholder: "my-package",
 * 			validate: (value) => (value.trim() === "" ? "A name is required" : undefined),
 * 		}),
 * 	)
 * 	return name
 * })
 * ```
 *
 * @public
 */
export class TextInput {
	private constructor() {}

	/**
	 * An input holding `initial`, the cursor after it.
	 *
	 * @param options - the starting text
	 */
	static readonly init: (options?: TextInputInitOptions) => TextInputState = init;

	/**
	 * Apply a key: a typed character (any, `q` included) or space is inserted at the cursor; backspace and delete
	 * remove around it; left, right, home and end move it, clamped to the text; enter marks it submitted. Every other
	 * key changes nothing.
	 *
	 * @param state - where the input is
	 * @param key - the key pressed
	 */
	static readonly step: (state: TextInputState, key: UiKey) => TextInputState = step;

	/**
	 * Draw the input: the message, the value with the cursor shown as `▏` (`|` under ASCII glyphs, so it stays visible
	 * without colour), the placeholder while empty, a validation message in the error token, and the key help. Enter
	 * submits when `validate` passes; otherwise its message is shown until the next key other than enter, or a paste.
	 *
	 * @remarks
	 * Text read in one go (a fast typist) is typed as it reads: printable runs are inserted whole, a return submits
	 * what came before it (anything after it is dropped), a backspace byte deletes, a line feed becomes a space, and a
	 * tab or other control character is dropped. A bracketed paste is inserted as text, its line breaks as spaces, and
	 * never submits.
	 *
	 * @param props - the message, the starting text, the placeholder, the validator and where the value goes
	 */
	static readonly View = (props: TextInputViewProps): ReactElement => {
		const { ink, react } = inkModules();
		const glyphs = useGlyphs();
		const { columns } = useTerminalSize();
		const [state, setState] = react.useState(() => init(props.initial === undefined ? {} : { initial: props.initial }));
		const [error, setError] = react.useState<string | undefined>(undefined);
		const { validate, onSubmit } = props;
		// Deliberately keyed on `submitted` alone: the effect runs in the render where it flipped, whose closure already
		// holds that render's validate and onSubmit, so listing them would only re-run it with nothing new to do.
		react.useEffect(() => {
			if (!state.submitted) return;
			const problem = validate?.(state.value);
			if (problem === undefined) onSubmit(state.value);
			else {
				setError(problem);
				setState((current) => ({ ...current, submitted: false }));
			}
		}, [state.submitted]);
		// A paste is text: inserted whole, a pasted line break a space (a paste never submits), other controls dropped.
		const guard = useScreenGuard();
		ink.usePaste(
			guard((text: string) => {
				const typed = text.replace(/\r\n|\r|\n/g, " ").replace(PASTE_CONTROLS, "");
				if (typed === "") return;
				setError(undefined);
				setState((current) => step(current, UiKey.char(typed)));
			}),
		);
		ink.useInput(
			guard((input: string, key: Parameters<typeof UiKey.fromInk>[1]) => {
				const keys = typedKeys(input, key);
				// Esc and Ctrl-C belong to the screen's root keys.
				if (
					keys.some((pressed) => pressed._tag === "Named" && (pressed.name === "escape" || pressed.name === "ctrl+c"))
				) {
					return;
				}
				if (keys.some((pressed) => !(pressed._tag === "Named" && pressed.name === "enter"))) setError(undefined);
				for (const pressed of keys) setState((current) => step(current, pressed));
			}),
		);
		const cursorGlyph = glyphs.kind === "unicode" ? "▏" : "|";
		const [before, after] = windowAround(
			state.value.slice(0, state.cursor),
			state.value.slice(state.cursor),
			columns - Fmt.width(cursorGlyph),
			glyphs.ellipsis,
		);
		return react.createElement(
			ink.Box,
			{ flexDirection: "column" },
			react.createElement(
				Styled,
				{ token: "emphasis" },
				Fmt.truncate(lineText(props.message), columns, { ellipsis: glyphs.ellipsis }),
			),
			react.createElement(
				ink.Text,
				null,
				before,
				cursorGlyph,
				after,
				state.value === "" && props.placeholder !== undefined
					? react.createElement(
							Styled,
							{ token: "muted" },
							Fmt.truncate(lineText(props.placeholder), Math.max(0, columns - Fmt.width(cursorGlyph)), {
								ellipsis: glyphs.ellipsis,
							}),
						)
					: null,
			),
			error === undefined
				? null
				: react.createElement(
						Styled,
						{ token: "error" },
						Fmt.truncate(lineText(error), columns, { ellipsis: glyphs.ellipsis }),
					),
			react.createElement(KeyHelp, { tables: [HELP] }),
		);
	};

	/**
	 * A ready-made screen for `CliUi.run`: the input, resolving with the submitted text.
	 *
	 * @param options - the message, the starting text, the placeholder and the validator
	 */
	static readonly screen =
		(options: TextInputScreenOptions): Screen<string> =>
		(control) =>
			inkModules().react.createElement(TextInput.View, { ...options, onSubmit: control.resolve });
}
