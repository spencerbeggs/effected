/**
 * The named keys a screen understands and a test can press.
 *
 * @remarks
 * Letters, digits and punctuation are not named: they arrive as typed text.
 *
 * @public
 */
export type KeyName =
	| "up"
	| "down"
	| "left"
	| "right"
	| "enter"
	| "space"
	| "tab"
	| "shift+tab"
	| "backspace"
	| "delete"
	| "escape"
	| "ctrl+c"
	| "home"
	| "end"
	| "pageup"
	| "pagedown";
