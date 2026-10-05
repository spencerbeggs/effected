import type { Remediation } from "@effected/engine";
import { Schema } from "effect";
import { ToolFailure } from "./ToolFailure.js";

/**
 * A tool call refused for a reason the caller can fix: the kit's ready-made
 * declared failure, built on {@link ToolFailure.fields}.
 *
 * @remarks
 * Core scrubs every undeclared failure and every defect to one generic
 * internal-error sentence, so a refusal the agent must act on (an unknown id,
 * a missing argument, a precondition) reaches it only when the tool declares
 * it. Declare `ToolRefusal` in the tool's `failure` schema and fail with
 * {@link ToolRefusal.refuse}; its message already carries the remediation,
 * because a declared `Error` failure sends `message` and nothing else.
 *
 * Audit every throw path of a tool: any failure left undeclared loses its
 * message on the wire, however carefully it was worded.
 *
 * **Structured data on a refusal is deliberately unreachable: put it in the
 * message.** Core's `McpServer.registerToolkit` builds every failed call's
 * result with `structuredContent` unset and no `_meta`, on every protocol
 * revision. Under the default `failureMode: "error"` a declared `Error`
 * failure sends `message` as the only text; under `failureMode: "return"`
 * it sends the whole encoded failure JSON-stringified into the text, still
 * with no `structuredContent`, which buries the human message in JSON a
 * client must parse. So `refuse` takes no data argument: a list of valid
 * names, the root that was searched, the id that was not found all belong
 * in `reason`, truncated with {@link ToolFailure.truncate}. When an agent
 * must branch on the data itself, return it on the success channel as an
 * `ok: false` envelope, where `structuredContent` does reach the client.
 *
 * @example
 * ```ts
 * import { ToolFailure, ToolRefusal } from "@effected/mcp";
 * import { Tool } from "effect/ai";
 *
 * const Lookup = Tool.make("lookup", { parameters, success, failure: ToolRefusal })
 * // in the handler:
 * return yield* ToolRefusal.refuse(`No run "${ToolFailure.truncate(id)}".`, { hint: "List runs first.", suggestedTool: "list_runs" })
 * ```
 *
 * @public
 */
export class ToolRefusal extends Schema.TaggedError<ToolRefusal>()("ToolRefusal", ToolFailure.fields) {
	/**
	 * A refusal for `reason`, with `remediation` folded into its message by
	 * {@link ToolFailure.message}. `reason` must already truncate any
	 * caller-supplied value it echoes, with {@link ToolFailure.truncate}.
	 */
	static readonly refuse = (reason: string, remediation: Remediation): ToolRefusal =>
		new ToolRefusal({ message: ToolFailure.message(reason, remediation), remediation });
}
