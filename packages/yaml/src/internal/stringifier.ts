// YAML stringifier engine — converts JavaScript values and AST nodes to YAML
// text, including the canonical-output logic exercised by the
// yaml-test-suite byte-equality assertion family.
//
// Sync throughout; the two v3 `Effect.try` failure wrappers become the
// thrown `StringifyFailure`, which the public facade catches and
// materializes into the public error type. Implements configurable
// formatting with support for block/flow styles, scalar quoting rules, and
// round-trip preservation of AST node styles.

import type { CollectionStyle, ScalarStyle, YamlNode } from "../YamlNode.js";
import { YamlAlias, YamlMap, YamlPair, YamlScalar, YamlSeq } from "../YamlNode.js";
import { MAX_NESTING_DEPTH } from "./composer/state.js";
import {
	foldRenderedScalar,
	hasInteriorTrailingWhitespace,
	hasNewlineSpacesTab,
	isControlChar,
	renderBlockFolded,
	renderBlockLiteral,
	renderSingleQuotedMultiline,
} from "./fold.js";
import type { StringifyOptionsInput } from "./options.js";
import type { RawDirective, RawYamlDocument } from "./raw-document.js";

/**
 * Thrown by the stringifier on its failure paths (circular references). The
 * facade catches this and materializes the public stringify error.
 */
export class StringifyFailure extends Error {
	readonly reason: string;
	constructor(reason: string) {
		super(reason);
		this.name = "StringifyFailure";
		this.reason = reason;
	}
}

/**
 * Thrown by the value-stringifier trio when its mutual recursion exceeds
 * {@link MAX_NESTING_DEPTH}. A deeply-nested acyclic value (e.g. a 50 000-deep
 * array) would otherwise overflow the call stack as an unhandled `RangeError`
 * defect; the facade catches this and materializes a fatal
 * `YamlStringifyError` (a `NestingDepthExceeded` diagnostic), keeping the
 * failure on the typed error channel — the stringify mirror of the composer's
 * nesting-depth guard.
 */
export class StringifyDepthExceeded extends Error {
	constructor() {
		super(`Nesting depth exceeded maximum of ${MAX_NESTING_DEPTH}`);
		this.name = "StringifyDepthExceeded";
	}
}

// ---------------------------------------------------------------------------
// YAML 1.2 type-conflict detection
// ---------------------------------------------------------------------------

const NULL_RE = /^(?:null|Null|NULL|~)$/;
const TRUE_RE = /^(?:true|True|TRUE)$/;
const FALSE_RE = /^(?:false|False|FALSE)$/;
const INT_RE = /^[-+]?[0-9]+$/;
const OCT_RE = /^0o[0-7]+$/;
const HEX_RE = /^0x[\dA-Fa-f]+$/;
const FLOAT_RE = /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)(?:[eE][-+]?[0-9]+)?$/;
const INF_RE = /^[-+]?\.(?:inf|Inf|INF)$/;
const NAN_RE = /^\.(?:nan|NaN|NAN)$/;

/**
 * YAML indicator characters that require quoting when appearing in plain scalars.
 */
const INDICATOR_CHARS = new Set([
	":",
	"#",
	"{",
	"}",
	"[",
	"]",
	",",
	"&",
	"*",
	"?",
	"|",
	"-",
	"<",
	">",
	"=",
	"!",
	"%",
	"@",
	"`",
	'"',
	"'",
]);

/**
 * Returns true if a string value would be mis-resolved as a non-string YAML type.
 *
 * Tests against all YAML 1.2 Core Schema type patterns (null, bool, int, float,
 * inf, nan). Any string matching these patterns must be quoted to preserve its
 * string identity during a parse round-trip.
 */
function wouldBeResolved(s: string): boolean {
	if (s === "") return true;
	if (NULL_RE.test(s)) return true;
	if (TRUE_RE.test(s)) return true;
	if (FALSE_RE.test(s)) return true;
	if (OCT_RE.test(s)) return true;
	if (HEX_RE.test(s)) return true;
	if (INT_RE.test(s)) return true;
	if (INF_RE.test(s)) return true;
	if (NAN_RE.test(s)) return true;
	if (FLOAT_RE.test(s)) return true;
	return false;
}

/**
 * Returns true if a string requires quoting to be safely represented as a plain scalar.
 *
 * Checks multiple conditions beyond type-conflict detection: empty strings,
 * embedded newlines, leading indicator characters or whitespace, and inline
 * comment/mapping-value patterns (`: `, ` #`). This is the single gate that
 * decides whether a plain scalar is safe or must be wrapped in quotes.
 */
function requiresQuoting(s: string, ignoreType = false): boolean {
	// Empty string must be quoted
	if (s === "") return true;
	// Contains newlines — use block literal instead
	if (s.includes("\n")) return true;
	// Would be resolved as a non-string type (skip when a tag overrides resolution)
	if (!ignoreType && wouldBeResolved(s)) return true;
	// Starts with whitespace (space/tab)
	const first = s[0];
	if (first === " " || first === "\t") return true;
	// Check leading indicator characters
	if (first !== undefined && INDICATOR_CHARS.has(first)) {
		// ':', '?', '-' only require quoting when followed by whitespace or at end of string
		if (first === ":" || first === "?" || first === "-") {
			const second = s[1];
			if (s.length === 1 || second === " " || second === "\t") return true;
			// Otherwise these are safe as plain scalars (e.g., :foo, ?bar, -baz)
		} else {
			// All other indicator chars (#, {, }, [, ], etc.) always require quoting at start
			return true;
		}
	}
	// Starts with document marker prefix (--- or ...) — ambiguous at line start
	if (s.startsWith("---") || s.startsWith("...")) return true;
	// Contains ': ' (mapping value indicator with space) or ' #' (comment indicator)
	if (s.includes(": ") || s.includes(":\t") || s.endsWith(":")) return true;
	if (s.includes(" #") || s.includes("\t#")) return true;
	// Ends with whitespace (space/tab) — plain scalars lose trailing whitespace
	const last = s[s.length - 1];
	if (last === " " || last === "\t") return true;
	// C0 control characters (except tab) require quoting
	for (let i = 0; i < s.length; i++) {
		if (isControlChar(s.charCodeAt(i))) return true;
	}
	return false;
}

/**
 * Returns true if the string contains any non-ASCII character (code point \> 0x7E).
 */
