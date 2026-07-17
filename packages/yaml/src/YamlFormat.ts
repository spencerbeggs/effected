// The formatting/modification concept: computing non-mutating edits that
// reformat a document or change a value at a path, via the library's
// parse → transform AST → stringify → diff pipeline.
//
// Cycle firewall: this module drives the internal engine directly
// (`composeFirstDocument`, `stringifyDocument`) exactly as `Yaml.ts` does;
// nothing imports `YamlFormat.ts` back.
//
// Neither `format` nor `modify` catch the internal stringifier's
// `StringifyFailure` (the circular-reference guard): both build their output
// AST from either already-parsed nodes or `jsValueToNode`'s scalar-only
// synthesis, so a cycle can never occur here — if `StringifyFailure` were
// ever thrown it would indicate an internal invariant violation, not a
// user-facing error, and is left to surface as an uncaught defect.

import { Effect, Schema } from "effect";
import { composeFirstDocument } from "./internal/composer/document.js";
import { isFatalCode } from "./internal/diagnostics.js";
import { computeEdits } from "./internal/diff.js";
import type { RawYamlDocument } from "./internal/raw-document.js";
import { stringifyDocument, stripNodeComments } from "./internal/stringifier.js";
import { YamlStringifyOptions } from "./Yaml.js";
import { YamlDiagnostic } from "./YamlDiagnostic.js";
import type { YamlPath, YamlSegment } from "./YamlEdit.js";
import { YamlEdit, YamlRange } from "./YamlEdit.js";
import type { YamlNode } from "./YamlNode.js";
import { YamlMap, YamlPair, YamlScalar, YamlSeq } from "./YamlNode.js";

/**
 * A range accepted at the `format`/`formatToString`/etc. call sites: either a
 * {@link YamlRange} instance or a plain `{ offset, length }` literal (the two
 * are structurally interchangeable — only `offset`/`length` are read).
 *
 * @public
 */
export type YamlRangeLike = YamlRange | { readonly offset: number; readonly length: number };

/**
 * Options controlling formatting behavior: every {@link YamlStringifyOptions}
 * field (derived, not hand-duplicated — including `indentSequences`) plus
 * `preserveComments` (default `true`) and `range` (restrict edits to a
 * region; see the module-level remarks on the `range` parameter vs. this
 * field).
 *
 * Construct with the validated `YamlFormattingOptions.make({ ... })` static —
 * the kit convention (never `new`). Call sites that take a
 * `YamlFormattingOptions` also accept a structurally-matching plain literal.
 *
 * @example
 * ```ts
 * import { YamlFormat, YamlFormattingOptions } from "@effected/yaml";
 *
 * const options = YamlFormattingOptions.make({ indentSequences: true });
 * const formatted = YamlFormat.formatToString("key:\n- a\n- b\n", undefined, options);
 * // key:
 * //   - a
 * //   - b
 * ```
 *
 * @public
 */
export class YamlFormattingOptions extends Schema.Class<YamlFormattingOptions>("YamlFormattingOptions")({
	...YamlStringifyOptions.fields,
	preserveComments: Schema.optionalKey(Schema.Boolean),
	range: Schema.optionalKey(YamlRange),
}) {}

/**
 * Raised when `YamlFormat.modify` cannot navigate the requested path against
 * the composed AST (a structural mismatch) or the source fails to parse.
 * Carries structured {@link YamlDiagnostic} entries — never a collapsed
 * `reason` string (the structure-preserving-errors house rule).
 *
 * @public
 */
export class YamlModificationError extends Schema.TaggedErrorClass<YamlModificationError>()("YamlModificationError", {
	path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
	diagnostics: Schema.Array(YamlDiagnostic),
}) {
	override get message(): string {
		const summary = this.diagnostics.map((d) => d.message).join("; ");
		return `Modification failed at path [${this.path.join(", ")}]: ${summary}`;
	}
}

// ── Internal: navigation failure ────────────────────────────────────────────

/**
 * Thrown by the pure AST-navigation helpers on a structural mismatch.
 * `modify` catches this and materializes {@link YamlModificationError}.
 */
