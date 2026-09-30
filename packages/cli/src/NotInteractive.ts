import { Runtime, Schema } from "effect";

/**
 * A command needed to prompt, but there is no terminal to prompt on.
 *
 * @remarks
 * Exits `64` (BSD `EX_USAGE`) through core's `Runtime.errorExitCode` marker:
 * the caller invoked the command the wrong way, so the fix is to run it in a
 * terminal or pass the flag that supplies the answer. Its default rendering is
 * one line, `not interactive: run in a terminal or pass the flag`.
 *
 * @public
 */
export class NotInteractive extends Schema.TaggedError<NotInteractive>()("NotInteractive", {}) {
	/**
	 * The process exit code: `64`.
	 *
	 * @remarks
	 * A prototype getter rather than an own field, so a JSON or logger dump of the error does not carry the
	 * runtime marker. It is the error's own code, so `CliRuntime`'s `usageExitCode` option does not change it.
	 */
	get [Runtime.errorExitCode](): number {
		return 64;
	}
}