function hasNonAscii(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		if (s.charCodeAt(i) > 0x7e) return true;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Scalar rendering
// ---------------------------------------------------------------------------

/**
 * Renders a string scalar using double-quote style.
 *
 * When `canonical` is true, non-ASCII characters are escaped as `\uXXXX`
 * (or `\UXXXXXXXX` for supplementary plane) and C0 control characters use
 * named escapes where YAML 1.2 defines them (`\b`, `\0`, `\a`, `\v`, `\e`).
 */
function renderDoubleQuoted(s: string, canonical = false): string {
	let escaped = s
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
	let result = "";
	for (let i = 0; i < escaped.length; i++) {
		const code = escaped.charCodeAt(i);
		if (isControlChar(code)) {
			// Use YAML 1.2 named escapes where available
			if (code === 0x00) {
				result += "\\0";
			} else if (code === 0x07) {
				result += "\\a";
			} else if (code === 0x08) {
				result += "\\b";
			} else if (code === 0x0b) {
				result += "\\v";
			} else if (code === 0x0c) {
				result += "\\f";
			} else if (code === 0x1b) {
				result += "\\e";
			} else {
				result += `\\x${code.toString(16).padStart(2, "0")}`;
			}
		} else if (canonical && code > 0x7e) {
			// In canonical mode, escape non-ASCII characters
			// Check for surrogate pairs (supplementary plane characters)
			if (code >= 0xd800 && code <= 0xdbff && i + 1 < escaped.length) {
				const low = escaped.charCodeAt(i + 1);
				if (low >= 0xdc00 && low <= 0xdfff) {
					const cp = (code - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
					result += `\\U${cp.toString(16).toUpperCase().padStart(8, "0")}`;
					i++; // skip low surrogate
					continue;
				}
			}
			result += `\\u${code.toString(16).toUpperCase().padStart(4, "0")}`;
		} else {
			result += escaped[i];
		}
	}
	escaped = result;
	return `"${escaped}"`;
}

/**
 * Renders a string scalar using single-quote style.
 */
function renderSingleQuoted(s: string): string {
	return `'${s.replace(/'/g, "''")}'`;
}

/**
 * Renders a string value as a YAML scalar using the requested style.
 * Falls back to double-quoted if the requested style is unsafe for the value.
 *
 * Multi-line strings are routed to block styles regardless of the requested
 * style (except double-quoted). For single-line strings, plain style delegates
 * to {@link requiresQuoting} and falls back to double-quoted when the value
 * would be ambiguous. Block literal and block folded styles are always
 * accepted for single-line strings even though the output is unusual.
 */
function renderString(
	s: string,
	style: ScalarStyle,
	indent: string,
	ignoreType = false,
	canonical = false,
	explicitChomp?: "strip" | "clip" | "keep",
	parentPosition?: "block-map-value" | "block-seq-item",
): string {
	if (s.includes("\n")) {
		// If the value contains C0 control chars (except tab) or carriage
		// returns, block styles can't represent them — use double-quoted
		let hasControl = false;
		for (let i = 0; i < s.length; i++) {
			const code = s.charCodeAt(i);
			if (isControlChar(code) || code === 0x0d) {
				hasControl = true;
				break;
			}
		}
		if (hasControl) return renderDoubleQuoted(s, canonical);
		// If the value is only spaces and newlines (no text/tab content),
		// block scalars can't represent it faithfully — use double-quoted.
		// Exception: when the original style is block-literal with keep-chomp
		// content (newline-only is a valid `|+` body), preserve block style.
		if (/^[\n ]*$/.test(s) && style !== "block-literal" && style !== "block-folded") {
			return renderDoubleQuoted(s, canonical);
		}
		// In canonical mode, multi-line block content with trailing whitespace
		// on an interior line cannot round-trip cleanly — block scalars normalise
		// such whitespace. Single-line content with only trailing whitespace
		// (e.g. `\t\n`) is tolerated by block style. Uses imperative scans
		// instead of regexes to avoid polynomial-time matching on adversarial
		// inputs containing many trailing newlines.
		if (canonical && (style === "block-literal" || style === "block-folded")) {
			if (hasInteriorTrailingWhitespace(s)) {
				return renderDoubleQuoted(s, canonical);
			}
			// Mixed leading whitespace on a continuation line (space then tab)
			// produces ambiguous indentation in block style; switch to DQ.
			if (hasNewlineSpacesTab(s)) {
				return renderDoubleQuoted(s, canonical);
			}
		}
		// Multi-line: prefer block styles
		if (style === "block-literal") return renderBlockLiteral(s, indent, explicitChomp, parentPosition);
		if (style === "block-folded") return renderBlockFolded(s, indent);
		// In canonical mode, prefer single-quoted with fold encoding for plain
		// and single-quoted multi-line scalars — matches libyaml canonical form.
		if (style === "plain" || style === "single-quoted") {
			if (canonical) {
				const sq = renderSingleQuotedMultiline(s, indent);
				if (sq !== null) return sq;
			}
			return renderBlockLiteral(s, indent, explicitChomp, parentPosition);
		}
		return renderDoubleQuoted(s, canonical);
	}
	// In canonical mode, force double-quoted when string has non-ASCII chars
	// so they can be escaped as \uXXXX
	if (canonical && hasNonAscii(s)) {
		return renderDoubleQuoted(s, true);
	}
	// Empty strings in block styles should use quoted style instead
	if (s === "" && (style === "block-literal" || style === "block-folded")) {
		return renderDoubleQuoted(s, canonical);
	}
	switch (style) {
		case "plain":
			if (requiresQuoting(s, ignoreType)) {
				// Prefer single-quoted when no escape sequences are needed.
				// Only use double-quoted for chars that need YAML escapes
				// (tab, CR, control chars). Backslashes are literal in
				// single-quoted YAML and do NOT need double-quoting.
				if (s.includes("\t") || s.includes("\r")) {
					return renderDoubleQuoted(s, canonical);
				}
				for (let i = 0; i < s.length; i++) {
					if (isControlChar(s.charCodeAt(i))) return renderDoubleQuoted(s, canonical);
				}
				return renderSingleQuoted(s);
			}
			return s;
		case "single-quoted":
			return renderSingleQuoted(s);
		case "double-quoted":
			return renderDoubleQuoted(s, canonical);
		case "block-literal":
			return renderBlockLiteral(s, indent, explicitChomp, parentPosition);
		case "block-folded":
			return renderBlockFolded(s, indent);
	}
}

/**
 * Returns true if the rendered text ends with an open-ended block scalar
 * (`|+` or `>+` keep-chomp). Such scalars consume any trailing blank lines
 * up to the next document marker, so an explicit `...` is required for the
 * reader to know where the value ends.
 *
 * Detects the most recent `|` or `>` indicator on a header line (matching
 * the form `|<digits>?<chomp>?$` after optional indent and node prefixes)
 * and returns true when the chomp indicator is `+`.
 */
function endsWithKeepChomp(rendered: string): boolean {
	const match = rendered.match(/[|>][1-9]?[+-]?$|[|>][1-9]?[+-]?(?=\n)/g);
	if (!match) return false;
	const last = match[match.length - 1];
	return last.includes("+");
}

// ---------------------------------------------------------------------------
// Number rendering
// ---------------------------------------------------------------------------

/**
 * Renders a number value as a YAML scalar string.
 *
 * Maps JavaScript special number values to their YAML 1.2 Core Schema
 * equivalents: `NaN` becomes `.nan`, positive infinity becomes `.inf`,
 * and negative infinity becomes `-.inf`. All other numbers use
 * `String(n)` which produces valid YAML integer or float literals.
 */
function renderNumber(n: number): string {
	if (Number.isNaN(n)) return ".nan";
	if (n === Number.POSITIVE_INFINITY) return ".inf";
	if (n === Number.NEGATIVE_INFINITY) return "-.inf";
	return String(n);
}

// ---------------------------------------------------------------------------
// Circular reference detection
// ---------------------------------------------------------------------------

/**
 * Detects circular references by tracking the object ancestor chain.
 */
function detectCircular(value: unknown, seen: Set<object>): void {
	if (value !== null && typeof value === "object") {
		if (seen.has(value)) {
			throw new StringifyFailure("Circular reference detected");
		}
	}
}

// ---------------------------------------------------------------------------
// Core stringification
// ---------------------------------------------------------------------------

interface StringifyContext {
	indent: number;
	lineWidth: number;
	defaultScalarStyle: ScalarStyle;
	defaultCollectionStyle: CollectionStyle;
	sortKeys: boolean;
	indentSequences: boolean;
	forceDefaultStyles: boolean;
	seen: Set<object>;
	/**
	 * Position of the current node within its parent. Used by canonical-mode
	 * stringifier rules that need to differentiate "block-map value position"
	 * from "block-seq item position" (e.g., K858 explicit indent indicator
	 * for empty keep-chomp scalars only fires under block-map values).
	 */
	parentPosition?: "block-map-value" | "block-seq-item";
}

/** Resolves optional stringify options into a fully-defaulted context. */
function createContext(options?: StringifyOptionsInput): StringifyContext {
	return {
		indent: options?.indent ?? 2,
		// Default 0 = never wrap: byte-identical to the historic (inert) behavior.
		// Only a positive lineWidth opts a caller into column-based folding.
		lineWidth: options?.lineWidth ?? 0,
		defaultScalarStyle: options?.defaultScalarStyle ?? "plain",
		defaultCollectionStyle: options?.defaultCollectionStyle ?? "block",
		sortKeys: options?.sortKeys ?? false,
		indentSequences: options?.indentSequences ?? false,
		forceDefaultStyles: options?.forceDefaultStyles ?? false,
		seen: new Set(),
	};
}

/**
 * Recursively stringifies a JavaScript value into YAML lines.
 *
 * Returns an array of lines with NO leading indentation — the caller is
 * responsible for prepending the appropriate indentation prefix to each line.
 * This avoids double-indentation when embedding nested collections.
 */
function stringifyLines(value: unknown, ctx: StringifyContext, depth: number, allowFold = true): string[] {
	// Depth guard: the value-stringifier trio (this fn, stringifyArrayLines and
	// stringifyObjectLines) is mutually recursive with no natural bound, so a
	// deeply-nested acyclic value would overflow the stack as a RangeError
	// defect. Cap at the shared MAX_NESTING_DEPTH and throw a typed internal
	// error the facade materializes into a YamlStringifyError.
	if (depth > MAX_NESTING_DEPTH) throw new StringifyDepthExceeded();

	// null / undefined
	if (value === null || value === undefined) return ["null"];

	// boolean
	if (typeof value === "boolean") return [value ? "true" : "false"];

	// number
	if (typeof value === "number") return [renderNumber(value)];

	// bigint — produced by the composer's safeParseInt for values exceeding MAX_SAFE_INTEGER
	if (typeof value === "bigint") return [value.toString()];

	// string
	if (typeof value === "string") {
		// For block scalars the header line and body lines are already split
		const indentStr = " ".repeat(ctx.indent);
		const rendered = renderString(value, ctx.defaultScalarStyle, indentStr, false, ctx.forceDefaultStyles);
		// Column-based folding only fires in block contexts (not flow items, whose
		// lines are re-joined with spaces) and only for a positive lineWidth. The
		// folded continuation lines carry `indentStr`, which the block mapping /
		// sequence callers place inline just like a multi-line block scalar.
		const folded = allowFold && ctx.lineWidth > 0 ? foldRenderedScalar(rendered, indentStr, ctx.lineWidth) : rendered;
		return folded.split("\n");
	}

	// array
	if (Array.isArray(value)) {
		detectCircular(value, ctx.seen);
		ctx.seen.add(value as object);
		try {
			return stringifyArrayLines(value, ctx, depth);
		} finally {
			ctx.seen.delete(value as object);
		}
	}

	// object (plain object / record)
	if (typeof value === "object" && value !== null) {
		detectCircular(value, ctx.seen);
		ctx.seen.add(value as object);
		try {
			return stringifyObjectLines(value as Record<string, unknown>, ctx, depth);
		} finally {
			ctx.seen.delete(value as object);
		}
	}

	// Fallback: coerce to string and quote
	return [renderDoubleQuoted(String(value))];
}

/**
 * Stringifies a JavaScript array into YAML sequence lines (no leading indent).
 */
function stringifyArrayLines(arr: unknown[], ctx: StringifyContext, depth: number): string[] {
	if (arr.length === 0) {
		return ["[]"];
	}

	if (ctx.defaultCollectionStyle === "flow") {
		// Flow items are re-joined with spaces, so folding must not run here.
		const items = arr.map((item) => stringifyLines(item, ctx, depth + 1, false).join(" "));
		return [`[${items.join(", ")}]`];
	}

	// Block style — each item rendered relative to depth 0
	const pad = " ".repeat(ctx.indent);
	const lines: string[] = [];
	for (const item of arr) {
		const itemLines = stringifyLines(item, ctx, depth + 1);
		if (itemLines.length === 1) {
			lines.push(`- ${itemLines[0]}`);
		} else {
			// First line of a block scalar goes on the same line as `-`
			const first = itemLines[0];
			// Block scalars (`|`/`>`) and folded/multi-line string scalars (plain or
			// double-quoted, whose continuation lines already carry their indent)
			// put the first line inline after `-` and emit continuations as-is.
			if (first.startsWith("|") || first.startsWith(">") || typeof item === "string") {
				lines.push(`- ${first}`);
				for (let i = 1; i < itemLines.length; i++) {
					lines.push(itemLines[i]);
				}
			} else {
				// Nested mapping or sequence — indent continuation lines by one level
				lines.push(`- ${itemLines[0]}`);
				for (let i = 1; i < itemLines.length; i++) {
					lines.push(`${pad}${itemLines[i]}`);
				}
			}
		}
	}
	return lines;
}

/**
 * Returns true when a value is a non-empty block collection (object or array
 * with block style). Such values must never be placed inline after a key colon
 * in a block mapping — they must always start on the next line.
 */
function isBlockCollection(value: unknown, ctx: StringifyContext): boolean {
	if (ctx.defaultCollectionStyle === "flow") return false;
	if (Array.isArray(value) && value.length > 0) return true;
	if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0)
		return true;
	return false;
}

/**
 * Stringifies a JavaScript object into YAML mapping lines (no leading indent).
 */
function stringifyObjectLines(obj: Record<string, unknown>, ctx: StringifyContext, depth: number): string[] {
	const keys = Object.keys(obj);
	if (keys.length === 0) {
		return ["{}"];
	}

	if (ctx.sortKeys) {
		keys.sort();
	}

	if (ctx.defaultCollectionStyle === "flow") {
		const pairs = keys.map((k) => {
			const keyStr = renderString(k, "plain", "");
			// Flow values are re-joined with spaces, so folding must not run here.
			const valStr = stringifyLines(obj[k], ctx, depth + 1, false).join(" ");
			return `${keyStr}: ${valStr}`;
		});
		return [`{${pairs.join(", ")}}`];
	}

	// Helper: render a mapping key — must be single-line for block mappings,
	// so multiline keys use double-quoted style with \n escapes
	const renderKey = (k: string): string =>
		k.includes("\n") ? renderDoubleQuoted(k, ctx.forceDefaultStyles) : renderString(k, "plain", "");

	// Block style
	const pad = " ".repeat(ctx.indent);
	const lines: string[] = [];
	for (const k of keys) {
		const keyStr = renderKey(k);
		const val = obj[k];
		const valLines = stringifyLines(val, ctx, depth + 1);

		if (valLines.length === 1 && !isBlockCollection(val, ctx)) {
			// Scalar or empty/flow collection — safe to place inline
			lines.push(`${keyStr}: ${valLines[0]}`);
		} else {
			const first = valLines[0];
			if (first.startsWith("|") || first.startsWith(">") || typeof val === "string") {
				// Block scalar header, or a folded/multi-line string scalar (plain or
				// double-quoted, continuation lines already indented): first line on
				// the key line, continuation lines emitted as-is.
				lines.push(`${keyStr}: ${first}`);
				for (let i = 1; i < valLines.length; i++) {
					lines.push(valLines[i]);
				}
			} else if (Array.isArray(val) && val.length > 0) {
				// Block sequence as mapping value: compact notation (no extra indent)
				// by default; one indent level when `indentSequences` is set (the
				// `yaml` npm package's default presentation). Empty lines (block
				// scalar bodies) are never padded — no trailing whitespace.
				lines.push(`${keyStr}:`);
				for (const vl of valLines) {
					lines.push(ctx.indentSequences && vl !== "" ? `${pad}${vl}` : vl);
				}
			} else {
				// Nested block mapping: key on its own line, value indented
				lines.push(`${keyStr}:`);
				for (const vl of valLines) {
					lines.push(`${pad}${vl}`);
				}
			}
		}
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Tag normalization (for canonical output)
// ---------------------------------------------------------------------------

/** Standard YAML 1.2 secondary tag prefix. */
const YAML_TAG_PREFIX = "tag:yaml.org,2002:";

/**
 * Build a tag resolution map from document directives.
 * Maps tag handles (e.g., "!!", "!e!") to their URI prefixes.
 */
function buildTagMap(directives: ReadonlyArray<RawDirective>): Map<string, string> {
	const map = new Map<string, string>();
	for (const d of directives) {
		if (d.name === "TAG" && d.parameters.length >= 2) {
			map.set(d.parameters[0], d.parameters[1]);
		}
	}
	return map;
}

/**
 * Normalize a tag for canonical output.
 *
 * - Resolves custom handles using the tag map from directives
 * - Abbreviates `tag:yaml.org,2002:XXX` URIs to `!!XXX`
 * - Simplifies verbatim `!<!XXX>` to `!XXX`
 * - Expands non-standard `!!` redefinitions to verbatim form
 */
function normalizeTag(tag: string, tagMap: Map<string, string>): string {
	// Verbatim tag: !<uri>
	if (tag.startsWith("!<") && tag.endsWith(">")) {
		const uri = tag.slice(2, -1);
		// If it's a standard YAML tag, abbreviate to !!shorthand
		if (uri.startsWith(YAML_TAG_PREFIX)) {
			return `!!${uri.slice(YAML_TAG_PREFIX.length)}`;
		}
		// Local verbatim tag !<!foo> → !foo
		if (uri.startsWith("!")) {
			return uri;
		}
		// Non-standard URI — keep verbatim
		return tag;
	}

	// Secondary handle: !!suffix
	if (tag.startsWith("!!")) {
		const customPrefix = tagMap.get("!!");
		if (customPrefix && customPrefix !== YAML_TAG_PREFIX) {
			// !! was redefined to non-standard prefix — expand to verbatim
			return `!<${customPrefix}${tag.slice(2)}>`;
		}
		// Standard !! — already canonical
		return tag;
	}

	// Named handle: !name!suffix
	const namedMatch = tag.match(/^(![\w-]*!)(.*)$/);
	if (namedMatch) {
		const handle = namedMatch[1];
		const suffix = namedMatch[2] ?? "";
		const prefix = tagMap.get(handle);
		if (prefix) {
			const uri = prefix + suffix;
			// Check if resolved URI is a standard YAML tag
			if (uri.startsWith(YAML_TAG_PREFIX)) {
				return `!!${uri.slice(YAML_TAG_PREFIX.length)}`;
			}
			// Non-standard — expand to verbatim
			return `!<${uri}>`;
		}
	}

	// Primary handle: !suffix (non-empty suffix)
	if (tag.startsWith("!") && tag.length > 1 && !tag.startsWith("!!")) {
		const prefix = tagMap.get("!");
		if (prefix) {
			const uri = prefix + tag.slice(1);
			// Check if resolved URI is a standard YAML tag
			if (uri.startsWith(YAML_TAG_PREFIX)) {
				return `!!${uri.slice(YAML_TAG_PREFIX.length)}`;
			}
			// Non-standard — expand to verbatim
			return `!<${uri}>`;
		}
	}

	// Non-specific tag (! alone) or no matching handle
	return tag;
}

/**
 * Recursively normalizes tags on all AST nodes using document directives.
 */
function normalizeNodeTags(node: YamlNode, tagMap: Map<string, string>): YamlNode {
	if (node instanceof YamlScalar) {
		return new YamlScalar({
			value: node.value,
			style: node.style,
			...(node.tag ? { tag: normalizeTag(node.tag, tagMap) } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...(node.comment !== undefined ? { comment: node.comment } : {}),
			...(node.chomp !== undefined ? { chomp: node.chomp } : {}),
			...(node.raw !== undefined ? { raw: node.raw } : {}),
			...(node.sourceMultiline !== undefined ? { sourceMultiline: node.sourceMultiline } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	if (node instanceof YamlMap) {
		return new YamlMap({
			items: node.items.map(
				(pair) =>
					new YamlPair({
						key: normalizeNodeTags(pair.key, tagMap),
						value: pair.value ? normalizeNodeTags(pair.value, tagMap) : null,
						...(pair.comment !== undefined ? { comment: pair.comment } : {}),
					}),
			),
			style: node.style,
			...(node.tag ? { tag: normalizeTag(node.tag, tagMap) } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...(node.comment !== undefined ? { comment: node.comment } : {}),
			...(node.sourceMultiline !== undefined ? { sourceMultiline: node.sourceMultiline } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	if (node instanceof YamlSeq) {
		return new YamlSeq({
			items: node.items.map((item) => normalizeNodeTags(item, tagMap)),
			style: node.style,
			...(node.tag ? { tag: normalizeTag(node.tag, tagMap) } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...(node.comment !== undefined ? { comment: node.comment } : {}),
			...(node.sourceMultiline !== undefined ? { sourceMultiline: node.sourceMultiline } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	return node;
}

// ---------------------------------------------------------------------------
// Comment stripping (for canonical output)
// ---------------------------------------------------------------------------

/**
 * Recursively strips all comment fields from AST nodes.
 * Used when forceDefaultStyles is true to produce canonical output.
 */
export function stripNodeComments(node: YamlNode): YamlNode {
	if (node instanceof YamlScalar) {
		return new YamlScalar({
			value: node.value,
			style: node.style,
			...(node.tag !== undefined ? { tag: node.tag } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...(node.chomp !== undefined ? { chomp: node.chomp } : {}),
			...(node.raw !== undefined ? { raw: node.raw } : {}),
			...(node.sourceMultiline !== undefined ? { sourceMultiline: node.sourceMultiline } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	if (node instanceof YamlMap) {
		return new YamlMap({
			items: node.items.map(
				(pair) =>
					new YamlPair({
						key: stripNodeComments(pair.key),
						value: pair.value ? stripNodeComments(pair.value) : null,
					}),
			),
			style: node.style,
			...(node.tag !== undefined ? { tag: node.tag } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...(node.sourceMultiline !== undefined ? { sourceMultiline: node.sourceMultiline } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	if (node instanceof YamlSeq) {
		return new YamlSeq({
			items: node.items.map(stripNodeComments),
			style: node.style,
			...(node.tag !== undefined ? { tag: node.tag } : {}),
			...(node.anchor !== undefined ? { anchor: node.anchor } : {}),
			...(node.sourceMultiline !== undefined ? { sourceMultiline: node.sourceMultiline } : {}),
			offset: node.offset,
			length: node.length,
		});
	}
	return node;
}

// ---------------------------------------------------------------------------
// AST node stringification
// ---------------------------------------------------------------------------

/**
 * Stringifies a YAML AST node into lines (no leading indent), respecting
 * style metadata from the node.
 */
function stringifyNodeLines(node: YamlNode, ctx: StringifyContext, depth: number): string[] {
	// Depth guard, symmetric to the value-path trio: the node-path stringifier
	// (this fn plus its map/seq helpers) is mutually recursive with no natural
	// bound, so a synthetic AST nested deeper than the composer's cap would
	// overflow the stack as a RangeError defect on a public boundary
	// (YamlDocument.stringify / YamlDocument.schema encode). Parsed ASTs are
	// composer-bounded to MAX_NESTING_DEPTH and never trip this; only hand-built
	// deep trees do.
	if (depth > MAX_NESTING_DEPTH) throw new StringifyDepthExceeded();

	if (node instanceof YamlScalar) {
		return stringifyScalarNodeLines(node, ctx);
	}
	if (node instanceof YamlMap) {
		return stringifyMapNodeLines(node, ctx, depth);
	}
	if (node instanceof YamlSeq) {
		return stringifySeqNodeLines(node, ctx, depth);
	}
	if (node instanceof YamlAlias) {
		return [`*${node.name}`];
	}
	return ["null"];
}

/**
 * Stringifies a YamlScalar node into lines, using the node's style metadata.
 */
function stringifyScalarNodeLines(node: YamlScalar, ctx: StringifyContext): string[] {
	// When forcing default styles, preserve the node's original style for multiline
	// strings (block-literal vs block-folded vs double-quoted) since the canonical
	// output retains scalar presentation style even in normalized form.
	const nodeStyle = node.style ?? ctx.defaultScalarStyle;
	const style: ScalarStyle = nodeStyle;
	const val = node.value;

	// Empty scalar (zero-length in source) with tag or anchor: render just tag/anchor
	const isEmpty = node.length === 0 && (val === null || val === undefined || val === "");
	if (isEmpty && (node.tag || node.anchor)) {
		const parts: string[] = [];
		if (node.tag) parts.push(node.tag);
		if (node.anchor) parts.push(`&${node.anchor}`);
		return [parts.join(" ")];
	}

	let lines: string[];
	if (val === null || val === undefined) {
		// Empty scalar (zero-length) without tag/anchor renders as empty string
		if (isEmpty) {
			lines = [""];
		} else {
			lines = ["null"];
		}
	} else if (typeof val === "boolean") {
		lines = [val ? "true" : "false"];
	} else if (typeof val === "number") {
		// Prefer the source representation when available so non-canonical
		// numeric formats (hex `0xFFEEBB`, trailing zeros `450.00`) survive
		// the round-trip.
		lines = [node.raw !== undefined ? node.raw : renderNumber(val)];
	} else if (typeof val === "string") {
		// When a tag is present, type-conflict quoting is unnecessary
		const rendered = renderString(
			val,
			style,
			" ".repeat(ctx.indent),
			!!node.tag,
			ctx.forceDefaultStyles,
			node.chomp,
			ctx.parentPosition,
		);
		lines = rendered.split("\n");
	} else {
		lines = [renderDoubleQuoted(String(val))];
	}
	// Prepend tag first, then anchor, so the final output reads &anchor !!tag value
	if (node.tag) {
		lines[0] = `${node.tag} ${lines[0]}`;
	}
	if (node.anchor) {
		lines[0] = `&${node.anchor} ${lines[0]}`;
	}
	return lines;
}

/**
 * Stringifies a YamlMap node into lines, using the node's collection style.
 */
function stringifyMapNodeLines(node: YamlMap, ctx: StringifyContext, depth: number): string[] {
	const style: CollectionStyle = ctx.forceDefaultStyles
		? ctx.defaultCollectionStyle
		: (node.style ?? ctx.defaultCollectionStyle);
	let items = [...node.items];
	if (ctx.sortKeys) {
		items = items.sort((a, b) => {
			const ka = a.key instanceof YamlScalar ? String(a.key.value) : "";
			const kb = b.key instanceof YamlScalar ? String(b.key.value) : "";
			return ka < kb ? -1 : ka > kb ? 1 : 0;
		});
	}

	if (items.length === 0) {
		let line = "{}";
		const emptyPrefix = buildMetadataPrefix(node.tag, node.anchor);
		if (emptyPrefix) line = `${emptyPrefix} ${line}`;
		return [line];
	}

	if (style === "flow") {
		const pairs = items.map((pair) => {
			const keyStr = pair.key ? stringifyNodeLines(pair.key, ctx, depth + 1).join(" ") : "null";
			const valStr = pair.value ? stringifyNodeLines(pair.value, ctx, depth + 1).join(" ") : "null";
			return `${keyStr}: ${valStr}`;
		});
		let line = `{${pairs.join(", ")}}`;
		const flowPrefix = buildMetadataPrefix(node.tag, node.anchor);
		if (flowPrefix) line = `${flowPrefix} ${line}`;
		return [line];
	}

	// Block style
	const pad = " ".repeat(ctx.indent);
	const lines: string[] = [];
	for (const pair of items) {
		// Explicit `? key\n: value` syntax is required when:
		// - Key is a YamlMap (mapping-as-key always uses `? ` so the inner
		//   pair's `:` is not confused with the outer pair's `:`)
		// - Key is a YamlSeq whose rendered form spans multiple lines (block
		//   style or multi-line flow). Single-line flow seqs (e.g. empty
		//   `[]`) can be implicit `[]: value` (M2N8/01).
		// - Key is a scalar whose value contains a newline (cannot be expressed
		//   as an implicit `key: value` line in block form)
		// - Key is a block-style scalar (block-literal/block-folded) whose
		//   header introduces a multi-line scalar
		const keyIsScalarWithNewline =
			pair.key instanceof YamlScalar &&
			((typeof pair.key.value === "string" && pair.key.value.includes("\n")) ||
				pair.key.style === "block-literal" ||
				pair.key.style === "block-folded");
		// A non-empty collection (YamlMap or YamlSeq) used as a key forces
		// explicit `? ` form because its block-rendered representation cannot
		// be inlined safely. Empty collections render as `[]` / `{}` on one
		// line and CAN be implicit (M2N8/01: `[]: x`).
		const keyIsNonEmptyCollection =
			(pair.key instanceof YamlMap || pair.key instanceof YamlSeq) && pair.key.items.length > 0;
		const isComplexKey = keyIsNonEmptyCollection || keyIsScalarWithNewline;
		if (isComplexKey) {
			const keyLines = stringifyNodeLines(pair.key, ctx, depth + 1);
			// Emit "? " followed by the key
			lines.push(`? ${keyLines[0]}`);
			// When the first key line is just metadata (`&anchor` and/or `!tag`),
			// the continuation lines are the actual collection content and should
			// be emitted without an extra indent — they sit at the same level as
			// `?` (compact form). Block-style scalar keys (`|`/`>`) already bake
			// their own indent into the rendered continuation lines, so no extra
			// pad is needed. Otherwise, indent continuation lines normally.
			const firstTokens = keyLines[0].trim().split(/\s+/).filter(Boolean);
			const firstIsMetaOnly =
				firstTokens.length > 0 && firstTokens.every((t) => t.startsWith("&") || t.startsWith("!"));
			const keyIsBlockScalar =
				pair.key instanceof YamlScalar && (pair.key.style === "block-literal" || pair.key.style === "block-folded");
			const contPad = firstIsMetaOnly || keyIsBlockScalar ? "" : pad;
			for (let k = 1; k < keyLines.length; k++) {
				lines.push(`${contPad}${keyLines[k]}`);
			}
			// Emit ": " followed by the value
			const valNode = pair.value;
			if (!valNode) {
				lines.push(":");
			} else {
				const valLines = stringifyNodeLines(valNode, ctx, depth + 1);
				if (valLines.length === 1) {
					lines.push(`: ${valLines[0]}`);
				} else {
					const first = valLines[0];
					// Detect block scalar headers and multi-line quoted scalars,
					// either bare or after an optional `&anchor` / `!tag` prefix.
					const firstStripped = stripScalarMetadataPrefix(first);
					const isBlockScalarHeader = firstStripped.startsWith("|") || firstStripped.startsWith(">");
					const valIsScalar = valNode instanceof YamlScalar;
					const isInlineQuoted = valIsScalar && (firstStripped.startsWith("'") || firstStripped.startsWith('"'));
					if (isBlockScalarHeader || isInlineQuoted) {
						lines.push(`: ${first}`);
						for (let v = 1; v < valLines.length; v++) {
							lines.push(valLines[v]);
						}
					} else if (first.startsWith("-")) {
						// Block sequence value — compact notation: first item on the
						// colon line, remaining items indented to align with it.
						lines.push(`: ${first}`);
						for (let v = 1; v < valLines.length; v++) {
							lines.push(`${pad}${valLines[v]}`);
						}
					} else {
						const valIsBlockMap =
							valNode instanceof YamlMap &&
							valNode.items.length > 0 &&
							(ctx.forceDefaultStyles ? ctx.defaultCollectionStyle : (valNode.style ?? ctx.defaultCollectionStyle)) ===
								"block";
						if (valIsBlockMap) {
							// Block mapping value — compact notation: first pair on the
							// colon line, remaining pairs indented to align with it.
							lines.push(`: ${first}`);
							for (let v = 1; v < valLines.length; v++) {
								lines.push(`${pad}${valLines[v]}`);
							}
						} else {
							lines.push(":");
							for (const vl of valLines) {
								lines.push(`${pad}${vl}`);
							}
						}
					}
				}
			}
			continue;
		}

		// 5T43: in canonical mode, drop quotes from a quoted key whose content
		// is a simple identifier when the source map was a SINGLE-line flow
		// collection. The quotes were structurally needed in flow source
		// (e.g. `"key":value` cannot be `key:value` because flow tokens are
		// delimiter-tight) but in the converted block form an unquoted plain
		// key is unambiguous. Restricted to identifier-style content
		// (alphanumeric+underscore, no spaces) so multi-word quoted keys
		// like `"single line"` are kept (9BXH).
		let resolvedKeyStr: string;
		if (
			ctx.forceDefaultStyles &&
			node.style === "flow" &&
			node.sourceMultiline !== true &&
			pair.key instanceof YamlScalar &&
			(pair.key.style === "single-quoted" || pair.key.style === "double-quoted") &&
			typeof pair.key.value === "string" &&
			/^[A-Za-z_][A-Za-z0-9_]*$/.test(pair.key.value)
		) {
			resolvedKeyStr = pair.key.value;
		} else {
			resolvedKeyStr = pair.key ? stringifyNodeLines(pair.key, ctx, depth + 1).join(" ") : "null";
		}
		const keyStr = resolvedKeyStr;
		// Alias keys need a space before the colon to avoid the alias name
		// absorbing the `:`. Empty scalar keys whose only rendering is an
		// anchor or tag (e.g. `&a` or `!!str`) need the same disambiguation.
		const keyIsAnchoredOrTaggedEmpty =
			pair.key instanceof YamlScalar &&
			pair.key.length === 0 &&
			(pair.key.value === null || pair.key.value === undefined || pair.key.value === "") &&
			(pair.key.anchor !== undefined || pair.key.tag !== undefined);
		const sep = pair.key instanceof YamlAlias || keyIsAnchoredOrTaggedEmpty ? " :" : ":";
		const valNode = pair.value;
		if (!valNode) {
			// 4ABK: when the document ROOT is a multi-line flow map AND the
			// pair has a non-empty plain key, emit `key: null` rather than
			// `key:` so the null is unambiguous in canonical (block) form.
			// Restricted to root via `ctx.parentPosition === undefined` so
			// nested flow maps (8KB6: flow inside a block-seq item) keep
			// `key:`. Single-line flow root keeps `key:` too — only
			// multi-line flow root triggers the explicit-null form.
			const isPlainKey = pair.key instanceof YamlScalar && pair.key.style === "plain";
			const keyIsNonEmpty = pair.key instanceof YamlScalar && pair.key.length > 0;
			const isRootFlowMap = ctx.parentPosition === undefined && node.style === "flow" && node.sourceMultiline === true;
			if (ctx.forceDefaultStyles && isRootFlowMap && isPlainKey && keyIsNonEmpty) {
				lines.push(`${keyStr}${sep} null`);
			} else {
				lines.push(`${keyStr}${sep}`);
			}
			continue;
		}
		const valCtx: StringifyContext = { ...ctx, parentPosition: "block-map-value" };
		const valLines = stringifyNodeLines(valNode, valCtx, depth + 1);
		const isBlockSeqValue =
			valNode instanceof YamlSeq &&
			valNode.items.length > 0 &&
			(ctx.forceDefaultStyles ? ctx.defaultCollectionStyle : (valNode.style ?? ctx.defaultCollectionStyle)) === "block";
		if (isBlockSeqValue) {
			// Block sequence as mapping value: compact notation (no extra indent)
			// by default; one indent level when `indentSequences` is set (the
			// `yaml` npm package's default presentation). Empty lines (block
			// scalar bodies) are never padded — no trailing whitespace.
			// If seq has metadata (anchor/tag), place it on the key line
			const seqMeta = buildMetadataPrefix(valNode.tag, valNode.anchor);
			const startIdx = seqMeta ? 1 : 0; // skip metadata line if present
			lines.push(seqMeta ? `${keyStr}${sep} ${seqMeta}` : `${keyStr}${sep}`);
			for (let i = startIdx; i < valLines.length; i++) {
				const vl = valLines[i];
				lines.push(ctx.indentSequences && vl !== "" ? `${pad}${vl}` : vl);
			}
		} else if (
			valNode instanceof YamlMap &&
			valNode.items.length > 0 &&
			(ctx.forceDefaultStyles ? ctx.defaultCollectionStyle : (valNode.style ?? ctx.defaultCollectionStyle)) === "block"
		) {
			// Non-empty block mapping as value: put on next line with indent
			const mapMeta = buildMetadataPrefix(valNode.tag, valNode.anchor);
			const startIdx = mapMeta ? 1 : 0;
			lines.push(mapMeta ? `${keyStr}${sep} ${mapMeta}` : `${keyStr}${sep}`);
			for (let i = startIdx; i < valLines.length; i++) {
				lines.push(`${pad}${valLines[i]}`);
			}
		} else if (valLines.length === 1) {
			// Empty value: `key:` with no trailing space
			lines.push(valLines[0] === "" ? `${keyStr}${sep}` : `${keyStr}${sep} ${valLines[0]}`);
		} else {
			const first = valLines[0];
			// Detect block scalar headers and multi-line quoted scalars after the
			// optional `&anchor` / `!tag` prefix that the scalar renderer may add.
			const firstStripped = stripScalarMetadataPrefix(first);
			const isBlockScalarHeader = firstStripped.startsWith("|") || firstStripped.startsWith(">");
			const valIsScalar = valNode instanceof YamlScalar;
			const isInlineQuoted = valIsScalar && (firstStripped.startsWith("'") || firstStripped.startsWith('"'));
			if (isBlockScalarHeader || isInlineQuoted) {
				lines.push(`${keyStr}${sep} ${first}`);
				for (let i = 1; i < valLines.length; i++) {
					lines.push(valLines[i]);
				}
			} else {
				// Check if this is a block map value with metadata prefix
				const isBlockMapValue =
					valNode instanceof YamlMap &&
					(ctx.forceDefaultStyles ? ctx.defaultCollectionStyle : (valNode.style ?? ctx.defaultCollectionStyle)) ===
						"block";
				const mapMeta = isBlockMapValue ? buildMetadataPrefix(valNode.tag, valNode.anchor) : undefined;
				if (mapMeta) {
					// Place metadata on key line, skip metadata line in valLines
					lines.push(`${keyStr}${sep} ${mapMeta}`);
					for (let i = 1; i < valLines.length; i++) {
						lines.push(`${pad}${valLines[i]}`);
					}
				} else {
					lines.push(`${keyStr}${sep}`);
					for (const vl of valLines) {
						lines.push(`${pad}${vl}`);
					}
				}
			}
		}
	}
	// Anchor/tag on block collections: place on own line before content
	const prefix = buildMetadataPrefix(node.tag, node.anchor);
	if (prefix) {
		lines.unshift(prefix);
	}
	return lines;
}

/**
 * Builds a metadata prefix string from tag and anchor.
 * Returns the combined prefix or undefined if neither is present.
 */
function buildMetadataPrefix(tag: string | undefined, anchor: string | undefined): string | undefined {
	if (!tag && !anchor) return undefined;
	// Canonical ordering: &anchor !!tag (anchor before tag)
	const parts: string[] = [];
	if (anchor) parts.push(`&${anchor}`);
	if (tag) parts.push(tag);
	return parts.join(" ");
}

/**
 * Strips a leading run of `&anchor`/`!tag` metadata tokens (each followed by
 * whitespace) from a rendered scalar line and returns the remainder. Used to
 * detect quoted/block scalar style after the optional metadata prefix that
 * `stringifyScalarNodeLines` may prepend to the first output line.
 */
function stripScalarMetadataPrefix(line: string): string {
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (ch !== "&" && ch !== "!") break;
		let j = i + 1;
		while (j < line.length && line[j] !== " " && line[j] !== "\t") j++;
		if (j >= line.length || j === i + 1) break;
		while (j < line.length && (line[j] === " " || line[j] === "\t")) j++;
		i = j;
	}
	return line.slice(i);
}

/**
 * Stringifies a YamlSeq node into lines, using the node's collection style.
 */
function stringifySeqNodeLines(node: YamlSeq, ctx: StringifyContext, depth: number): string[] {
	const style: CollectionStyle = ctx.forceDefaultStyles
		? ctx.defaultCollectionStyle
		: (node.style ?? ctx.defaultCollectionStyle);
	const items = [...node.items];

	if (items.length === 0) {
		let line = "[]";
		const emptyPrefix = buildMetadataPrefix(node.tag, node.anchor);
		if (emptyPrefix) line = `${emptyPrefix} ${line}`;
		return [line];
	}

	if (style === "flow") {
		const parts = items.map((item) => stringifyNodeLines(item, ctx, depth + 1).join(" "));
		let line = `[${parts.join(", ")}]`;
		const flowPrefix = buildMetadataPrefix(node.tag, node.anchor);
		if (flowPrefix) line = `${flowPrefix} ${line}`;
		return [line];
	}

	// Block style
	const pad = " ".repeat(ctx.indent);
	const lines: string[] = [];
	const itemCtx: StringifyContext = { ...ctx, parentPosition: "block-seq-item" };
	for (const item of items) {
		const itemLines = stringifyNodeLines(item, itemCtx, depth + 1);
		if (itemLines.length === 1) {
			// Empty value: just `-` with no trailing space
			lines.push(itemLines[0] === "" ? "-" : `- ${itemLines[0]}`);
		} else {
			const first = itemLines[0];
			// Block scalar headers and multi-line quoted scalars (when the item is
			// itself a YamlScalar) place their first line inline after `- `, with
			// continuation lines emitted as-is. Detection allows an optional
			// `&anchor` / `!tag` prefix that the scalar renderer may have added.
			const firstStripped = stripScalarMetadataPrefix(first);
			const itemIsScalar = item instanceof YamlScalar;
			const isInlineScalar =
				firstStripped.startsWith("|") ||
				firstStripped.startsWith(">") ||
				(itemIsScalar && (firstStripped.startsWith("'") || firstStripped.startsWith('"')));
			if (isInlineScalar) {
				lines.push(`- ${first}`);
				for (let i = 1; i < itemLines.length; i++) {
					lines.push(itemLines[i]);
				}
			} else {
				// Nested mapping or sequence — indent continuation lines by one level
				lines.push(first === "" ? "-" : `- ${first}`);
				for (let i = 1; i < itemLines.length; i++) {
					lines.push(`${pad}${itemLines[i]}`);
				}
			}
		}
	}
	// Anchor/tag on block sequences: place on own line before content
	const prefix = buildMetadataPrefix(node.tag, node.anchor);
	if (prefix) {
		lines.unshift(prefix);
	}
	return lines;
}

// ---------------------------------------------------------------------------
// Engine entry points
// ---------------------------------------------------------------------------

/**
 * Converts a JavaScript value into a YAML text string.
 *
 * Handles all primitive types, arrays, and plain objects. Special numbers
 * (`Infinity`, `-Infinity`, `NaN`) are rendered as `.inf`, `-.inf`, and
 * `.nan` respectively. Circular references throw {@link StringifyFailure}.
 */
export function stringifyValue(value: unknown, options?: StringifyOptionsInput): string {
	const ctx = createContext(options);
	const result = stringifyLines(value, ctx, 0).join("\n");
	return (options?.finalNewline ?? true) ? `${result}\n` : result;
}

/**
 * Converts a composed YAML document AST into a YAML text string, preserving
 * the style metadata encoded in each AST node.
 *
 * Scalar nodes use their `style` field to control rendering; collection
 * nodes use their `style` field (`"block"` or `"flow"`). Nodes without an
 * explicit style fall back to the defaults in `options`.
 */
export function stringifyDocument(doc: RawYamlDocument, options?: StringifyOptionsInput): string {
	const ctx = createContext(options);
	const finalNewline = options?.finalNewline ?? true;

	// Strip comments and normalize tags when producing canonical output
	let contents = doc.contents;
	const docComment = ctx.forceDefaultStyles ? undefined : doc.comment;
	if (ctx.forceDefaultStyles && contents) {
		contents = stripNodeComments(contents);
		const tagMap = buildTagMap(doc.directives);
		contents = normalizeNodeTags(contents, tagMap);
	}

	if (contents === null) {
		if (ctx.forceDefaultStyles) {
			// Empty document in canonical mode: emit --- for doc-start markers.
			// Bare ... (no doc-start, no content) produces empty output.
			if (doc.hasDocumentStart) {
				const docEnd = doc.hasDocumentEnd ? "...\n" : "";
				return `---\n${docEnd}`;
			}
			return "";
		}
		return finalNewline ? "null\n" : "null";
	}

	const result = stringifyNodeLines(contents, ctx, 0).join("\n");
	const body = finalNewline ? `${result}\n` : result;

	// In canonical mode, an explicit `...` end marker is required when:
	// - The final emitted scalar uses keep-chomp (`|+` or `>+`) — without it
	//   the reader cannot tell where the open-ended block scalar ends.
	// - The root is an anchored plain scalar with explicit `---` — `...`
	//   binds the anchor to a definite node identity so trailing content
	//   isn't absorbed into the scalar value.
	const needsTerminatorForKeepChomp = ctx.forceDefaultStyles && endsWithKeepChomp(result);
	const needsTerminatorForAnchoredPlainScalar =
		ctx.forceDefaultStyles &&
		doc.hasDocumentStart &&
		contents instanceof YamlScalar &&
		contents.style === "plain" &&
		contents.anchor !== undefined &&
		!contents.tag;
	// XLQ9: a multi-line plain scalar root whose folded value contains
	// a `%`-introduced directive-like substring (e.g. "scalar %YAML 1.2")
	// needs `...` so a follow-on parser cannot re-interpret the trailing
	// `%XXX` as a directive in some other YAML stream context. libyaml's
	// canonical emitter is conservative here. Other multi-line plain
	// roots (3MYT, EX5H, EXG3) without a `%` continuation render
	// without `...`.
	const looksLikeDirectiveContinuation =
		contents instanceof YamlScalar && typeof contents.value === "string" && / %[A-Z]/.test(contents.value);
	const needsTerminatorForMultilinePlainScalar =
		ctx.forceDefaultStyles &&
		doc.hasDocumentStart &&
		contents instanceof YamlScalar &&
		contents.style === "plain" &&
		contents.sourceMultiline === true &&
		looksLikeDirectiveContinuation;
	// K54U: `---<TAB>scalar` source needs `...` terminator. libyaml's
	// canonical emitter is conservative when a tab follows `---` —
	// downstream tooling that re-tokenises might mis-handle the tab,
	// so the explicit document-end marker keeps things unambiguous.
	const needsTerminatorForDocStartTab = ctx.forceDefaultStyles && doc.hasDocumentStartTab === true;
	const docEnd =
		doc.hasDocumentEnd ||
		needsTerminatorForKeepChomp ||
		needsTerminatorForAnchoredPlainScalar ||
		needsTerminatorForMultilinePlainScalar ||
		needsTerminatorForDocStartTab
			? "...\n"
			: "";

	if (doc.hasDocumentStart) {
		const rootTag = contents && "tag" in contents ? contents.tag : undefined;
		const rootAnchor = contents && "anchor" in contents ? contents.anchor : undefined;
		const isCollection = contents instanceof YamlMap || contents instanceof YamlSeq;
		const isScalar = contents instanceof YamlScalar;

		if (rootTag || rootAnchor) {
			// Build metadata prefix — canonical ordering: &anchor !!tag
			const metaParts: string[] = [];
			if (rootAnchor) metaParts.push(`&${rootAnchor}`);
			if (rootTag) metaParts.push(rootTag);
			const metaStr = metaParts.join(" ");

			// Strip tag/anchor prefix from body (already prepended by stringifyNodeLines)
			let bodyClean = body;
			// For block collections, the metadata is on its own line
			const metaLinePrefix = `${metaStr}\n`;
			const metaInlinePrefix = `${metaStr} `;
			if (bodyClean.startsWith(metaLinePrefix)) {
				bodyClean = bodyClean.slice(metaLinePrefix.length);
			} else if (bodyClean.startsWith(metaInlinePrefix)) {
				bodyClean = bodyClean.slice(metaInlinePrefix.length);
			}

			const docStart = `--- ${metaStr}`;
			const sep = isCollection ? "\n" : " ";
			return docComment
				? `# ${docComment}\n${docStart}${sep}${bodyClean}${docEnd}`
				: `${docStart}${sep}${bodyClean}${docEnd}`;
		}

		// No tag/anchor — inline scalars after ---
		if (isScalar) {
			return docComment ? `# ${docComment}\n--- ${body}${docEnd}` : `--- ${body}${docEnd}`;
		}
		return docComment ? `# ${docComment}\n---\n${body}${docEnd}` : `---\n${body}${docEnd}`;
	}
	return docComment ? `# ${docComment}\n${body}${docEnd}` : `${body}${docEnd}`;
}
