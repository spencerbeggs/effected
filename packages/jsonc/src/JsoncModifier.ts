/**
 * Structural JSONC modification: compute the edits needed to set, replace or
 * delete a value at a path, without mutating the source.
 *
 * Navigation goes through the scanner-based `internal/navigate.ts` (a
 * correctness fix over v3's fragile string search); this module owns only edit
 * synthesis and the {@link JsoncModificationError} it raises on a navigation
 * miss or invalid edit.
 *
 * @packageDocumentation
 */

import type { Cause } from "effect";
import { Effect, Schema } from "effect";
import { navigate } from "./internal/navigate.js";
import type { JsoncFormattingOptions } from "./JsoncEdit.js";
import { JsoncEdit } from "./JsoncEdit.js";
import type { JsoncPath } from "./JsoncNode.js";

/**
 * Schema-generated base class backing {@link JsoncModificationError}. Not meant
 * to be referenced directly — named and exported only so API Extractor can
 * resolve the heritage clause of the class it backs.
 *
 * @public
 */
export const JsoncModificationError_base: Schema.Class<
	JsoncModificationError,
	Schema.TaggedStruct<
		"JsoncModificationError",
		{
			readonly path: Schema.$Array<Schema.Union<readonly [typeof Schema.String, typeof Schema.Number]>>;
			readonly reason: typeof Schema.String;
			readonly offset: Schema.optionalKey<typeof Schema.Number>;
		}
	>,
	Cause.YieldableError
> = Schema.TaggedErrorClass<JsoncModificationError>()("JsoncModificationError", {
	path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
	reason: Schema.String,
	offset: Schema.optionalKey(Schema.Number),
});

/**
 * Raised when `JsoncModifier.modify` cannot navigate the requested path (a
 * structural mismatch) or would produce an invalid edit.
 *
 * @public
 */
export class JsoncModificationError extends JsoncModificationError_base {
	override get message(): string {
		const at = this.offset !== undefined ? ` (offset ${this.offset})` : "";
		return `Modification failed at path [${this.path.join(", ")}]${at}: ${this.reason}`;
	}
}

/**
 * Options for `JsoncModifier.modify`: formatting controls for generated text.
 *
 * @public
 */
export interface JsoncModifyOptions {
	readonly formattingOptions?: JsoncFormattingOptions;
}

/**
 * Structural JSONC modification statics. Not instantiable.
 *
 * @public
 */
export class JsoncModifier {
	private constructor() {}

	/**
	 * Compute the edits that set, replace or delete `value` at `path` in `text`.
	 *
	 * Passing `value === undefined` deletes the target property or element
	 * (including its surrounding comma). A missing insertion target appends after
	 * the last property/element. Fails with {@link JsoncModificationError} on a
	 * structural mismatch.
	 */
	static readonly modify = Effect.fn("JsoncModifier.modify")(function* (
		text: string,
		path: JsoncPath,
		value: unknown,
		options?: JsoncModifyOptions,
	) {
		const fmt = options?.formattingOptions;
		const tabSize = fmt?.tabSize ?? 2;
		const insertSpaces = fmt?.insertSpaces ?? true;
		const eol = fmt?.eol ?? "\n";
		const indentUnit = insertSpaces ? " ".repeat(tabSize) : "\t";
		// JSON.stringify accepts a string indent — pass the tab unit through so
		// insertSpaces: false is honored in generated content, not just gaps.
		const jsonIndent: string | number = insertSpaces ? tabSize : "\t";

		if (path.length === 0) {
			const content = value === undefined ? "" : JSON.stringify(value, null, jsonIndent);
			return [JsoncEdit.make({ offset: 0, length: text.length, content })] as ReadonlyArray<JsoncEdit>;
		}

		const result = navigate(text, path);

		switch (result._tag) {
			case "Mismatch":
				return yield* new JsoncModificationError({
					path,
					reason: `expected ${result.expected} at depth ${result.depth}`,
				});

			case "NoOp":
				return [] as ReadonlyArray<JsoncEdit>;

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
					return [
						JsoncEdit.make({ offset: removeStart, length: removeEnd - removeStart, content: "" }),
					] as ReadonlyArray<JsoncEdit>;
				}
				const serialized = JSON.stringify(value, null, jsonIndent);
				return [
					JsoncEdit.make({
						offset: result.valueStart,
						length: result.valueEnd - result.valueStart,
						content: serialized,
					}),
				] as ReadonlyArray<JsoncEdit>;
			}

			case "Insert": {
				if (value === undefined) {
					return [] as ReadonlyArray<JsoncEdit>;
				}
				const serialized = JSON.stringify(value, null, jsonIndent);
				const indent = indentUnit.repeat(result.depth);
				const outdent = indentUnit.repeat(result.depth - 1);
				if (result.container === "object") {
					const key = JSON.stringify(String(path[path.length - 1]));
					const insertText = result.isFirst
						? `${eol}${indent}${key}: ${serialized}${eol}${outdent}`
						: `,${eol}${indent}${key}: ${serialized}`;
					return [JsoncEdit.make({ offset: result.at, length: 0, content: insertText })] as ReadonlyArray<JsoncEdit>;
				}
				const insertText = result.isFirst
					? `${eol}${indent}${serialized}${eol}${outdent}`
					: `,${eol}${indent}${serialized}`;
				return [JsoncEdit.make({ offset: result.at, length: 0, content: insertText })] as ReadonlyArray<JsoncEdit>;
			}
		}
	});
}
