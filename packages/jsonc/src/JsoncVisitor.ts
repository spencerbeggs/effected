/**
 * SAX-style visitor: a demand-driven `Stream` of typed events over a JSONC
 * document, enabling early termination (`Stream.take`) without building an AST.
 *
 * The event union is a `Data.TaggedEnum` — serializable tagged values with
 * structural equality, consistent with the rest of the library — replacing v3's
 * plain object literals. Malformed input surfaces as `Error` events inside the
 * union (mirroring v3's `onError` callback), so the stream stays infallible at
 * the type level. v3's `visitCollect` is dropped: `Stream.filter` +
 * `Stream.runCollect` cover it (and in v4 `runCollect` already yields an
 * `Array`, so no `Chunk.toReadonlyArray` step is needed).
 *
 * @packageDocumentation
 */

import { Data, Stream } from "effect";
import { scanErrorToCode } from "./internal/parser.js";
import type { SyntaxKind } from "./internal/scanner.js";
import { createScanner } from "./internal/scanner.js";
import type { JsoncParseErrorCode, JsoncParseOptions } from "./Jsonc.js";
import type { JsoncPath, JsoncSegment } from "./JsoncNode.js";

/**
 * The discriminated union of JSONC visitor events. Each variant carries an
 * `offset` and `length`; begin/property/literal events also carry `path`
 * context, and `Error` events carry a `JsoncParseErrorCode`.
 *
 * @public
 */
export type JsoncVisitorEvent = Data.TaggedEnum<{
	ObjectBegin: { readonly offset: number; readonly length: number; readonly path: JsoncPath };
	ObjectEnd: { readonly offset: number; readonly length: number };
	ObjectProperty: {
		readonly property: string;
		readonly offset: number;
		readonly length: number;
		readonly path: JsoncPath;
	};
	ArrayBegin: { readonly offset: number; readonly length: number; readonly path: JsoncPath };
	ArrayEnd: { readonly offset: number; readonly length: number };
	LiteralValue: { readonly value: unknown; readonly offset: number; readonly length: number; readonly path: JsoncPath };
	Separator: { readonly character: string; readonly offset: number; readonly length: number };
	Comment: { readonly offset: number; readonly length: number };
	Error: { readonly code: JsoncParseErrorCode; readonly offset: number; readonly length: number };
}>;

/**
 * Constructors and matchers for the `JsoncVisitorEvent` union (e.g.
 * `JsoncVisitorEvent.ObjectBegin({ offset, length, path })`,
 * `JsoncVisitorEvent.$is("LiteralValue")`).
 *
 * @public
 */
export const JsoncVisitorEvent = Data.taggedEnum<JsoncVisitorEvent>();

/**
 * SAX-style JSONC visitor statics. Not instantiable.
 *
 * @public
 */
export class JsoncVisitor {
	private constructor() {}

	/**
	 * Create a lazy `Stream` of `JsoncVisitorEvent` from JSONC text. Events
	 * are produced on demand, so combining with `Stream.take` allows efficient
	 * partial scans of large documents.
	 *
	 * @param text - The JSONC source to visit.
	 * @param options - Optional {@link JsoncParseOptions}; only comment handling
	 *   is consulted.
	 */
	static visit(text: string, options?: JsoncParseOptions): Stream.Stream<JsoncVisitorEvent> {
		return Stream.fromIterable(visitGen(text, options?.disallowComments ?? false));
	}
}

