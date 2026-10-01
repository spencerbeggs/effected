/**
 * Effect-native environment detection: which agent or CI is running a program, what the terminal can do (colour
 * level, hyperlinks, columns), and which audience the output is for.
 *
 * @remarks
 * Every read goes through `Config`, `Stdio` and `Terminal`, never `process`, so a test swaps the environment with a layer:
 * `CurrentRuntimeEnv.layerTest`, `TerminalEnv.layerTest` and `Audience.layerTest`.
 *
 * @packageDocumentation
 */
export type { AudienceKind, AudienceOptions, AudienceShape } from "./Audience.js";
export { Audience } from "./Audience.js";
export type { ColorLevel } from "./ColorLevel.js";
export { EnvOverride } from "./EnvOverride.js";
export type { CiName, RuntimeEnvOverrides } from "./RuntimeEnv.js";
export { CurrentRuntimeEnv, RuntimeEnv } from "./RuntimeEnv.js";
export type { StreamEnv, TerminalEnvOptions, TerminalEnvShape, TerminalEnvTestOptions } from "./TerminalEnv.js";
export { TerminalEnv } from "./TerminalEnv.js";
