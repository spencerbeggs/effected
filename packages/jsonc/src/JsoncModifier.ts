// Structural JSONC modification: compute the edits needed to set, replace or
// delete a value at a path, without mutating the source.
//
// Navigation goes through the scanner-based `internal/navigate.ts`; this
// module owns only edit synthesis and the `JsoncModificationError` it raises on a
// navigation miss; value serialization goes through `Jsonc.stringifyResult`.

import { Effect, Result, Schema } from "effect";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";
import type { Insert, Located } from "./internal/navigate.js";
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
 * - `limit` — present only when `createParents` would nest deeper than the
 *   parser's cap: the cap (256 levels), with `depth` the first level past it.
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
	limit: Schema.optionalKey(Schema.Number),
}) {
	override get message(): string {
		const at = this.offset !== undefined ? ` (offset ${this.offset})` : "";
		if (this.limit !== undefined) {
			return `Modification failed at path [${this.path.join(", ")}]${at}: nesting would exceed ${this.limit} levels at depth ${this.depth}`;
		}
		return `Modification failed at path [${this.path.join(", ")}]${at}: expected ${this.expected} at depth ${this.depth}`;
	}
}

/**
 * Options for `JsoncModifier.modify`: formatting controls for generated text,
 * where a new object member goes, and whether missing ancestors are created.
 *
 * @public
 */
