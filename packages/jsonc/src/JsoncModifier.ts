// Structural JSONC modification: compute the edits needed to set, replace or
// delete a value at a path, without mutating the source.
//
// Navigation goes through the scanner-based `internal/navigate.ts`; this
// module owns only edit synthesis and the `JsoncModificationError` it raises on a
// navigation miss; value serialization goes through `Jsonc.stringifyResult`.

import { Effect, Result, Schema } from "effect";
import type { Located } from "./internal/navigate.js";
import { isBlank, isLineBreak, navigate } from "./internal/navigate.js";
import type { JsoncStringifyError } from "./Jsonc.js";
import { Jsonc } from "./Jsonc.js";
import type { JsoncFormattingOptionsLike } from "./JsoncEdit.js";
import { JsoncEdit } from "./JsoncEdit.js";
import type { JsoncPath } from "./JsoncNode.js";

/**
 * Raised when `JsoncModifier.modify` cannot navigate the requested path: the
 * value at `depth` is not the container kind (`expected`) the next path segment
 * requires.
 *
 * - `path` — the full path that was passed to `JsoncModifier.modify`.
 * - `expected` — the container kind (`"object"` or `"array"`) the segment at
 *   `depth` required.
 * - `depth` — the 1-based index into `path` where navigation failed.
 * - `offset` — reserved for a source-position annotation; currently always
 *   omitted (navigation reports the mismatch structurally, without a text
 *   offset).
 *
 * @remarks
 * Follows the structure-preserving-errors house rule — the mismatch's
 * discriminating data is carried as typed fields (`path`, `expected`, `depth`,
 * optional `offset`), not collapsed into a `reason: string`. This mirrors
 * `YamlModificationError`'s posture (its fields differ because the underlying
 * failures differ; the cross-package parity convention binds
 * `Edit`/`Range`/`Path`, not this error).
 *
 * @public
 */
export class JsoncModificationError extends Schema.TaggedError<JsoncModificationError>()("JsoncModificationError", {
	path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
	expected: Schema.Literals(["object", "array"]),
	depth: Schema.Number,
	offset: Schema.optionalKey(Schema.Number),
}) {
	override get message(): string {
		const at = this.offset !== undefined ? ` (offset ${this.offset})` : "";
		return `Modification failed at path [${this.path.join(", ")}]${at}: expected ${this.expected} at depth ${this.depth}`;
	}
}

/**
 * Options for `JsoncModifier.modify`: formatting controls for generated text.
 *
 * @public
 */
export interface JsoncModifyOptions {
	/**
	 * Formatting applied to inserted/replaced content. `tabSize` and
	 * `insertSpaces` set the indentation unit and `eol` the line ending; each
	 * left out is inferred from the document, the unit from its first indented
	 * line (two spaces when there is none) and `eol` from its first line break.
	 * The column a value starts from always comes from its position in the
	 * document. Accepts a `JsoncFormattingOptions` instance or a plain literal
	 * (e.g. `{ insertSpaces: false, tabSize: 2 }`) — see
	 * {@link JsoncFormattingOptionsLike}.
	 */
	readonly formattingOptions?: JsoncFormattingOptionsLike;
}

const startOfBlanks = (text: string, offset: number): number => {
	let start = offset;
	while (start > 0 && isBlank(text.charAt(start - 1))) start--;
	return start;
};

const endOfBlanks = (text: string, offset: number): number => {
	let end = offset;
	while (isBlank(text.charAt(end))) end++;
	return end;
};

/**
 * The unit of indentation a document uses, from its first indented line: a tab,
 * or that line's run of spaces. The `*` of a block comment's continuation line
 * says nothing about the document, so that line is passed over.
 */
const detectIndentUnit = (text: string): string | undefined => {
	const indent = /^(\t+| +)[^\s*]/m.exec(text)?.[1];
	return indent?.startsWith("\t") ? "\t" : indent;
};

/** The document's line ending, from its first line break; `\n` when it has none. */
const detectEol = (text: string): string => {
	const newline = text.indexOf("\n");
	return newline > 0 && text.charAt(newline - 1) === "\r" ? "\r\n" : "\n";
};

/**
 * The edit deleting a located entry. Comma positions come from `navigate`'s
 * scanner tokens, never from searching the raw text, so commas inside comments
 * are invisible here.
 *
 * A container left with nothing in it collapses to `{}` or `[]`. Otherwise an
 * entry that had its line to itself takes the line with it, and a first entry
 * sharing its line gives the blanks after it to whatever follows.
 */
