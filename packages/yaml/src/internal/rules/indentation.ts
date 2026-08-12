// indentation (#129): block-structure indent STYLE — the one rule that
// reasons about structure rather than a token and its neighbours, built
// last by design. Two checks:
//
//   1. Every new block level indents by the same unit (`spaces`: a number,
//      or "consistent" — the first observed delta decides).
//   2. Sequences under a mapping key follow one policy (`indentSequences`:
//      true, false, or "consistent" — the first occurrence decides).
//
// Structural LEGALITY is the parser's job (a dedent to an unknown level is
// a parse error parse-validity reports); this rule only speaks where the
// document is well-formed and the style drifts. Lines inside scalar content
// or flow collections are skipped — their layout is value or flow syntax,
// not block indentation. No fix: reindenting is formatting.

import { Schema } from "effect";
import type { LintContext, LintLine, YamlRule } from "../../YamlLintRule.js";
import { YamlLintDiagnostic, YamlLintSeverity } from "../../YamlLintRule.js";
import { isScalarContinuationLine, nonNegativeIntegerOption } from "./util.js";

/**
 * Options for `indentation`: `spaces` per level (number or "consistent",
 * default "consistent") and `indentSequences` (boolean or "consistent",
 * default "consistent").
 */
export const indentationOptions = Schema.Struct({
	severity: Schema.optionalKey(YamlLintSeverity),
	spaces: Schema.optionalKey(Schema.Union([nonNegativeIntegerOption, Schema.Literals(["consistent"])])),
	indentSequences: Schema.optionalKey(Schema.Union([Schema.Boolean, Schema.Literals(["consistent"])])),
});

interface IndentationOptions {
	readonly spaces?: number | "consistent";
	readonly indentSequences?: boolean | "consistent";
}

interface ContentLine {
	readonly line: LintLine;
	readonly indent: number;
	readonly firstChar: string;
}

/** Flow-collection depth at each line start, from the token stream. */
const flowDepthAtLineStarts = (ctx: LintContext): ReadonlyArray<number> => {
	const depths: Array<number> = [];
	let depth = 0;
	let tokenIdx = 0;
	for (const line of ctx.lines) {
		// Advance through tokens that END at or before this line's start.
		while (tokenIdx < ctx.tokens.length) {
			const token = ctx.tokens[tokenIdx];
			if (token === undefined || token.offset + token.length > line.offset) break;
			if (token.kind === "flow-map-start" || token.kind === "flow-seq-start") depth++;
			if (token.kind === "flow-map-end" || token.kind === "flow-seq-end") depth = Math.max(0, depth - 1);
			tokenIdx++;
		}
		depths.push(depth);
	}
	return depths;
};

/** Block-structure indent style. */
export const indentation: YamlRule = {
	id: "indentation",
	check: (ctx, options) => {
		const opts = (options ?? {}) as IndentationOptions;
		const spacesOpt = opts.spaces ?? "consistent";
		const seqOpt = opts.indentSequences ?? "consistent";
		const out: Array<YamlLintDiagnostic> = [];

		// The content lines this rule speaks about.
		const flowDepths = flowDepthAtLineStarts(ctx);
		const content: Array<ContentLine> = [];
		for (const line of ctx.lines) {
			const indent = line.text.length - line.text.trimStart().length;
			const firstChar = line.text[indent];
			if (firstChar === undefined) continue; // blank
			if (firstChar === "#") continue; // comment lines are not block structure
			if (firstChar === "%") continue; // directives
			if (line.text.slice(0, indent).includes("\t")) continue; // tab indent is the parser's error
			if ((flowDepths[line.number] ?? 0) > 0) continue; // inside a flow collection
			if (isScalarContinuationLine(ctx.tokens, line.offset, line.offset + indent)) continue; // scalar content
			if (line.text.slice(indent).startsWith("---") || line.text.slice(indent).startsWith("...")) continue;
			content.push({ line, indent, firstChar });
		}

		// Check 1: every new level indents by one consistent unit.
		let unit = typeof spacesOpt === "number" ? spacesOpt : undefined;
		const stack: Array<number> = [0];
		for (const { line, indent } of content) {
			const top = stack[stack.length - 1] as number;
			if (indent > top) {
				const delta = indent - top;
				if (unit === undefined) {
					unit = delta;
				} else if (delta !== unit) {
					out.push(
						new YamlLintDiagnostic({
							rule: "indentation",
							severity: "error",
							message: `Indent of ${delta} spaces, expected ${unit}`,
							offset: line.offset,
							length: indent,
							line: line.number,
							character: 0,
						}),
					);
				}
				stack.push(indent);
			} else if (indent < top) {
				while (stack.length > 1 && (stack[stack.length - 1] as number) > indent) stack.pop();
				// A dedent to an unknown level is a parse error — parse-validity's
				// business, not style.
			}
		}

		// Check 2: sequences under a mapping key follow one policy. Detected
		// on consecutive content-line pairs `key:` → `- item`.
		let seqIndented = typeof seqOpt === "boolean" ? seqOpt : undefined;
		for (let i = 1; i < content.length; i++) {
			const prev = content[i - 1] as ContentLine;
			const curr = content[i] as ContentLine;
			if (curr.firstChar !== "-") continue;
			// The previous content line must open a mapping key (ends with `:`
			// after stripping a trailing comment).
			const prevText = prev.line.text.replace(/ #.*$/, "").trimEnd();
			if (!prevText.endsWith(":")) continue;
			if (curr.indent !== prev.indent && curr.indent !== prev.indent + (unit ?? curr.indent - prev.indent)) continue;
			const indented = curr.indent > prev.indent;
			if (seqIndented === undefined) {
				seqIndented = indented;
			} else if (indented !== seqIndented) {
				out.push(
					new YamlLintDiagnostic({
						rule: "indentation",
						severity: "error",
						message: seqIndented
							? "Sequence under a mapping key should be indented"
							: "Sequence under a mapping key should not be indented",
						offset: curr.line.offset,
						length: curr.indent,
						line: curr.line.number,
						character: 0,
					}),
				);
			}
		}

		return out;
	},
};
