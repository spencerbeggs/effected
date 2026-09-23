import { Remediation } from "@effected/engine";
import { Schema } from "effect";

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/**
 * How a tool's declared failure should read on the wire.
 *
 * @remarks
 * Core sends a declared failure that is an `Error` instance — every
 * `Schema.TaggedError` is — as `isError: true` with `error.message` as the only
 * text and no `structuredContent` (effect `unstable/ai/McpServer.ts`,
 * `declaredFailureResult`). So the remediation must be folded into `message`
 * when the error is constructed: whatever is not in the message never reaches
 * the agent.
 *
 * Spread {@link ToolFailure.fields} into your tool's `Schema.TaggedError`, build
 * `message` with {@link ToolFailure.message}, and pass every caller-supplied
 * value through {@link ToolFailure.truncate} before echoing it.
 *
 * @example
 * ```ts
 * class NotFound extends Schema.TaggedError<NotFound>()("NotFound", { ...ToolFailure.fields, id: Schema.String }) {}
 * const remediation = { hint: "List the ids first.", suggestedTool: "list_things" }
 * new NotFound({ id, remediation, message: ToolFailure.message(`No thing "${ToolFailure.truncate(id)}".`, remediation) })
 * ```
 *
 * @public
 */
export class ToolFailure {
	private constructor() {}

	/** The cap, in UTF-16 code units, on a caller-supplied value echoed into a message. */
	static readonly ECHO_LIMIT: number = 200;

	/** The larger cap for a value the engine produced (a path, a diagnostic), not one a caller typed. */
	static readonly ENGINE_ECHO_LIMIT: number = 2000;

	/** The `message` and `remediation` fields to spread into a consumer's `Schema.TaggedError`. */
	static readonly fields = { message: Schema.String, remediation: Remediation } as const;

	/**
	 * `"<raw> <hint> Try <suggestedTool>."`, dropping any empty part, so a
	 * missing tool or an empty hint never leaves a double space.
	 */
	static readonly message = (raw: string, remediation: Remediation): string =>
		[raw, remediation.hint, remediation.suggestedTool === undefined ? "" : `Try ${remediation.suggestedTool}.`]
			.filter((part) => part !== "")
			.join(" ");

	/**
	 * `value` cut to `limit` code units with a trailing ellipsis, backing off one
	 * unit rather than splitting a surrogate pair. A hostile multi-megabyte
	 * argument is otherwise echoed into the agent's context whole.
	 */
	static readonly truncate = (value: string, limit: number = ToolFailure.ECHO_LIMIT): string => {
		if (value.length <= limit) return value;
		const end = limit > 0 && isHighSurrogate(value.charCodeAt(limit - 1)) ? limit - 1 : limit;
		return `${value.slice(0, end)}…`;
	};
}
