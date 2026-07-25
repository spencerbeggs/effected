/**
 * Structured command running and CLI tool discovery over Effect core's
 * `ChildProcessSpawner` contract.
 *
 * @remarks
 * This package owns no subprocess vocabulary and no spawner backend. Commands
 * are core `ChildProcess.Command` values, built with core's own constructors
 * and combinators; the spawner arrives through the `R` channel and the
 * application provides a platform layer once at the edge. What this package
 * adds is the *outcome* (collected output, typed failure), the *policy*
 * (timeout, redaction, transience) and the *tool* (discovery, version, source).
 *
 * @example
 * ```ts
 * import { LocalExec, Run, Tool, ToolDiscovery } from "@effected/commands";
 * import { NodeServices } from "@effect/platform-node";
 * import { Effect, Layer } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* ToolDiscovery;
 *   const biome = yield* discovery.resolve(Tool.named("biome"));
 *   return yield* Run.text(biome.command("check", "."));
 * });
 *
 * const AppLayer = ToolDiscovery.layer.pipe(
 *   Layer.provide(LocalExec.layerFor("pnpm", { directory: "/repo" })),
 *   Layer.provide(NodeServices.layer),
 * );
 *
 * const runnable = program.pipe(Effect.provide(AppLayer));
 * ```
 *
 * @packageDocumentation
 */

export type { LocalExecShape } from "./LocalExec.js";
export { ExecContext, Launcher, LocalExec, LocalExecError } from "./LocalExec.js";
export { REDACTED, Redaction, SECRET_FLAGS } from "./Redaction.js";
export { Retry, TRANSIENT_PATTERNS } from "./Retry.js";
export type { RunOptions } from "./Run.js";
export { CommandFailedError, CommandOutput, CommandOutputError, DEFAULT_MAX_OUTPUT_BYTES, Run } from "./Run.js";
export { MismatchPolicy, Tool, ToolSource, VersionFlag, VersionJson, VersionNone, VersionProbe } from "./Tool.js";
export type { ToolDiscoveryShape, ToolResolutionFailure } from "./ToolDiscovery.js";
export {
	ResolvedSource,
	ResolvedTool,
	ToolDiscovery,
	ToolNotFoundError,
	ToolRefusedError,
	ToolVersionMismatchError,
} from "./ToolDiscovery.js";
