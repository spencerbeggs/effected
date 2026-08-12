// empty-lines (#129): caps runs of consecutive blank lines — in the body
// (`max`), at document start (`maxStart`) and at document end (`maxEnd`).
// Blank lines inside scalar content are the value's business and are
// skipped. The fix deletes the excess lines surgically.

import { Schema } from "effect";
import { YamlEdit } from "../../YamlEdit.js";
import type { LintContext, YamlRule } from "../../YamlLintRule.js";
import { YamlLintDiagnostic, YamlLintSeverity } from "../../YamlLintRule.js";
import { insideScalarSpan, nonNegativeIntegerOption } from "./util.js";

/**
 * Options for `empty-lines`: `max` consecutive blank lines in the body
 * (default 2), `maxStart` at the document start and `maxEnd` at the end
 * (both default 0).
 */
export const emptyLinesOptions = Schema.Struct({
	severity: Schema.optionalKey(YamlLintSeverity),
	max: Schema.optionalKey(nonNegativeIntegerOption),
	maxStart: Schema.optionalKey(nonNegativeIntegerOption),
	maxEnd: Schema.optionalKey(nonNegativeIntegerOption),
});

interface EmptyLinesOptions {
	readonly max?: number;
	readonly maxStart?: number;
	readonly maxEnd?: number;
}

/** Runs of blank lines beyond the configured caps, with a deleting fix. */
export const emptyLines: YamlRule = {
	id: "empty-lines",
	check: (ctx: LintContext, options) => {
		const opts = (options ?? {}) as EmptyLinesOptions;
		const max = opts.max ?? 2;
		const maxStart = opts.maxStart ?? 0;
		const maxEnd = opts.maxEnd ?? 0;
		const out: Array<YamlLintDiagnostic> = [];
		const lines = ctx.lines;
		// Line text keeps a CRLF file's `\r` (only `\n` terminates a LintLine),
		// so a CRLF blank line is `"\r"`, not `""`.
		const isBlank = (text: string): boolean => text === "" || text === "\r";
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			if (line === undefined || !isBlank(line.text) || insideScalarSpan(ctx.tokens, line.offset)) {
				i++;
				continue;
			}
			// A run of blank lines [i, end).
			let end = i;
			while (end < lines.length && isBlank(lines[end]?.text ?? "x")) end++;
			const runLength = end - i;
			const atStart = i === 0;
			const atEnd = end === lines.length;
			const allowed = atStart ? maxStart : atEnd ? maxEnd : max;
			if (runLength > allowed) {
				const firstExcess = lines[i + allowed];
				const lastBlank = lines[end - 1];
				if (firstExcess !== undefined && lastBlank !== undefined) {
					// Delete from the first excess blank line's start through the
					// last blank line's terminator — derived from the NEXT line's
					// offset (or the text end) so a CRLF terminator goes whole.
					const nextLine = lines[end];
					const deleteEnd = nextLine !== undefined ? nextLine.offset : ctx.text.length;
					out.push(
						new YamlLintDiagnostic({
							rule: "empty-lines",
							severity: "error",
							message: `Too many consecutive blank lines (${runLength} > ${allowed})`,
							offset: firstExcess.offset,
							length: deleteEnd - firstExcess.offset,
							line: firstExcess.number,
							character: 0,
							fix: YamlEdit.make({
								offset: firstExcess.offset,
								length: deleteEnd - firstExcess.offset,
								content: "",
							}),
						}),
					);
				}
			}
			i = end;
		}
		return out;
	},
};