class ModifyFailure extends Error {
	readonly code: "EmptyDocument" | "PathNotFound" | "InvalidIndex" | "NotNavigable";
	readonly offset: number;
	readonly length: number;
	constructor(code: ModifyFailure["code"], message: string, offset: number, length: number) {
		super(message);
		this.name = "ModifyFailure";
		this.code = code;
		this.offset = offset;
		this.length = length;
	}
}

// ── Internal: options bridging ──────────────────────────────────────────────

const toStringifyInput = (options?: YamlStringifyOptions) =>
	options === undefined
		? {}
		: {
				indent: options.indent,
				lineWidth: options.lineWidth,
				defaultScalarStyle: options.defaultScalarStyle,
				defaultCollectionStyle: options.defaultCollectionStyle,
				sortKeys: options.sortKeys,
				indentSequences: options.indentSequences,
				finalNewline: options.finalNewline,
				forceDefaultStyles: options.forceDefaultStyles,
			};

/** Normalize a `format`-positional range and the options-bag fallback into one plain shape (or `undefined`). */
function resolveRange(
	positional: YamlRangeLike | undefined,
	fromOptions: YamlRange | undefined,
): { readonly offset: number; readonly length: number } | undefined {
	const range = positional ?? fromOptions;
	return range === undefined ? undefined : { offset: range.offset, length: range.length };
}

/** Copy only the defined entries of `fields` — never emits an explicit `undefined` into a v4 `optionalKey` field. */
function definedFields<T extends Record<string, unknown>>(fields: T): Partial<T> {
	const out: Partial<T> = {};
	for (const key of Object.keys(fields) as Array<keyof T>) {
		if (fields[key] !== undefined) out[key] = fields[key];
	}
	return out;
}

// ── format ───────────────────────────────────────────────────────────────────

/**
 * Format a document via the parse → stringify round-trip and diff the
 * output against the source, returning `undefined` when the input has a
 * fatal parse error (never corrupt malformed input).
 */
function formatDocument(text: string, options: YamlFormattingOptions | undefined): string | undefined {
	const doc = composeFirstDocument(text, {});
	if (doc.errors.some((e) => isFatalCode(e.code))) return undefined;

	const preserveComments = options?.preserveComments ?? true;
	const contents = !preserveComments && doc.contents !== null ? stripNodeComments(doc.contents) : doc.contents;

	const outputDoc: RawYamlDocument = {
		contents,
		errors: doc.errors,
		warnings: doc.warnings,
		directives: doc.directives,
		...(preserveComments ? definedFields({ comment: doc.comment }) : {}),
		hasDocumentStart: doc.hasDocumentStart,
		hasDocumentEnd: doc.hasDocumentEnd,
		hasDocumentStartTab: doc.hasDocumentStartTab,
	};

	return stringifyDocument(outputDoc, toStringifyInput(options));
}

// ── modify: pure AST navigation ─────────────────────────────────────────────

/** Convert a plain JS scalar value into a synthetic `YamlScalar` (offset/length are irrelevant — immediately re-stringified). */
function jsValueToNode(value: unknown): YamlNode {
	return YamlScalar.make({ value, style: "plain", offset: 0, length: 0 });
}

function modifyDocument(doc: RawYamlDocument, path: YamlPath, value: unknown): YamlNode | null {
	if (path.length === 0) {
		return value === undefined ? null : jsValueToNode(value);
	}
	if (doc.contents === null) {
		throw new ModifyFailure("EmptyDocument", "Cannot navigate path in empty document", 0, 0);
	}
	return modifyNode(doc.contents, path, 0, value);
}

