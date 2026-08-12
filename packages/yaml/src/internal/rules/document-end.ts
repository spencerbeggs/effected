// document-end (#129): the `...` marker at the tail of the stream —
// required (`present: true`, the default when the rule is enabled) or
// forbidden (`present: false`). Tail-of-stream scope only, mirroring
// document-start's head-of-stream scope: mid-stream `...` markers are
// document structure.
//
// Opt-in: absent from both presets.

import { Schema } from "effect";
import { YamlEdit } from "../../YamlEdit.js";
import type { YamlRule } from "../../YamlLintRule.js";
import { YamlLintDiagnostic, YamlLintSeverity } from "../../YamlLintRule.js";

/** Options for `document-end`: require (`true`, default) or forbid the marker. */
export const documentEndOptions = Schema.Struct({
	severity: Schema.optionalKey(YamlLintSeverity),
	present: Schema.optionalKey(Schema.Boolean),
});

const TRIVIA = new Set(["newline", "whitespace", "comment", "byte-order-mark"]);

/** The `...` marker at the tail of the stream. */
export const documentEnd: YamlRule = {
	id: "document-end",
	check: (ctx, options) => {
		const present = (options as { readonly present?: boolean } | undefined)?.present ?? true;
		// The last non-trivia token decides: does the stream end with `...`?
		const tail = [...ctx.tokens].reverse().find((t) => !TRIVIA.has(t.kind));
		const ended = tail?.kind === "document-end";
		if (present && !ended && ctx.text.trim() !== "") {
			const lastLine = ctx.lines[ctx.lines.length - 1];
			return [
				new YamlLintDiagnostic({
					rule: "document-end",
					severity: "error",
					message: 'Missing "..." document end marker',
					offset: ctx.text.length,
					length: 0,
					line: lastLine?.number ?? 0,
					character: lastLine?.text.length ?? 0,
					// The fix appends the marker line; a missing final newline is
					// eof-newline's business, so insert one first when needed.
					fix: YamlEdit.make({
						offset: ctx.text.length,
						length: 0,
						content: ctx.text.endsWith("\n") ? "...\n" : "\n...\n",
					}),
				}),
			];
		}
		if (!present && tail !== undefined && tail.kind === "document-end") {
			const lineText = ctx.lines[tail.line]?.text ?? "";
			const alone = lineText.trim() === "...";
			return [
				new YamlLintDiagnostic({
					rule: "document-end",
					severity: "error",
					message: 'Forbidden "..." document end marker',
					offset: tail.offset,
					length: tail.length,
					line: tail.line,
					character: tail.character,
					...(alone ? { fix: YamlEdit.make({ offset: tail.offset, length: tail.length + 1, content: "" }) } : {}),
				}),
			];
		}
		return [];
	},
};
