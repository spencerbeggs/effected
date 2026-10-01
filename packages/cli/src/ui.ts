/**
 * Interactive screens for a command-line program built on `effect/cli`, drawn with Ink.
 *
 * @remarks
 * `ink` and `react` are optional peers: install them to use this entrypoint. Importing it loads neither; they are
 * loaded when a screen first mounts. The package root never reaches this entrypoint, which a reachability test
 * pins.
 *
 * @packageDocumentation
 */
export { CliUi, type CliUiPromptOptions, type CliUiRunOptions, type Screen, type ScreenControl } from "./ui/CliUi.js";
export {
	Confirm,
	type ConfirmAction,
	type ConfirmInitOptions,
	type ConfirmResult,
	type ConfirmScreenOptions,
	type ConfirmState,
	type ConfirmToggle,
	type ConfirmViewProps,
} from "./ui/Confirm.js";
export { KeyHelp, type KeyHelpProps } from "./ui/KeyHelp.js";
export { type Binding, type KeyHelpRow, KeyTable, type UseKeysOptions, useKeys } from "./ui/KeyTable.js";
export {
	MultiSelect,
	type MultiSelectAction,
	type MultiSelectInitOptions,
	type MultiSelectItem,
	type MultiSelectScreenOptions,
	type MultiSelectSection,
	type MultiSelectState,
	type MultiSelectViewProps,
} from "./ui/MultiSelect.js";
export {
	Select,
	type SelectAction,
	type SelectChoice,
	type SelectInitOptions,
	type SelectScreenOptions,
	type SelectState,
	type SelectViewProps,
} from "./ui/Select.js";
export { type Tab, Tabs, type TabsAction, type TabsProps } from "./ui/Tabs.js";
export {
	TextInput,
	type TextInputInitOptions,
	type TextInputScreenOptions,
	type TextInputState,
	type TextInputViewProps,
} from "./ui/TextInput.js";
export { Toggle, type ToggleViewProps } from "./ui/Toggle.js";
export { type KeyName, UiKey } from "./ui/UiKey.js";
export { UiStreams, type UiStreamsShape } from "./ui/UiStreams.js";
export {
	type InkTextProps,
	Styled,
	type StyledProps,
	type TerminalSize,
	inkProps,
	useGlyphs,
	useTerminalSize,
	useTheme,
} from "./ui/UiTheme.js";
export {
	Viewport,
	type ViewportMove,
	type ViewportRow,
	type ViewportState,
	type ViewportViewProps,
} from "./ui/Viewport.js";
