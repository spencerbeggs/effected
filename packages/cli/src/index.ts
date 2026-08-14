/**
 * The boundary layer of a command-line program built on `effect/unstable/cli`:
 * how output reaches a human, how a failure is reported, and how a schema issue
 * becomes a sentence someone can act on.
 *
 * This is emphatically **not** a CLI framework. `effect/unstable/cli` owns
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

export { CliLogger, type CliLoggerOptions } from "./CliLogger.js";
export { CliRuntime, type ReportFailuresOptions } from "./CliRuntime.js";
export { ConfigIssueRenderer } from "./ConfigIssueRenderer.js";
export { SchemaIssueRenderer } from "./SchemaIssueRenderer.js";
