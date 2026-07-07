/**
 * Recursive-descent JSONC parser: value mode (plain JS values) and tree mode
 * ({@link JsoncNode} AST). Private implementation.
 *
 * This module owns the single copy of the scan-error to parse-code mapping
 * ({@link scanErrorToCode}), consumed by both this parser and the visitor. It
 * returns plain results plus raw error records (`{ code, offset, length }`) and
 * MUST NOT import from `Jsonc.ts`: the facade maps raw records into
 * `JsoncParseErrorDetail` (computing `line`/`character` from `offset`) and
 * constructs the aggregate `JsoncParseError` itself, so the dependency edge
 * runs facade to parser only — never the reverse (a cycle would trip the
 * error-level `noImportCycles` lint).
 *
 * Reference: Microsoft's jsonc-parser parser design (MIT).
 */

import { JsoncNode } from "../JsoncNode.js";
import type { ScanError, SyntaxKind } from "./scanner.js";
import { createScanner } from "./scanner.js";

/**
 * The public parse-error code vocabulary. The facade builds its `@public`
 * `JsoncParseErrorCode` schema from this array; the parser produces these codes
 * as plain strings so the schema stays facade-owned without an import cycle.
 */
export const JSONC_PARSE_ERROR_CODES = [
	"InvalidSymbol",
	"InvalidNumberFormat",
	"PropertyNameExpected",
	"ValueExpected",
	"ColonExpected",
	"CommaExpected",
	"CloseBraceExpected",
	"CloseBracketExpected",
	"EndOfFileExpected",
	"InvalidCommentToken",
	"UnexpectedEndOfComment",
	"UnexpectedEndOfString",
	"UnexpectedEndOfNumber",
	"InvalidUnicode",
	"InvalidEscapeCharacter",
	"InvalidCharacter",
] as const;

/** A single parse-error code. */
export type ParseCode = (typeof JSONC_PARSE_ERROR_CODES)[number];

/** A raw parse error record — position only; the facade derives line/character. */
export interface RawParseError {
	readonly code: ParseCode;
	readonly offset: number;
	readonly length: number;
}

/** Plain flags accepted by the parser, decoded from `JsoncParseOptions` by the facade. */
export interface ParseFlags {
	readonly disallowComments?: boolean | undefined;
	readonly allowTrailingComma?: boolean | undefined;
	readonly allowEmptyContent?: boolean | undefined;
}

/** Value-mode result: the recovered value plus every error encountered. */
export interface ParseValueResult {
	readonly value: unknown;
	readonly errors: ReadonlyArray<RawParseError>;
}

/** Tree-mode result: the root node (or `undefined` for empty input) plus errors. */
export interface ParseTreeResult {
	readonly root: JsoncNode | undefined;
	readonly errors: ReadonlyArray<RawParseError>;
}

/**
 * The single scan-error to parse-code translation, shared by the parser and the
 * visitor. Returns `undefined` for `"None"` (no error).
 */
export const scanErrorToCode = (error: ScanError): ParseCode | undefined => {
	switch (error) {
		case "InvalidUnicode":
			return "InvalidUnicode";
		case "InvalidEscapeCharacter":
			return "InvalidEscapeCharacter";
		case "UnexpectedEndOfNumber":
			return "InvalidNumberFormat";
		case "UnexpectedEndOfComment":
			return "UnexpectedEndOfComment";
		case "UnexpectedEndOfString":
			return "UnexpectedEndOfString";
		case "InvalidCharacter":
			return "InvalidCharacter";
		case "InvalidSymbol":
			return "InvalidSymbol";
		default:
			return undefined;
	}
};

interface Internal {
	value: unknown;
	root: JsoncNode | undefined;
	errors: RawParseError[];
}

