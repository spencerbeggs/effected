import { Runtime, Schema } from "effect";

/**
 * A person backed out of an interactive prompt: they pressed escape, or the
 * prompt was interrupted.
 *
 * @remarks
 * Exits `130`, the conventional status for a run ended by the user, through
 * core's own `Runtime.errorExitCode` marker, so `CliRuntime.reportFailures`
 * keeps it. Its default rendering is one line, `cancelled; nothing written`,
 * because nothing has been written by the time a prompt is cancelled and a
 * stack trace would only alarm. A consumer `render` still overrides the line.
 *
 * @public
 */
export class Cancelled extends Schema.TaggedError<Cancelled>()("Cancelled", {
	reason: Schema.Literals(["escape", "interrupt"]),
}) {
	/** The process exit code: `130`. */
	readonly [Runtime.errorExitCode] = 130;
}