function modifyNode(node: YamlNode, path: YamlPath, depth: number, value: unknown): YamlNode {
	const segment = path[depth] as YamlSegment;
	const isLast = depth === path.length - 1;

	if (node instanceof YamlMap) {
		const pairIndex = node.items.findIndex((pair) => pair.key instanceof YamlScalar && pair.key.value === segment);

		if (isLast) {
			if (value === undefined) {
				if (pairIndex < 0) return node; // Nothing to remove
				const newItems = [...node.items];
				newItems.splice(pairIndex, 1);
				return rebuildMap(node, newItems);
			}

			const newValueNode = jsValueToNode(value);
			if (pairIndex >= 0) {
				const newItems = [...node.items];
				const oldPair = newItems[pairIndex] as YamlPair;
				newItems[pairIndex] = YamlPair.make({
					key: oldPair.key,
					value: newValueNode,
					...definedFields({ comment: oldPair.comment }),
				});
				return rebuildMap(node, newItems);
			}

			// Insert new key — appends after the last pair.
			const keyNode = YamlScalar.make({ value: String(segment), style: "plain", offset: 0, length: 0 });
			const newPair = YamlPair.make({ key: keyNode, value: newValueNode });
			return rebuildMap(node, [...node.items, newPair]);
		}

		// Navigate deeper.
		if (pairIndex < 0) {
			throw new ModifyFailure(
				"PathNotFound",
				`Key "${String(segment)}" not found in mapping`,
				node.offset,
				node.length,
			);
		}
		const pair = node.items[pairIndex] as YamlPair;
		if (pair.value === null) {
			throw new ModifyFailure("PathNotFound", `Value at key "${String(segment)}" is null`, node.offset, node.length);
		}
		const newValue = modifyNode(pair.value, path, depth + 1, value);
		const newItems = [...node.items];
		newItems[pairIndex] = YamlPair.make({
			key: pair.key,
			value: newValue,
			...definedFields({ comment: pair.comment }),
		});
		return rebuildMap(node, newItems);
	}

	if (node instanceof YamlSeq) {
		const idx = typeof segment === "number" ? segment : Number(segment);
		if (Number.isNaN(idx) || idx < 0) {
			throw new ModifyFailure("InvalidIndex", `Invalid sequence index: ${String(segment)}`, node.offset, node.length);
		}

		if (isLast) {
			const newItems = [...node.items];
			if (value === undefined) {
				if (idx < newItems.length) newItems.splice(idx, 1);
			} else if (idx < newItems.length) {
				newItems[idx] = jsValueToNode(value);
			} else {
				newItems.push(jsValueToNode(value)); // Appends after the last element.
			}
			return rebuildSeq(node, newItems);
		}

		if (idx >= node.items.length) {
			throw new ModifyFailure("InvalidIndex", `Index ${idx} out of bounds`, node.offset, node.length);
		}
		const child = node.items[idx] as YamlNode;
		const newChild = modifyNode(child, path, depth + 1, value);
		const newItems = [...node.items];
		newItems[idx] = newChild;
		return rebuildSeq(node, newItems);
	}

	throw new ModifyFailure(
		"NotNavigable",
		`Cannot navigate through ${node._tag} at segment "${String(segment)}"`,
		node.offset,
		node.length,
	);
}

function rebuildMap(node: YamlMap, items: ReadonlyArray<YamlPair>): YamlMap {
	return YamlMap.make({
		items,
		style: node.style,
		...definedFields({
			tag: node.tag,
			anchor: node.anchor,
			comment: node.comment,
			sourceMultiline: node.sourceMultiline,
		}),
		offset: node.offset,
		length: node.length,
	});
}

function rebuildSeq(node: YamlSeq, items: ReadonlyArray<YamlNode>): YamlSeq {
	return YamlSeq.make({
		items,
		style: node.style,
		...definedFields({
			tag: node.tag,
			anchor: node.anchor,
			comment: node.comment,
			sourceMultiline: node.sourceMultiline,
		}),
		offset: node.offset,
		length: node.length,
	});
}

// ── Facade ──────────────────────────────────────────────────────────────────

/**
 * Formatting and modification statics. Not instantiable.
 *
 * @remarks
 * `format`/`formatToString` are pure and total (edit computation never fails
 * — malformed input yields no edits rather than corrupting the document).
 * `modify`/`modifyToString` carry a real error channel: navigation failures
 * against the composed AST raise {@link YamlModificationError}, which — per
 * the structure-preserving-errors house rule — carries
 * `diagnostics: ReadonlyArray<YamlDiagnostic>`, never a collapsed `reason`
 * string.
 *
 * @public
 */