function run(text: string, flags: ParseFlags, buildTree: boolean): Internal {
	const scanner = createScanner(text, false);
	const errors: RawParseError[] = [];
	const disallowComments = flags.disallowComments ?? false;
	const allowTrailingComma = flags.allowTrailingComma ?? true;
	const allowEmptyContent = flags.allowEmptyContent ?? false;

	let currentToken: SyntaxKind = "Unknown";

	// Defeats TS control-flow narrowing — scanNext() mutates currentToken via closure.
	function token(): SyntaxKind {
		return currentToken;
	}

	function scanNext(): SyntaxKind {
		for (;;) {
			currentToken = scanner.scan();
			const code = scanErrorToCode(scanner.getTokenError());
			if (code !== undefined) {
				pushError(code);
			}
			switch (currentToken) {
				case "LineComment":
				case "BlockComment":
					if (disallowComments) {
						pushError("InvalidCommentToken");
					}
					break;
				case "Trivia":
				case "LineBreak":
					break;
				default:
					return currentToken;
			}
		}
	}

	// Tight end-of-token offset — captures where the CURRENT token ends, before
	// scanNext() advances past trailing trivia. Node lengths are computed from
	// this value so spans never swallow trailing whitespace or comments.
	function tokenEnd(): number {
		return scanner.getTokenOffset() + scanner.getTokenLength();
	}

	function pushError(code: ParseCode, skipUntilAfter: SyntaxKind[] = [], skipUntil: SyntaxKind[] = []): void {
		errors.push({
			code,
			offset: scanner.getTokenOffset(),
			length: scanner.getTokenLength(),
		});
		if (skipUntilAfter.length > 0 || skipUntil.length > 0) {
			let t = token();
			while (t !== "EOF") {
				if (skipUntilAfter.includes(t)) {
					scanNext();
					break;
				}
				if (skipUntil.includes(t)) {
					break;
				}
				t = scanNext();
			}
		}
	}

	// ── Value mode ──────────────────────────────────────────────────────────

	function parseValue(): unknown {
		switch (token()) {
			case "OpenBracket":
				return parseArray();
			case "OpenBrace":
				return parseObject();
			case "String":
				return parseString();
			case "Number":
				return parseNumber();
			case "True":
				scanNext();
				return true;
			case "False":
				scanNext();
				return false;
			case "Null":
				scanNext();
				return null;
			default:
				return undefined;
		}
	}

	function parseString(): string {
		const value = scanner.getTokenValue();
		scanNext();
		return value;
	}

	function parseNumber(): number {
		const value = Number.parseFloat(scanner.getTokenValue());
		scanNext();
		return value;
	}

	function parseArray(): unknown[] {
		scanNext(); // skip [
		const arr: unknown[] = [];
		let needsComma = false;

		while (token() !== "CloseBracket" && token() !== "EOF") {
			if (token() === "Comma") {
				if (!needsComma) {
					pushError("ValueExpected");
				}
				scanNext();
				if (token() === "CloseBracket" && allowTrailingComma) {
					break;
				}
			} else if (needsComma) {
				pushError("CommaExpected");
			}
			const value = parseValue();
			if (value === undefined) {
				pushError("ValueExpected", [], ["CloseBracket", "Comma"]);
			} else {
				arr.push(value);
			}
			needsComma = true;
		}

		if (token() !== "CloseBracket") {
			pushError("CloseBracketExpected");
		} else {
			scanNext();
		}

		return arr;
	}

	function parseObject(): Record<string, unknown> {
		scanNext(); // skip {
		const obj: Record<string, unknown> = {};
		let needsComma = false;

		while (token() !== "CloseBrace" && token() !== "EOF") {
			if (token() === "Comma") {
				if (!needsComma) {
					pushError("PropertyNameExpected");
				}
				scanNext();
				if (token() === "CloseBrace" && allowTrailingComma) {
					break;
				}
			} else if (needsComma) {
				pushError("CommaExpected");
			}
			if (token() !== "String") {
				pushError("PropertyNameExpected", [], ["CloseBrace", "Comma"]);
				continue;
			}
			const key = scanner.getTokenValue();
			scanNext();
			if (token() !== "Colon") {
				pushError("ColonExpected", [], ["CloseBrace", "Comma"]);
				continue;
			}
			scanNext();
			const value = parseValue();
			if (value === undefined) {
				pushError("ValueExpected", [], ["CloseBrace", "Comma"]);
			} else if (key === "__proto__") {
				// Define as an own data property — plain assignment would mutate the
				// object's prototype (JSON.parse semantics, pollution-safe).
				Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
			} else {
				obj[key] = value;
			}
			needsComma = true;
		}

		if (token() !== "CloseBrace") {
			pushError("CloseBraceExpected");
		} else {
			scanNext();
		}

		return obj;
	}

	// ── Tree mode ───────────────────────────────────────────────────────────

	function parseValueTree(): JsoncNode | undefined {
		switch (token()) {
			case "OpenBracket":
				return parseArrayTree();
			case "OpenBrace":
				return parseObjectTree();
			case "String":
				return leafTree("string", scanner.getTokenValue());
			case "Number":
				return leafTree("number", Number.parseFloat(scanner.getTokenValue()));
			case "True":
				return leafTree("boolean", true);
			case "False":
				return leafTree("boolean", false);
			case "Null":
				return leafTree("null", null);
			default:
				return undefined;
		}
	}

	function leafTree(type: "string" | "number" | "boolean" | "null", value: unknown): JsoncNode {
		const offset = scanner.getTokenOffset();
		const end = tokenEnd();
		scanNext();
		return JsoncNode.make({ type, offset, length: end - offset, value });
	}

	function parseArrayTree(): JsoncNode {
		const offset = scanner.getTokenOffset();
		const children: JsoncNode[] = [];
		scanNext(); // skip [
		let needsComma = false;

		while (token() !== "CloseBracket" && token() !== "EOF") {
			if (token() === "Comma") {
				if (!needsComma) {
					pushError("ValueExpected");
				}
				scanNext();
				if (token() === "CloseBracket" && allowTrailingComma) {
					break;
				}
			} else if (needsComma) {
				pushError("CommaExpected");
			}
			const child = parseValueTree();
			if (child !== undefined) {
				children.push(child);
			} else {
				pushError("ValueExpected", [], ["CloseBracket", "Comma"]);
			}
			needsComma = true;
		}

		let end: number;
		if (token() !== "CloseBracket") {
			pushError("CloseBracketExpected");
			end = scanner.getTokenOffset();
		} else {
			end = tokenEnd();
			scanNext();
		}
		return JsoncNode.make({ type: "array", offset, length: end - offset, children });
	}

	function parseObjectTree(): JsoncNode {
		const offset = scanner.getTokenOffset();
		const children: JsoncNode[] = [];
		scanNext(); // skip {
		let needsComma = false;

		while (token() !== "CloseBrace" && token() !== "EOF") {
			if (token() === "Comma") {
				if (!needsComma) {
					pushError("PropertyNameExpected");
				}
				scanNext();
				if (token() === "CloseBrace" && allowTrailingComma) {
					break;
				}
			} else if (needsComma) {
				pushError("CommaExpected");
			}
			if (token() !== "String") {
				pushError("PropertyNameExpected", [], ["CloseBrace", "Comma"]);
				continue;
			}

			const propOffset = scanner.getTokenOffset();
			const keyOffset = scanner.getTokenOffset();
			const keyValue = scanner.getTokenValue();
			const keyEnd = tokenEnd();
			scanNext();
			const keyNode = JsoncNode.make({
				type: "string",
				offset: keyOffset,
				length: keyEnd - keyOffset,
				value: keyValue,
			});

			if (token() !== "Colon") {
				pushError("ColonExpected", [], ["CloseBrace", "Comma"]);
				children.push(
					JsoncNode.make({
						type: "property",
						offset: propOffset,
						length: scanner.getTokenOffset() - propOffset,
						children: [keyNode],
					}),
				);
				continue;
			}
			const colonOffset = scanner.getTokenOffset();
			scanNext();

			const valueNode = parseValueTree();
			if (valueNode !== undefined) {
				children.push(
					JsoncNode.make({
						type: "property",
						offset: propOffset,
						length: valueNode.offset + valueNode.length - propOffset,
						colonOffset,
						children: [keyNode, valueNode],
					}),
				);
			} else {
				pushError("ValueExpected", [], ["CloseBrace", "Comma"]);
				children.push(
					JsoncNode.make({
						type: "property",
						offset: propOffset,
						length: scanner.getTokenOffset() - propOffset,
						colonOffset,
						children: [keyNode],
					}),
				);
			}
			needsComma = true;
		}

		let end: number;
		if (token() !== "CloseBrace") {
			pushError("CloseBraceExpected");
			end = scanner.getTokenOffset();
		} else {
			end = tokenEnd();
			scanNext();
		}
		return JsoncNode.make({ type: "object", offset, length: end - offset, children });
	}

	// ── Drive ───────────────────────────────────────────────────────────────

	scanNext();

	if (buildTree) {
		const root = parseValueTree();
		if (token() !== "EOF") {
			pushError("EndOfFileExpected");
		}
		if (root === undefined && !allowEmptyContent) {
			pushError("ValueExpected");
		}
		return { value: undefined, root, errors };
	}

	const value = parseValue();
	if (token() !== "EOF") {
		pushError("EndOfFileExpected");
	}
	if (value === undefined && !allowEmptyContent) {
		pushError("ValueExpected");
	}
	return { value, root: undefined, errors };
}

/** Parse into a plain JS value, recovering from and collecting every error. */
export const parseValue = (text: string, flags: ParseFlags): ParseValueResult => {
	const { value, errors } = run(text, flags, false);
	return { value, errors };
};

/** Parse into a {@link JsoncNode} AST, recovering from and collecting every error. */
export const parseTree = (text: string, flags: ParseFlags): ParseTreeResult => {
	const { root, errors } = run(text, flags, true);
	return { root, errors };
};
