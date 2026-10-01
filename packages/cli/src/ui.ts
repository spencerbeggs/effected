/**
 * Interactive screens for a command-line program built on `effect/cli`, drawn with Ink.
 *
 * @remarks
 * `ink` and `react` are optional peers: install them to use this entrypoint. Importing it loads neither; they are
 * loaded when a screen first mounts. The package root never reaches this entrypoint, which a reachability test
 * pins.
 *
 * The root types a screen's signature names (its errors, the theme it requires) are re-exported here as types only,
 * so this entrypoint's declarations are complete; their values stay in the root entrypoint.
 *
 * @packageDocumentation
 */
export type { Cancelled } from "./Cancelled.js";
export type { CliTheme, CliThemeOptions, CliThemeShape, CliThemeTestOptions, StreamTheme } from "./CliTheme.js";
export type { GlyphSet } from "./Glyphs.js";
export type { NotInteractive } from "./NotInteractive.js";
export type { CoreStatusName, Status, StatusDef } from "./Status.js";
export type { NamedColor, Style, TokenName } from "./Token.js";
export { CliUi, type CliUiRunOptions, type Screen, type ScreenControl } from "./ui/CliUi.js";
export { UiStreams, type UiStreamsShape } from "./ui/UiStreams.js";