function* visitGen(text: string, disallowComments: boolean): Generator<JsoncVisitorEvent> {
	const scanner = createScanner(text, false);
	const path: Array<JsoncSegment> = [];

	function* scanNext(): Generator<JsoncVisitorEvent, SyntaxKind> {
		for (;;) {
			const t = scanner.scan();

			const code = scanErrorToCode(scanner.getTokenError());
			if (code !== undefined) {
				yield JsoncVisitorEvent.Error({
					code,
					offset: scanner.getTokenOffset(),
					length: scanner.getTokenLength(),
				});
			}

			switch (t) {
				case "LineComment":
				case "BlockComment":
					if (disallowComments) {
						yield JsoncVisitorEvent.Error({
							code: "InvalidCommentToken",
							offset: scanner.getTokenOffset(),
							length: scanner.getTokenLength(),
						});
					} else {
						yield JsoncVisitorEvent.Comment({
							offset: scanner.getTokenOffset(),
							length: scanner.getTokenLength(),
						});
					}
					break;
				case "Trivia":
				case "LineBreak":
					break;
				default:
					return t;
			}
		}
	}

	function literalValue(kind: SyntaxKind, tokenValue: string): unknown {
		switch (kind) {
			case "String":
				return tokenValue;
			case "Number":
				return Number.parseFloat(tokenValue);
			case "True":
				return true;
			case "False":
				return false;
			case "Null":
				return null;
			default:
				return undefined;
		}
	}

	function* visitValue(): Generator<JsoncVisitorEvent, boolean> {
		const t = scanner.getToken();
		switch (t) {
			case "OpenBrace":
				return yield* visitObject();
			case "OpenBracket":
				return yield* visitArray();
			case "String":
			case "Number":
			case "True":
			case "False":
			case "Null":
				yield JsoncVisitorEvent.LiteralValue({
					value: literalValue(t, scanner.getTokenValue()),
					offset: scanner.getTokenOffset(),
					length: scanner.getTokenLength(),
					path: [...path],
				});
				yield* scanNext();
				return true;
			default:
				yield JsoncVisitorEvent.Error({
					code: "ValueExpected",
					offset: scanner.getTokenOffset(),
					length: scanner.getTokenLength(),
				});
				return false;
		}
	}

	function* visitObject(): Generator<JsoncVisitorEvent, boolean> {
		yield JsoncVisitorEvent.ObjectBegin({
			offset: scanner.getTokenOffset(),
			length: scanner.getTokenLength(),
			path: [...path],
		});

		yield* scanNext(); // skip {
		let needsComma = false;

		while (scanner.getToken() !== "CloseBrace" && scanner.getToken() !== "EOF") {
			if (scanner.getToken() === "Comma") {
				yield JsoncVisitorEvent.Separator({
					character: ",",
					offset: scanner.getTokenOffset(),
					length: scanner.getTokenLength(),
				});
				yield* scanNext();
				if (scanner.getToken() === "CloseBrace") {
					break; // trailing comma
				}
			} else if (needsComma) {
				yield JsoncVisitorEvent.Error({
					code: "CommaExpected",
					offset: scanner.getTokenOffset(),
					length: scanner.getTokenLength(),
				});
			}

			if (scanner.getToken() !== "String") {
				yield JsoncVisitorEvent.Error({
					code: "PropertyNameExpected",
					offset: scanner.getTokenOffset(),
					length: scanner.getTokenLength(),
				});
				yield* scanNext();
				continue;
			}

			const key = scanner.getTokenValue();
			yield JsoncVisitorEvent.ObjectProperty({
				property: key,
				offset: scanner.getTokenOffset(),
				length: scanner.getTokenLength(),
				path: [...path],
			});
			path.push(key);

			yield* scanNext(); // skip key
			if (scanner.getToken() === "Colon") {
				yield JsoncVisitorEvent.Separator({
					character: ":",
					offset: scanner.getTokenOffset(),
					length: scanner.getTokenLength(),
				});
				yield* scanNext(); // skip colon
			} else {
				yield JsoncVisitorEvent.Error({
					code: "ColonExpected",
					offset: scanner.getTokenOffset(),
					length: scanner.getTokenLength(),
				});
			}

			yield* visitValue();
			path.pop();
			needsComma = true;
		}

		if (scanner.getToken() === "CloseBrace") {
			yield JsoncVisitorEvent.ObjectEnd({
				offset: scanner.getTokenOffset(),
				length: scanner.getTokenLength(),
			});
			yield* scanNext();
		} else {
			yield JsoncVisitorEvent.Error({
				code: "CloseBraceExpected",
				offset: scanner.getTokenOffset(),
				length: scanner.getTokenLength(),
			});
		}

		return true;
	}

	function* visitArray(): Generator<JsoncVisitorEvent, boolean> {
		yield JsoncVisitorEvent.ArrayBegin({
			offset: scanner.getTokenOffset(),
			length: scanner.getTokenLength(),
			path: [...path],
		});

		yield* scanNext(); // skip [
		let index = 0;
		let needsComma = false;

		while (scanner.getToken() !== "CloseBracket" && scanner.getToken() !== "EOF") {
			if (scanner.getToken() === "Comma") {
				yield JsoncVisitorEvent.Separator({
					character: ",",
					offset: scanner.getTokenOffset(),
					length: scanner.getTokenLength(),
				});
				yield* scanNext();
				if (scanner.getToken() === "CloseBracket") {
					break; // trailing comma
				}
			} else if (needsComma) {
				yield JsoncVisitorEvent.Error({
					code: "CommaExpected",
					offset: scanner.getTokenOffset(),
					length: scanner.getTokenLength(),
				});
			}

			path.push(index);
			yield* visitValue();
			path.pop();
			index++;
			needsComma = true;
		}

		if (scanner.getToken() === "CloseBracket") {
			yield JsoncVisitorEvent.ArrayEnd({
				offset: scanner.getTokenOffset(),
				length: scanner.getTokenLength(),
			});
			yield* scanNext();
		} else {
			yield JsoncVisitorEvent.Error({
				code: "CloseBracketExpected",
				offset: scanner.getTokenOffset(),
				length: scanner.getTokenLength(),
			});
		}

		return true;
	}

	yield* scanNext();
	if (scanner.getToken() !== "EOF") {
		yield* visitValue();
	}
}
