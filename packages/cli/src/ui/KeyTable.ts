import type * as Cli from "@effected/cli";
import { Option } from "effect";
import { inkModules } from "./internal/ink.js";
import type { KeyName } from "./UiKey.js";
import { UiKey } from "./UiKey.js";

/**
 * One row of a {@link KeyTable}: the keys that trigger an action, and the help line that names it.
 *
 * @public
 */
export interface Binding<Action> {
	/** The keys, named or typed (`{ char: "q" }`); any of them triggers the action. */
	readonly keys: ReadonlyArray<KeyName | { readonly char: string }>;
	/** What the keys do. */
	readonly action: Action;
	/** The words `KeyHelp` shows beside the keys. */
	readonly help: string;
	/** Bound but left out of the help line. */
	readonly hidden?: boolean;
}

/**
 * One entry of a key table's help: the key labels and what they do.
 *
 * @public
 */
export interface KeyHelpRow {
	/** The keys, labelled for the glyph set and joined with `/`. */
	readonly label: string;
	/** What they do. */
	readonly help: string;
}

/**
 * Options for {@link useKeys}.
 *
 * @public
 */
export interface UseKeysOptions {
	/** Whether the keys are read; `true` by default. */
	readonly isActive?: boolean;
}

/** Arrows under a Unicode glyph set; everything else, and everything under ASCII, as words. */
const ARROWS: Partial<Record<KeyName, string>> = { up: "↑", down: "↓", left: "←", right: "→" };
const WORDS: Record<KeyName, string> = {
	up: "up",
	down: "down",
	left: "left",
	right: "right",
	enter: "enter",
	space: "space",
	tab: "tab",
	"shift+tab": "shift+tab",
	backspace: "backspace",
	delete: "del",
	escape: "esc",
	"ctrl+c": "ctrl+c",
	home: "home",
	end: "end",
	pageup: "pgup",
	pagedown: "pgdn",
};

const labelOf = (key: KeyName | { readonly char: string }, glyphs: Cli.GlyphSet): string => {
	if (typeof key !== "string") return key.char;
	return (glyphs.kind === "unicode" ? ARROWS[key] : undefined) ?? WORDS[key];
};

const bound = (binding: KeyName | { readonly char: string }, key: UiKey): boolean =>
	typeof binding === "string"
		? key._tag === "Named" && key.name === binding
		: key._tag === "Char" && key.char === binding.char;

/**
 * The keys a widget understands, as data: the one source both for dispatching input and for the help line, so the
 * two cannot drift apart.
 *
 * @public
 */
export class KeyTable<Action> {
	private constructor(
		/** The bindings, in priority order. */
		readonly bindings: ReadonlyArray<Binding<Action>>,
	) {}

	/**
	 * A table from its bindings. When two bindings share a key, the first wins.
	 *
	 * @param bindings - the bindings, in priority order
	 */
	static readonly make = <Action>(bindings: ReadonlyArray<Binding<Action>>): KeyTable<Action> => new KeyTable(bindings);

	/**
	 * The keys every screen has: Esc cancels with `"escape"` (help: cancel), and Ctrl-C cancels with `"interrupt"`,
	 * bound but hidden. `q` is never a root key: it belongs to a widget's own table, so a text input can type it.
	 */
	static readonly root: KeyTable<"escape" | "interrupt"> = new KeyTable<"escape" | "interrupt">([
		{ keys: ["escape"], action: "escape", help: "cancel" },
		{ keys: ["ctrl+c"], action: "interrupt", help: "interrupt", hidden: true },
	]);

	/**
	 * The action of the first binding that holds `key`, or `None`.
	 *
	 * @param key - the key pressed
	 */
	readonly match = (key: UiKey): Option.Option<Action> => {
		for (const binding of this.bindings) {
			if (binding.keys.some((candidate) => bound(candidate, key))) return Option.some(binding.action);
		}
		return Option.none();
	};

	/**
	 * The help rows of every binding not hidden, in order, labelled for `glyphs`: `↑/↓` under Unicode, `up/down`
	 * under ASCII.
	 *
	 * @param glyphs - the glyph set the labels are drawn with
	 */
	readonly help = (glyphs: Cli.GlyphSet): ReadonlyArray<KeyHelpRow> =>
		this.bindings
			.filter((binding) => binding.hidden !== true)
			.map((binding) => ({
				label: binding.keys.map((key) => labelOf(key, glyphs)).join("/"),
				help: binding.help,
			}));
}

/**
 * Read the keys of `table` and dispatch the action each one matches; keys the table does not bind are ignored.
 *
 * @remarks
 * One Ink `useInput` per call, and nothing else reads input.
 *
 * @param table - the keys to read
 * @param dispatch - receives each matched action
 * @param options - whether the keys are read
 *
 * @public
 */
export const useKeys = <Action>(
	table: KeyTable<Action>,
	dispatch: (action: Action) => void,
	options: UseKeysOptions = {},
): void => {
	inkModules().ink.useInput(
		(input, key) => {
			const pressed = UiKey.fromInk(input, key);
			if (pressed === undefined) return;
			const action = table.match(pressed);
			if (Option.isSome(action)) dispatch(action.value);
		},
		{ isActive: options.isActive ?? true },
	);
};
