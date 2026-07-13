/**
 * The command-line interface for `@effected/runtimes`.
 *
 * Resolves Node.js, Bun and Deno versions and prints a JSON envelope, so a CI
 * job can pipe it into `jq` and pick out a version to install.
 *
 * The command is exported so that it can be embedded or driven with an explicit
 * argument vector (`Command.runWith`), which is how it is tested — the v3 CLI
 * could only be exercised by spawning a process.
 *
 * @example
 * ```ts
 * import { command } from "@effected/runtime-resolver-cli";
 * import { Command } from "effect/unstable/cli";
 *
 * const run = Command.runWith(command, { version: "1.0.0" });
 * // run(["--node", ">=20", "--pretty"])
 * ```
 *
 * @packageDocumentation
 */

export { command } from "./Cli.js";
export {
	CliErrorDetail,
	CliResponse,
	CliRuntimeFailure,
	CliRuntimeResult,
	CliRuntimeSuccess,
	serializeError,
} from "./CliResponse.js";
