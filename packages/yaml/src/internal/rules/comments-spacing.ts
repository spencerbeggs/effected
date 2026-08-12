// comments-spacing (#129): a `#` needs a space after it to read as prose,
// and a TRAILING comment needs breathing room from the content before it.
// Own-line versus trailing is decided from token adjacency (content before
// the comment on its line) — the P2 comment model's leading/trailing split
// at the source level. A shebang (`#!` at the very start of the stream) is
// exempt.

import { Schema } from "effect";
import { YamlEdit } from "../../YamlEdit.js";
import type { YamlRule } from "../../YamlLintRule.js";
import { YamlLintDiagnostic, YamlLintSeverity } from "../../YamlLintRule.js";
import { nonNegativeIntegerOption } from "./util.js";

/**
 * Options for `comments-spacing`: `minSpacesBefore` between content and a
 * trailing `#` (default 1 — the kit's own emission spelling) and
 * `requireSpaceAfter` the `#` (default `true`).
 */
export const commentsSpacingOptions = Schema.Struct({
	severity: Schema.optionalKey(YamlLintSeverity),
	minSpacesBefore: Schema.optionalKey(nonNegativeIntegerOption),
	requireSpaceAfter: Schema.optionalKey(Schema.Boolean),
});

interface CommentsSpacingOptions {
	readonly minSpacesBefore?: number;
	readonly requireSpaceAfter?: boolean;
}

/** Comment spacing: after the `#`, and before a trailing comment's `#`. */
export const commentsSpacing: YamlRule = {
	id: "comments-spacing",
	check: (ctx, options) => {
		const opts = (options ?? {}) as CommentsSpacingOptions;
		const minBefore = opts.minSpacesBefore ?? 1;
		const requireAfter = opts.requireSpaceAfter ?? true;
		const out: Array<YamlLintDiagnostic> = [];
		for (const token of ctx.tokens) {
			if (token.kind !== "comment") continue;
			// Shebang exemption: `#!` at the very start of the stream.
			if (token.offset === 0 && token.text.startsWith("#!")) continue;
			// Space after `#`: a bare `#` is fine, `#text` is not.
			if (requireAfter && token.text.length > 1 && !/[ \t]/.test(token.text[1] as string)) {
				out.push(
					new YamlLintDiagnostic({
						rule: "comments-spacing",
						severity: "error",
						message: 'Missing space after "#"',
						offset: token.offset,
						length: 1,
						line: token.line,
						character: token.character,
						fix: YamlEdit.make({ offset: token.offset + 1, length: 0, content: " " }),
					}),
				);
			}
			// Space before a TRAILING comment's `#`: only when content precedes
			// the comment on its line (own-line comments are indentation's
			// business).
			let i = token.offset - 1;
			let spaces = 0;
			while (i >= 0 && (ctx.text[i] === " " || ctx.text[i] === "\t")) {
				spaces++;
				i--;
			}
			const hasContentBefore = i >= 0 && ctx.text[i] !== "\n" && ctx.text[i] !== "\r";
			if (hasContentBefore && spaces < minBefore) {
				out.push(
					new YamlLintDiagnostic({
						rule: "comments-spacing",
						severity: "error",
						message: `Too few spaces before comment (${spaces} < ${minBefore})`,
						offset: token.offset - spaces,
						length: spaces,
						line: token.line,
						character: token.character - spaces,
						fix: YamlEdit.make({
							offset: token.offset,
							length: 0,
							content: " ".repeat(minBefore - spaces),
						}),
					}),
				);
			}
		}
		return out;
	},
};