export interface JsoncModifyOptions {
	/**
	 * Formatting applied to inserted/replaced content. `tabSize` and
	 * `insertSpaces` decide the indentation unit together: give either and the
	 * document is not consulted for it, so `insertSpaces: false` is a tab and
	 * otherwise the unit is `tabSize` spaces, two when `tabSize` is left out.
	 * Give neither and the unit comes from the document's first indented line,
	 * or two spaces when there is none. `eol` is separate, and left out comes
	 * from the document's first line break. The column a value starts from always
	 * comes from its position in the document. Accepts a `JsoncFormattingOptions`
	 * instance or a plain literal (e.g. `{ insertSpaces: false, tabSize: 2 }`) —
	 * see {@link JsoncFormattingOptionsLike}.
	 */
	readonly formattingOptions?: JsoncFormattingOptionsLike;
	/**
	 * Place the new object member directly after this sibling, a key of the
	 * object receiving it. Appended as usual when the object has no such key. Has
	 * no effect on a replace, a delete, or an array. With
	 * {@link JsoncModifyOptions.createParents}, the member being inserted is the
	 * outermost created key and the object receiving it is the deepest one that
	 * exists, so `["catalogs", "silk", "effect"]` with `insertAfter: "workspaces"`
	 * puts `catalogs` directly after `workspaces`.
	 *
	 * The sibling keeps a comment trailing it on its own line, however the comma
	 * falls. A sibling sharing its line with something other than a comment keeps
	 * the plain insert shape: the new member opens a line straight after the
	 * sibling's value, and whatever followed the value follows the new member.
	 * So `{ "a": 1, "b": 2 }` after `a` gives `{ "a": 1,\n  "k": 9, "b": 2 }`.
	 */
	readonly insertAfter?: string;
	/**
	 * Create missing object ancestors of the target. Off by default, when a
	 * missing ancestor fails with {@link JsoncModificationError}. An ancestor that
	 * exists with the wrong type still fails and is never overwritten, a numeric
	 * segment under a missing ancestor still fails (`expected: "array"`), because
	 * arrays are never invented, and so does a missing array element. A delete
	 * under a missing ancestor succeeds with no edits. A path that would nest
	 * deeper than `Jsonc.parse` accepts (256 levels, counting the existing
	 * container plus every created one) fails with {@link JsoncModificationError}
	 * carrying `limit` and the first `depth` past it, leaving the text untouched.
	 */
	readonly createParents?: boolean;
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
 * Where the comments trailing an entry end, reading from `from`: the end of the
 * line they close, or undefined when something else shares that line. A line
 * comment stops at any line break the scanner honours, U+2028 and U+2029 too,
 * so what follows one of those is not mistaken for comment text.
 */
const endOfTrailingComments = (text: string, from: number): number | undefined => {
	const endsComment = (char: string) => isLineBreak(char) || char === "\u2028" || char === "\u2029";
	let at = endOfBlanks(text, from);
	while (text.startsWith("/*", at) || text.startsWith("//", at)) {
		if (text.startsWith("/*", at)) {
			const close = text.indexOf("*/", at + 2);
			at = close === -1 ? text.length : close + 2;
		} else {
			while (at < text.length && !endsComment(text.charAt(at))) at++;
		}
		at = endOfBlanks(text, at);
	}
	return at === text.length || endsComment(text.charAt(at)) ? at : undefined;
};

/**
 * The edits writing `line` as a new entry after an existing one, leaving the
 * comments trailing that entry on its side of the new line.
 *
 * With no comma on the entry's line, the comma goes straight after the value
 * and the new line after the comments, which takes two edits when there are
 * any. With a comma on the line, the new line goes after the comments and takes
 * the comma that separates it from whatever comes next. When something else
 * shares the line there is no line end to use: the new line opens at the value.
 */
const afterEntry = (text: string, target: Insert, line: string, eol: string): ReadonlyArray<JsoncEdit> => {
	const inserted = (offset: number, content: string) => JsoncEdit.make({ offset, length: 0, content });
	const plain = inserted(target.at, `,${eol}${line}`);
	const lineEnd = endOfTrailingComments(text, target.at);
	if (lineEnd !== undefined) {
		return text.slice(target.at, lineEnd).trim() === ""
			? [plain]
			: [inserted(target.at, ","), inserted(lineEnd, `${eol}${line}`)];
	}
	if (target.commaAfter === undefined) {
		return [plain];
	}
	const afterComma = endOfTrailingComments(text, target.commaAfter + 1);
	return afterComma === undefined ? [plain] : [inserted(afterComma, `${eol}${line},`)];
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
	 * the last property/element, or after the sibling named by `insertAfter`. Any
	 * other value is serialized through {@link Jsonc.stringifyResult}, then placed
	 * at its position in the document: a new member lines up with the sibling it
	 * follows and leaves that sibling's trailing comment with it, and a member of
	 * an empty container sits one unit in from the container's line. Every
	 * generated line takes the document's line ending, unless `formattingOptions`
	 * says otherwise. An inline container keeps a plain shape: a new member opens
	 * its own line at the sibling's value, carrying along whatever followed it.
	 *
	 * A delete takes the whole line of an entry that had one to itself, and
	 * collapses a container left with nothing in it to `{}` or `[]`. It removes
	 * the comments inside what it cuts: those between the entry's key and its
	 * comma and, for an entry after the first, everything back to the preceding
	 * comma, which takes in a comment trailing the previous member and any comment
	 * on a line above the entry. Comments outside that range stay.
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
	 *   formatting of generated content, where a new member goes, and whether
	 *   missing ancestors are created.
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

		const result = navigate(text, path, options?.insertAfter);

		// Write `entry` into the container `target` resolved to.
		const insertEntry = (target: Insert, key: string | undefined, entry: unknown) => {
			const indent = target.memberIndent ?? `${target.parentIndent}${indentUnit}`;
			return Result.map(serialize(entry, indent), (serialized) => {
				const line = `${indent}${key === undefined ? "" : `${JSON.stringify(key)}: `}${serialized}`;
				return target.isFirst
					? single(openContainer(text, target.open, target.at, line, target.parentIndent, eol))
					: afterEntry(text, target, line, eol);
			});
		};

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

			case "MissingAncestor": {
				const failure = (depth: number, expected: "object" | "array") =>
					Result.fail(new JsoncModificationError({ path, expected, depth }));
				const below = path.slice(result.segmentIndex + 1);
				if (options?.createParents !== true) {
					// The segment after the missing one is the first to fail: the
					// shape every caller has always seen for a path that runs out.
					return failure(result.segmentIndex + 2, typeof below[0] === "string" ? "object" : "array");
				}
				if (value === undefined) {
					return Result.succeed([]);
				}
				// Created objects nest one level per path segment: a deeper document
				// would be one `Jsonc.parse` refuses.
				if (path.length > MAX_NESTING_DEPTH) {
					return Result.fail(
						new JsoncModificationError({
							path,
							expected: "object",
							depth: MAX_NESTING_DEPTH + 1,
							limit: MAX_NESTING_DEPTH,
						}),
					);
				}
				const numeric = below.findIndex((segment) => typeof segment !== "string");
				if (numeric !== -1) {
					return failure(result.segmentIndex + numeric + 2, "array");
				}
				// Check the value by itself first: wrapped in an object, a function
				// or symbol would be dropped by JSON semantics instead of refused.
				return Result.flatMap(serialize(value, ""), () =>
					insertEntry(
						{ ...result, _tag: "Insert", container: "object" },
						String(path[result.segmentIndex]),
						below.reduceRight<unknown>((nested, segment) => ({ [segment]: nested }), value),
					),
				);
			}

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
				return insertEntry(result, result.container === "object" ? String(path[path.length - 1]) : undefined, value);
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
	 *   formatting of generated content, where a new member goes, and whether
	 *   missing ancestors are created.
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
