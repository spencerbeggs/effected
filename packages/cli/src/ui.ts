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
export { CliUi, type CliUiRunOptions, type Screen, type ScreenControl } from "./ui/CliUi.js";
export type { KeyName } from "./ui/UiKey.js";
export { UiStreams, type UiStreamsShape } from "./ui/UiStreams.js";
