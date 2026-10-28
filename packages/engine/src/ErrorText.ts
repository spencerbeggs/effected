import { Predicate } from "effect";
import { causeMessage } from "./internal/causeMessage.js";

const describe = (value: unknown): string => {
	if (Predicate.isString(value)) return value;
	if (value === undefined || value === null) return String(value);
	if (typeof value !== "object" && typeof value !== "function") return String(value);
	try {
		if (Predicate.hasProperty(value, "message") && Predicate.isString(value.message)) return value.message;
	} catch {
		// A throwing `message` getter: describe the value some other way.
	}
	try {
		const json = JSON.stringify(value);
		if (json !== undefined) return json;
	} catch {
		// A cycle or a bigint: fall through to String.
	}
	try {
		return String(value);
	} catch {
		return "[unprintable value]";
	}
};

/**
 * Any value as error text, without ever throwing: the one implementation every front end of a tool uses, so a CLI and
 * an MCP server describe the same failure with the same words.
 *
 * @remarks
 * Every member is pure and total. None sanitises its result: text read from a value you do not control may carry
 * escape sequences, so sanitise it before printing it to a terminal. `@effected/cli` publishes the same functions as
 * `Fmt.describe`, `Fmt.causeMessage` and `Fmt.errorText`, which delegate here.
 *
 * The anti-pattern this replaces is the per-site fallback `error instanceof Error ? error.message : String(error)`:
 * it misses an error from another realm and a plain `{ message }` object, reads nothing along the `cause` chain, and
 * throws on a value whose `toString` throws or which has no prototype.
 *
 * @example
 * ```ts
 * import { ErrorText } from "@effected/engine"
 *
 * const failure = new Error("Failed to execute statement", { cause: new Error("SQLITE_BUSY: database is locked") })
 * console.log(ErrorText.of(failure))
 * // => "Failed to execute statement: SQLITE_BUSY: database is locked"
 * console.log(ErrorText.of({ code: 7 }))
 * // => "{\"code\":7}"
 * ```
 *
 * @public
 */
export class ErrorText {
	private constructor() {}

	/**
	 * Any value as text, without ever throwing.
	 *
	 * @remarks
	 * A string is itself; a number, boolean, bigint or symbol is `String(value)`; `undefined` and `null` are
	 * `"undefined"` and `"null"`. A value with a string `message` (an `Error`, one from another realm, a plain
	 * `{ message }`) is that message, even an empty one. Anything else is its JSON, or `String(value)` when it has none
	 * (a cycle, a function), or `"[unprintable value]"` when that throws too. A getter that throws is a value with no
	 * message.
	 *
	 * For the messages along an error's `cause` chain, use {@link ErrorText.causeMessage}; for the two combined, use
	 * {@link ErrorText.of}.
	 *
	 * @param value - the value
	 */
	static readonly describe: (value: unknown) => string = describe;

	/**
	 * Every distinct non-empty message along a value's `cause` chain, nearest first and joined with `: `, or
	 * `undefined` when nothing along it has one.
	 *
	 * @remarks
	 * The kit's one guarded cause-message read, the one its own errors render a preserved cause with. A node's message
	 * is a thrown string or a non-empty string `message` property, read without `instanceof Error`, so an error from
	 * another realm or a plain `{ message }` object counts. A deeper message the joined text already contains is not
	 * repeated, and one that contains the joined text replaces it, so a `SqlError` wrapping SQLite's own text reads
	 * `Failed to execute statement: SQLITE_BUSY: database is locked`. It is the whole chain, not the innermost message
	 * alone. The walk stops after eight nodes, so a cyclic chain terminates.
	 *
	 * Never throws: a `message` getter that throws leaves that node without text, and a `cause` getter that throws ends
	 * the walk with the text found so far, `undefined` when there is none.
	 *
	 * @param value - the error, or whatever was thrown
	 */
	static readonly causeMessage: (value: unknown) => string | undefined = causeMessage;

	/**
	 * The text of an unknown failure: {@link ErrorText.causeMessage} when the chain carries a message, otherwise
	 * {@link ErrorText.describe}.
	 *
	 * @remarks
	 * Exactly `ErrorText.causeMessage(value) ?? ErrorText.describe(value)`, the fallback every I/O site would otherwise
	 * spell out by hand. An error whose message is empty and whose chain carries none is `""`, as `describe` reads it.
	 * Never throws.
	 *
	 * @param value - the error, or whatever was thrown
	 */
	static readonly of = (value: unknown): string => causeMessage(value) ?? describe(value);
}
