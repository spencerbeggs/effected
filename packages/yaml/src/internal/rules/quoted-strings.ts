// quoted-strings (#129): quote-style policy for string VALUE scalars (and
// sequence items) — keys are out of scope (they belong to `truthy`'s trap
// detection when they matter). `quoteType` defaults to DOUBLE — the one
// taste call the design doc pins for the default preset.
//
// Fixes are conservative: a quote swap or a wrap happens only when it
// provably preserves the parsed value (single-line, no escapes in play, no
// quote character of the target style in the content, no tag/anchor on the
// node); otherwise the diagnostic ships without a fix.

import { Schema } from "effect";
import { YamlEdit } from "../../YamlEdit.js";
import type { LintContext, YamlRule } from "../../YamlLintRule.js";
import { YamlLintDiagnostic, YamlLintSeverity } from "../../YamlLintRule.js";
import type { YamlScalar } from "../../YamlNode.js";
import { walkScalars } from "./util.js";

/**
 * Options for `quoted-strings`: the preferred `quoteType` (default
 * `"double"`) and whether plain string scalars are `required` to be quoted
 * at all (default `false` — only already-quoted scalars are policed).
 */
export const quotedStringsOptions = Schema.Struct({
	severity: Schema.optionalKey(YamlLintSeverity),
	quoteType: Schema.optionalKey(Schema.Literals(["single", "double"])),
	required: Schema.optionalKey(Schema.Boolean),
});

interface QuotedStringsOptions {
	readonly quoteType?: "single" | "double";
	readonly required?: boolean;
}

const positionOf = (ctx: LintContext, offset: number): { line: number; character: number } => {
	const line = ctx.lines.filter((l) => l.offset <= offset).at(-1);
	return line === undefined ? { line: 0, character: 0 } : { line: line.number, character: offset - line.offset };
};

/** A value-preserving requote/wrap edit, or undefined when none is safe. */
const safeQuoteFix = (ctx: LintContext, scalar: YamlScalar, quote: '"' | "'"): YamlEdit | undefined => {
	if (scalar.tag !== undefined || scalar.anchor !== undefined) return undefined;
	if (typeof scalar.value !== "string") return undefined;
	const raw = ctx.text.slice(scalar.offset, scalar.offset + scalar.length);
	if (raw.includes("\n")) return undefined;
	const inner = scalar.style === "plain" ? raw : raw.slice(1, -1);
	// Only when the raw inner text IS the value (no escapes, no doubled
	// quotes) and the target quote never appears in it does requoting
	// provably preserve the value.
	if (inner !== scalar.value) return undefined;
	if (inner.includes(quote)) return undefined;
	if (quote === '"' && inner.includes("\\")) return undefined;
	return YamlEdit.make({ offset: scalar.offset, length: scalar.length, content: `${quote}${inner}${quote}` });
};

/** Quote-style policy for string value scalars. */
export const quotedStrings: YamlRule = {
	id: "quoted-strings",
	check: (ctx, options) => {
		const opts = (options ?? {}) as QuotedStringsOptions;
		const quoteType = opts.quoteType ?? "double";
		const required = opts.required ?? false;
		const quote = quoteType === "double" ? '"' : "'";
		const wrongStyle = quoteType === "double" ? "single-quoted" : "double-quoted";
		const out: Array<YamlLintDiagnostic> = [];
		walkScalars(ctx.document.contents, "root", (scalar, role) => {
			if (role === "key") return;
			if (typeof scalar.value !== "string") return;
			if (scalar.style === wrongStyle) {
				const fix = safeQuoteFix(ctx, scalar, quote);
				const pos = positionOf(ctx, scalar.offset);
				out.push(
					new YamlLintDiagnostic({
						rule: "quoted-strings",
						severity: "error",
						message: `String should use ${quoteType} quotes`,
						offset: scalar.offset,
						length: scalar.length,
						line: pos.line,
						character: pos.character,
						...(fix !== undefined ? { fix } : {}),
					}),
				);
				return;
			}
			if (required && scalar.style === "plain" && scalar.length > 0) {
				const fix = safeQuoteFix(ctx, scalar, quote);
				const pos = positionOf(ctx, scalar.offset);
				out.push(
					new YamlLintDiagnostic({
						rule: "quoted-strings",
						severity: "error",
						message: `String should be quoted (${quoteType})`,
						offset: scalar.offset,
						length: scalar.length,
						line: pos.line,
						character: pos.character,
						...(fix !== undefined ? { fix } : {}),
					}),
				);
			}
		});
		return out;
	},
};
