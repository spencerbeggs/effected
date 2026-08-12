// document-start (#129): the `---` marker at the head of the stream —
// required (`present: true`, the default) or forbidden (`present: false`).
// Scope is deliberately the STREAM HEAD only: `---` separators between the
// documents of a multi-document stream are structure, not style — removing
// one would merge two documents, and no lint rule gets to do that.
//
// Opt-in: absent from both presets (many real-world corpora — workflow
// files above all — never carry the marker).

import { Schema } from "effect";
import { YamlEdit } from "../../YamlEdit.js";
import type { YamlRule } from "../../YamlLintRule.js";
import { YamlLintDiagnostic, YamlLintSeverity } from "../../YamlLintRule.js";

/** Options for `document-start`: require (`true`, default) or forbid the marker. */
export const documentStartOptions = Schema.Struct({
	severity: Schema.optionalKey(YamlLintSeverity),
	present: Schema.optionalKey(Schema.Boolean),
});

const TRIVIA = new Set(["newline", "whitespace", "comment", "byte-order-mark", "directive"]);

/** The `---` marker at the head of the stream. */
export const documentStart: YamlRule = {
	id: "document-start",
	check: (ctx, options) => {
		const present = (options as { readonly present?: boolean } | undefined)?.present ?? true;
		// The first non-trivia token decides: is the stream headed by `---`?
		const hasDirectives = ctx.tokens.some((t) => t.kind === "directive");
		const first = ctx.tokens.find((t) => !TRIVIA.has(t.kind));
		const headed = first?.kind === "document-start";
		if (present && !headed && ctx.text.trim() !== "") {
			return [
				new YamlLintDiagnostic({
					rule: "document-start",
					severity: "error",
					message: 'Missing "---" document start marker',
					offset: 0,
					length: 0,
					line: 0,
					character: 0,
					// A stream with %directives cannot take a synthesized `---` at
					// offset 0 (directives precede the marker); no fix there.
					...(hasDirectives ? {} : { fix: YamlEdit.make({ offset: 0, length: 0, content: "---\n" }) }),
				}),
			];
		}
		if (!present && headed && first !== undefined) {
			// Only a marker ALONE on its line takes a fix — `--- content` would
			// splice the content line. A stream with %directives REQUIRES the
			// marker, so removing it would invalidate the directives: no fix.
			const lineText = ctx.lines[first.line]?.text ?? "";
			const alone = !hasDirectives && lineText.trim() === "---";
			// The fix removes the marker line whole: marker plus its terminator
			// (two characters under CRLF, one under LF).
			const terminator = ctx.text.startsWith("\r\n", first.offset + first.length) ? 2 : 1;
			return [
				new YamlLintDiagnostic({
					rule: "document-start",
					severity: "error",
					message: 'Forbidden "---" document start marker',
					offset: first.offset,
					length: first.length,
					line: first.line,
					character: first.character,
					...(alone
						? { fix: YamlEdit.make({ offset: first.offset, length: first.length + terminator, content: "" }) }
						: {}),
				}),
			];
		}
		return [];
	},
};