const deletion = (text: string, target: Located): JsoncEdit => {
	const removed = (start: number, end: number) => JsoncEdit.make({ offset: start, length: end - start, content: "" });
	const tokensEnd = target.commaAfter !== undefined ? target.commaAfter + 1 : target.valueEnd;
	if (
		target.commaBefore === undefined &&
		target.close !== undefined &&
		text.slice(target.open + 1, target.keyStart).trim() === "" &&
		text.slice(tokensEnd, target.close).trim() === ""
	) {
		return removed(target.open + 1, target.close);
	}
	const isLater = target.commaBefore !== undefined;
	const start = target.commaBefore ?? target.keyStart;
	const end = isLater ? target.valueEnd : tokensEnd;
	const afterBlanks = endOfBlanks(text, end);
	const lineEnds = afterBlanks === text.length || isLineBreak(text.charAt(afterBlanks));
	if (!lineEnds) {
		return removed(start, isLater ? end : afterBlanks);
	}
	const beforeBlanks = startOfBlanks(text, start);
	const ownsLine = beforeBlanks === 0 || isLineBreak(text.charAt(beforeBlanks - 1));
	if (!ownsLine) {
		return removed(beforeBlanks, afterBlanks);
	}
	const lineBreak = text.startsWith("\r\n", afterBlanks) ? 2 : afterBlanks < text.length ? 1 : 0;
	return removed(beforeBlanks, afterBlanks + lineBreak);
};

/**
 * The edit writing the first entry of the empty container opened at `open` and
 * closed at `close`, replacing whatever whitespace would otherwise be left
 * around the new line. A comment already in the container stays ahead of it.
 */
const openContainer = (
	text: string,
	open: number,
	close: number,
	line: string,
	parentIndent: string,
	eol: string,
): JsoncEdit => {
	const closer = `${line}${eol}${parentIndent}`;
	if (text.slice(open + 1, close).trim() === "") {
		return JsoncEdit.make({ offset: open + 1, length: close - open - 1, content: `${eol}${closer}` });
	}
	const start = startOfBlanks(text, close);
	const closerOwnsLine = start > 0 && isLineBreak(text.charAt(start - 1));
	return JsoncEdit.make({
		offset: start,
		length: close - start,
		content: closerOwnsLine ? closer : `${eol}${closer}`,
	});
};

/**
 * Sets, replaces or deletes a value at a path in JSONC text, as byte-minimal
 * edits that leave comments and formatting elsewhere untouched. Not
 * instantiable.
 *
 * @example
 * ```ts
 * import { JsoncEdit, JsoncModifier } from "@effected/jsonc";
 * import { Effect } from "effect";
 *
 * const text = '{\n  // dev port\n  "port": 3000\n}';
 *
 * const program = Effect.gen(function* () {
 *   const edits = yield* JsoncModifier.modify(text, ["port"], 8080);
 *   return JsoncEdit.applyAll(text, edits);
 *   // => '{\n  // dev port\n  "port": 8080\n}'
 * });
 * ```
 *
 * @public
 */
export class JsoncModifier {
	private constructor() {}

