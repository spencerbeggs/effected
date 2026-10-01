import { Runtime } from "effect";

/**
 * The failure `McpStdio.launch` re-raises after reporting a launch failure on
 * stderr itself. `errorReported: false` keeps `runMain` from reporting it a
 * second time — through a logger that writes to stdout — and the original exit
 * code rides along for the teardown.
 *
 * @remarks
 * Both runtime markers are prototype getters rather than own fields, so a JSON
 * or logger dump of the error does not carry them; the code lives in a private
 * field.
 *
 * @internal
 */
export class LaunchFailed extends Error {
	readonly #code: number;

	constructor(code: number) {
		super(`the MCP server failed to launch (exit ${code})`);
		this.name = "LaunchFailed";
		this.#code = code;
	}

	/** Already reported on stderr: `runMain` must not report it again. */
	get [Runtime.errorReported](): boolean {
		return false;
	}

	/** The exit code the launch failed with. */
	get [Runtime.errorExitCode](): number {
		return this.#code;
	}
}
