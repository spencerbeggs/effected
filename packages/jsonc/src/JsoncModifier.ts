// Structural JSONC modification: compute the edits needed to set, replace or
// delete a value at a path, without mutating the source.
//
// Navigation goes through the scanner-based `internal/navigate.ts`; this
// module owns only edit synthesis and the `JsoncModificationError` it raises on a
// navigation miss; value serialization goes through `Jsonc.stringifyResult`.

import { Effect, Result, Schema } from "effect";
import { navigate } from "./internal/navigate.js";
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
	 * Formatting applied to inserted/replaced content (indentation, EOL,
	 * spacing). Accepts a `JsoncFormattingOptions` instance or a plain literal
	 * (e.g. `{ insertSpaces: false, tabSize: 2 }`) — see
	 * {@link JsoncFormattingOptionsLike}.
	 */
	readonly formattingOptions?: JsoncFormattingOptionsLike;
}

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
	 * {@link Jsonc.stringifyResult} with the indentation of `formattingOptions`.
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
		const tabSize = fmt?.tabSize ?? 2;
		const insertSpaces = fmt?.insertSpaces ?? true;
		const eol = fmt?.eol ?? "\n";
		const indentUnit = insertSpaces ? " ".repeat(tabSize) : "\t";
		// Serialize per branch, after navigation, so a navigation mismatch wins
		// over an unserializable value and a delete never serializes at all.
		// stringifyResult maps insertSpaces: false to a tab indent, so the tab
		// unit is honored in generated content, not just in the gaps.
		const serialize = (v: unknown) => Jsonc.stringifyResult(v, { tabSize, insertSpaces });
		const single = (edit: JsoncEdit): ReadonlyArray<JsoncEdit> => [edit];

		if (path.length === 0) {
			if (value === undefined) {
				return Result.succeed(single(JsoncEdit.make({ offset: 0, length: text.length, content: "" })));
			}
			return Result.map(serialize(value), (content) =>
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
					// Comma positions come from navigate()'s scanner tokens, never from
					// searching the raw text — commas inside comments are invisible here.
					let removeStart = result.keyStart;
					let removeEnd = result.valueEnd;
					if (result.commaBefore !== undefined) {
						removeStart = result.commaBefore;
					} else if (result.commaAfter !== undefined) {
						removeEnd = result.commaAfter + 1;
					}
					return Result.succeed(
						single(JsoncEdit.make({ offset: removeStart, length: removeEnd - removeStart, content: "" })),
					);
				}
				return Result.map(serialize(value), (content) =>
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
				return Result.map(serialize(value), (serialized) => {
					const indent = indentUnit.repeat(result.depth);
					const outdent = indentUnit.repeat(result.depth - 1);
					if (result.container === "object") {
						const key = JSON.stringify(String(path[path.length - 1]));
						const insertText = result.isFirst
							? `${eol}${indent}${key}: ${serialized}${eol}${outdent}`
							: `,${eol}${indent}${key}: ${serialized}`;
						return single(JsoncEdit.make({ offset: result.at, length: 0, content: insertText }));
					}
					const insertText = result.isFirst
						? `${eol}${indent}${serialized}${eol}${outdent}`
						: `,${eol}${indent}${serialized}`;
					return single(JsoncEdit.make({ offset: result.at, length: 0, content: insertText }));
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