	/**
	 * Compute the edits that set, replace or delete `value` at `path` in `text`,
	 * synchronously. This is the primitive {@link JsoncModifier.modify} is
	 * defined in terms of — a synchronous host (a lint-staged task, a config
	 * file) can call it without an Effect runtime.
	 *
	 * Passing `value === undefined` deletes the target property or element
	 * (including its surrounding comma). A missing insertion target appends after
	 * the last property/element. Any other value is serialized through
	 * {@link Jsonc.stringifyResult}, then placed at its position in the document:
	 * a new member lines up with its last sibling, and a member of an empty
	 * container sits one unit in from the container's line. Every generated line
	 * takes the document's line ending, unless `formattingOptions` says otherwise.
	 *
	 * A delete takes the whole line of an entry that had one to itself, and
	 * collapses a container left with nothing in it to `{}` or `[]`. A comment in
	 * the container survives a delete of its first or only entry.
	 *
	 * @remarks
	 * The error channel carries two failure kinds, kept apart deliberately:
	 * {@link JsoncModificationError} when `path` cannot be navigated, and
	 * {@link JsoncStringifyError} when `value` has no JSON representation (a
	 * circular structure, a `bigint`, or a function or symbol where a value is
	 * written). `JsoncStringifyError` carries no `path` — it is the same error
	 * `Jsonc.stringify` raises for the same value — so a caller that needs the
	 * failing path re-attaches the one it passed.
	 *
	 * Navigation runs before serialization: a path that cannot be navigated
	 * fails with `JsoncModificationError` even when `value` is also
	 * unserializable. A delete (`value === undefined`) never serializes.
	 *
	 * @example
	 * ```ts
	 * import { JsoncEdit, JsoncModifier } from "@effected/jsonc";
	 * import { Result } from "effect";
	 *
	 * const text = '{ "port": 3000 }';
	 * const result = JsoncModifier.modifyResult(text, ["port"], 8080);
	 * if (Result.isSuccess(result)) {
	 *   console.log(JsoncEdit.applyAll(text, result.success)); // => '{ "port": 8080 }'
	 * }
	 * ```
	 *
	 * @param text - The JSONC source to modify.
	 * @param path - The location to set, replace or delete; `[]` replaces the
	 *   whole document.
	 * @param value - The plain JavaScript value to write; `undefined` deletes
	 *   the target instead.
	 * @param options - Optional {@link JsoncModifyOptions} controlling
	 *   formatting of generated content.
	 * @returns A `Result` succeeding with the edits to apply (via
	 *   `JsoncEdit.applyAll`), or failing with {@link JsoncModificationError} or
	 *   {@link JsoncStringifyError}.
	 */
	static modifyResult(
		text: string,
		path: JsoncPath,
		value: unknown,
		options?: JsoncModifyOptions,
	): Result.Result<ReadonlyArray<JsoncEdit>, JsoncModificationError | JsoncStringifyError> {
		const fmt = options?.formattingOptions;
		const hasExplicitUnit = fmt?.tabSize !== undefined || fmt?.insertSpaces !== undefined;
		const indentUnit = hasExplicitUnit
			? fmt?.insertSpaces === false
				? "\t"
				: " ".repeat(fmt?.tabSize ?? 2)
			: (detectIndentUnit(text) ?? "  ");
		const eol = fmt?.eol ?? detectEol(text);
		// Serialize per branch, after navigation, so a navigation mismatch wins
		// over an unserializable value and a delete never serializes at all.
		// stringifyResult emits plain JSON.stringify text; `base` moves every line
		// after the first to the value's position and into the document's eol.
		// Literal newlines cannot occur inside a serialized JSON string, so
		// splitting by line is safe.
		const serialize = (v: unknown, base: string) =>
			Result.map(
				Jsonc.stringifyResult(
					v,
					indentUnit === "\t" ? { insertSpaces: false } : { insertSpaces: true, tabSize: indentUnit.length },
				),
				(serialized) => serialized.split("\n").join(`${eol}${base}`),
			);
		const single = (edit: JsoncEdit): ReadonlyArray<JsoncEdit> => [edit];

		if (path.length === 0) {
			if (value === undefined) {
				return Result.succeed(single(JsoncEdit.make({ offset: 0, length: text.length, content: "" })));
			}
			return Result.map(serialize(value, ""), (content) =>
				single(JsoncEdit.make({ offset: 0, length: text.length, content })),
			);
		}

		const result = navigate(text, path);

		switch (result._tag) {
			case "Mismatch":
				return Result.fail(
					new JsoncModificationError({
						path,
						expected: result.expected,
						depth: result.depth,
					}),
				);

			case "NoOp":
				return Result.succeed([]);

			case "Located": {
				if (value === undefined) {
					return Result.succeed(single(deletion(text, result)));
				}
				return Result.map(serialize(value, result.lineIndent), (content) =>
					single(
						JsoncEdit.make({
							offset: result.valueStart,
							length: result.valueEnd - result.valueStart,
							content,
						}),
					),
				);
			}

			case "Insert": {
				if (value === undefined) {
					return Result.succeed([]);
				}
				const indent = result.memberIndent ?? `${result.parentIndent}${indentUnit}`;
				return Result.map(serialize(value, indent), (serialized) => {
					const member =
						result.container === "object"
							? `${JSON.stringify(String(path[path.length - 1]))}: ${serialized}`
							: serialized;
					if (!result.isFirst) {
						return single(JsoncEdit.make({ offset: result.at, length: 0, content: `,${eol}${indent}${member}` }));
					}
					return single(openContainer(text, result.open, result.at, `${indent}${member}`, result.parentIndent, eol));
				});
			}
		}
	}

	/**
	 * Compute the edits that set, replace or delete `value` at `path` in `text`.
	 *
	 * Passing `value === undefined` deletes the target property or element
	 * (including its surrounding comma). A missing insertion target appends after
	 * the last property/element. Fails with {@link JsoncModificationError} on a
	 * structural mismatch, and with {@link JsoncStringifyError} when `value` has
	 * no JSON representation. Defined in terms of
	 * {@link JsoncModifier.modifyResult} — synchronous callers can use that
	 * variant directly.
	 *
	 * @remarks
	 * `JsoncStringifyError` carries no `path`; see
	 * {@link JsoncModifier.modifyResult} for the failure precedence and why the
	 * two errors stay separate.
	 *
	 * @param text - The JSONC source to modify.
	 * @param path - The location to set, replace or delete; `[]` replaces the
	 *   whole document.
	 * @param value - The plain JavaScript value to write, serialized through
	 *   `Jsonc.stringifyResult`; `undefined` deletes the target instead.
	 * @param options - Optional {@link JsoncModifyOptions} controlling
	 *   formatting of generated content.
	 * @returns An `Effect` that succeeds with the edits to apply (via
	 *   `JsoncEdit.applyAll`), or fails with {@link JsoncModificationError} when
	 *   `path` cannot be navigated or {@link JsoncStringifyError} when `value`
	 *   cannot be serialized.
	 */
	static readonly modify = Effect.fn("JsoncModifier.modify")(
		(text: string, path: JsoncPath, value: unknown, options?: JsoncModifyOptions) =>
			Effect.fromResult(JsoncModifier.modifyResult(text, path, value, options)),
	);
}
