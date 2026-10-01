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
 * stack trace would only alarm. A consumer `render` still overrides the line, and can hand off to it: the line is
 * the error's `message`, so `error.message` and `String(error)` carry it.
 *
 * @public
 */
export class Cancelled extends Schema.TaggedError<Cancelled>()("Cancelled", {
	reason: Schema.Literals(["escape", "interrupt"]),
}) {
	/**
	 * The one line, `cancelled; nothing written`.
	 *
	 * @remarks
	 * A prototype getter, not a field, so it is not part of the encoded form, equality or a JSON dump.
	 */
	override get message(): string {
		return "cancelled; nothing written";
	}

	/**
	 * The process exit code: `130`.
	 *
	 * @remarks
	 * A prototype getter rather than an own field, so a JSON or logger dump of the error does not carry the
	 * runtime marker.
	 */
	get [Runtime.errorExitCode](): number {
		return 130;
	}
}
