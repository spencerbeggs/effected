/**
 * The boundary layer of a command-line program built on `effect/cli`:
 * how output reaches a human, how a failure is reported, and how a schema issue
 * becomes a sentence someone can act on.
 *
 * This is emphatically **not** a CLI framework. `effect/cli` owns
 * argument parsing, flags, the command tree and help; this package must never
 * grow a second one.
 *
 * What everything here has in common: **a consumer only discovers the need by
 * shipping bad output to a person.** None of it fails a type-check, a test, or
 * a review of the code in isolation — the default behaviour is wrong in a way
 * the author cannot see from the call site.
 *
 * @example
 * ```ts
 * import { CliLogger, CliRuntime } from "@effected/cli"
 * import { NodeRuntime } from "@effect/platform-node"
 * import { Effect, Layer } from "effect"
 *
 * const MainLive = Layer.mergeAll(AppLive, CliLogger.layer())
 *
 * NodeRuntime.runMain(program.pipe(CliRuntime.reportFailures(), Effect.provide(MainLive)))
 * ```
 *
 * @packageDocumentation
 */

export { Cancelled } from "./Cancelled.js";
export { type AudienceFlagInput, CliAudience, type CliAudienceFlagsOptions } from "./CliAudience.js";
export { CliColor } from "./CliColor.js";
export { CliExit, type CliExitShape } from "./CliExit.js";
export { CliInteractive } from "./CliInteractive.js";
export { CliLogger, type CliLoggerOptions } from "./CliLogger.js";
export { CliRuntime, type FailureDetails, type MainOptions, type ReportFailuresOptions } from "./CliRuntime.js";
export { CliTheme, type CliThemeOptions, type CliThemeShape, type CliThemeTestOptions } from "./CliTheme.js";
export { ConfigIssueRenderer } from "./ConfigIssueRenderer.js";
export { Fmt, type PercentOptions, type TruncateOptions } from "./Fmt.js";
export { type GlyphSet, Glyphs } from "./Glyphs.js";
export { NotInteractive } from "./NotInteractive.js";
export { SchemaIssueRenderer } from "./SchemaIssueRenderer.js";
export { type CoreStatusName, Status, type StatusDef } from "./Status.js";
export { type NamedColor, type Style, Token, type TokenName } from "./Token.js";
