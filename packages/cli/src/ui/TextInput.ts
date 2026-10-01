import type { ReactElement } from "react";
import { Fmt } from "../Fmt.js";
import type { Screen } from "./CliUi.js";
import { inkModules } from "./internal/ink.js";
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
	/** The insertion point, from 0 to the value's length, in UTF-16 code units. */
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

const insert = (state: TextInputState, text: string): TextInputState => ({
	value: state.value.slice(0, state.cursor) + text + state.value.slice(state.cursor),
	cursor: state.cursor + text.length,
	submitted: false,
});

const step = (state: TextInputState, key: UiKey): TextInputState => {
	if (key._tag === "Char") return insert(state, key.char);
	const { value, cursor } = state;
	switch (key.name) {
		case "space":
			return insert(state, " ");
		case "backspace":
			return cursor === 0
				? state
				: { value: value.slice(0, cursor - 1) + value.slice(cursor), cursor: cursor - 1, submitted: false };
		case "delete":
			return cursor === value.length
				? state
				: { value: value.slice(0, cursor) + value.slice(cursor + 1), cursor, submitted: false };
		case "left":
			return { ...state, cursor: Math.max(0, cursor - 1), submitted: false };
		case "right":
			return { ...state, cursor: Math.min(value.length, cursor + 1), submitted: false };
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

/** Shown in the help line only; the input reads every key itself. */
const HELP: KeyTable<"submit"> = KeyTable.make<"submit">([{ keys: ["enter"], action: "submit", help: "submit" }]);

/**
 * One line of text: a pure reducer, a view and a ready-made screen.
 *
 * @remarks
 * Every typed character is text, `q` included: the input binds no letter, so Esc and Ctrl-C are the screen's root
 * keys and still cancel with `"escape"` and `"interrupt"`.
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
	 * submits when `validate` passes; otherwise its message is shown until the next edit.
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
		react.useEffect(() => {
			if (!state.submitted) return;
			const problem = validate?.(state.value);
			if (problem === undefined) onSubmit(state.value);
			else {
				setError(problem);
				setState((current) => ({ ...current, submitted: false }));
			}
		}, [state.submitted]);
		ink.useInput((input, key) => {
			const pressed = UiKey.fromInk(input, key);
			// Esc and Ctrl-C belong to the screen's root keys.
			if (
				pressed === undefined ||
				(pressed._tag === "Named" && (pressed.name === "escape" || pressed.name === "ctrl+c"))
			) {
				return;
			}
			if (!(pressed._tag === "Named" && pressed.name === "enter")) setError(undefined);
			setState((current) => step(current, pressed));
		});
		const cursorGlyph = glyphs.kind === "unicode" ? "▏" : "|";
		const before = state.value.slice(0, state.cursor);
		const after = state.value.slice(state.cursor);
		return react.createElement(
			ink.Box,
			{ flexDirection: "column" },
			react.createElement(
				Styled,
				{ token: "emphasis" },
				Fmt.truncate(props.message, columns, { ellipsis: glyphs.ellipsis }),
			),
			react.createElement(
				ink.Text,
				null,
				before,
				cursorGlyph,
				after,
				state.value === "" && props.placeholder !== undefined
					? react.createElement(Styled, { token: "muted" }, props.placeholder)
					: null,
			),
			error === undefined ? null : react.createElement(Styled, { token: "error" }, error),
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