export class YamlFormat {
	private constructor() {}

	/**
	 * Compute formatting edits for a YAML document. Non-mutating — apply the
	 * result with `YamlEdit.applyAll` (or use {@link YamlFormat.formatToString}).
	 * Pure and total: malformed input (a fatal parse error) yields `[]` rather
	 * than corrupting the document.
	 *
	 * @remarks
	 * The positional `range` argument takes precedence over
	 * `options?.range` when both are given; either accepts a plain
	 * `{ offset, length }` object as well as a {@link YamlRange} instance, so
	 * callers do not need `YamlRange.make(...)` for the common case.
	 */
	static format(text: string, range?: YamlRangeLike, options?: YamlFormattingOptions): ReadonlyArray<YamlEdit> {
		const formatted = formatDocument(text, options);
		if (formatted === undefined) return [];

		let edits = computeEdits(text, formatted);

		const effectiveRange = resolveRange(range, options?.range);
		if (effectiveRange !== undefined) {
			const rangeStart = effectiveRange.offset;
			const rangeEnd = effectiveRange.offset + effectiveRange.length;
			edits = edits.filter((e) => e.offset >= rangeStart && e.offset + e.length <= rangeEnd);
		}

		return edits.map((e) => YamlEdit.make(e));
	}

	/**
	 * Format `text` and apply the resulting edits in one step
	 * (`YamlEdit.applyAll ∘ format`). Pure and total.
	 */
	static formatToString(text: string, range?: YamlRangeLike, options?: YamlFormattingOptions): string {
		return YamlEdit.applyAll(text, YamlFormat.format(text, range, options));
	}

	/**
	 * Compute the edits that insert, replace, or remove a value at `path`.
	 * Passing `value === undefined` removes the target key/element; a missing
	 * insertion target appends after the last pair/element. Only
	 * scalar-compatible values are supported (matching v3 — arbitrary object
	 * graphs are not recursively lowered into AST nodes). Fails with
	 * {@link YamlModificationError} on a fatal parse error or a structural
	 * navigation mismatch.
	 *
	 * @remarks
	 * `options` is a bare {@link YamlStringifyOptions} — it controls only the
	 * internal re-stringify step, not a range (there is no range to restrict
	 * for a path-targeted modification).
	 */
	static readonly modify = Effect.fn("YamlFormat.modify")(function* (
		text: string,
		path: YamlPath,
		value: unknown,
		options?: YamlStringifyOptions,
	) {
		const doc = composeFirstDocument(text, {});
		const fatal = doc.errors.filter((e) => isFatalCode(e.code));
		if (fatal.length > 0) {
			return yield* new YamlModificationError({
				path,
				diagnostics: fatal.map((e) => YamlDiagnostic.fromRaw(e, text)),
			});
		}

		let newContents: YamlNode | null;
		try {
			newContents = modifyDocument(doc, path, value);
		} catch (err) {
			if (!(err instanceof ModifyFailure)) throw err;
			return yield* new YamlModificationError({
				path,
				diagnostics: [
					YamlDiagnostic.fromRaw(
						{ code: err.code, message: err.message, offset: err.offset, length: err.length },
						text,
					),
				],
			});
		}

		const outputDoc: RawYamlDocument = { ...doc, contents: newContents };
		const formatted = stringifyDocument(outputDoc, toStringifyInput(options));
		return computeEdits(text, formatted).map((e) => YamlEdit.make(e)) as ReadonlyArray<YamlEdit>;
	});

	/**
	 * Modify `text` and apply the resulting edits in one step
	 * (`YamlEdit.applyAll ∘ modify`).
	 */
	static readonly modifyToString = Effect.fn("YamlFormat.modifyToString")(function* (
		text: string,
		path: YamlPath,
		value: unknown,
		options?: YamlStringifyOptions,
	) {
		const edits = yield* YamlFormat.modify(text, path, value, options);
		return YamlEdit.applyAll(text, edits);
	});
}
