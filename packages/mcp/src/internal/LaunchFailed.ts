import { Runtime } from "effect";

/**
 * The failure `McpStdio.launch` re-raises after reporting a launch failure on
 * stderr itself. `errorReported: false` keeps `runMain` from reporting it a
 * second time — through a logger that writes to stdout — and the original exit
 * code rides along for the teardown.
 *
 * @internal
 */
export class LaunchFailed extends Error {
	readonly [Runtime.errorReported] = false;
	readonly [Runtime.errorExitCode]: number;

	constructor(code: number) {
		super(`the MCP server failed to launch (exit ${code})`);
		this.name = "LaunchFailed";
		this[Runtime.errorExitCode] = code;
	}
}
