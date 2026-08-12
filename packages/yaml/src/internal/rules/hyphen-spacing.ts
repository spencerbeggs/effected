// hyphen-spacing (#129): at most one space after the block-sequence `-`
// indicator. Spaces BEFORE the hyphen are indentation — the indentation
// rule's business — and a comment after the hyphen belongs to
// comments-spacing.

import { Schema } from "effect";
import { YamlEdit } from "../../YamlEdit.js";
import type { YamlRule } from "../../YamlLintRule.js";
import { YamlLintDiagnostic, YamlLintSeverity } from "../../YamlLintRule.js";
import { nonNegativeIntegerOption } from "./util.js";

/** Options for `hyphen-spacing`: `maxSpacesAfter` (default 1) after the `-`. */
export const hyphenSpacingOptions = Schema.Struct({
	severity: Schema.optionalKey(YamlLintSeverity),
	maxSpacesAfter: Schema.optionalKey(nonNegativeIntegerOption),
});

interface HyphenSpacingOptions {
	readonly maxSpacesAfter?: number;
}

/** Spacing after the block-sequence `-` indicator. */
export const hyphenSpacing: YamlRule = {
	id: "hyphen-spacing",
	check: (ctx, options) => {
		const opts = (options ?? {}) as HyphenSpacingOptions;
		const maxAfter = opts.maxSpacesAfter ?? 1;
		const out: Array<YamlLintDiagnostic> = [];
		for (const token of ctx.tokens) {
			if (token.kind !== "block-seq-entry") continue;
			let j = token.offset + token.length;
			let after = 0;
			while (j < ctx.text.length && ctx.text[j] === " ") {
				after++;
				j++;
			}
			const next = ctx.text[j];
			if (next === undefined || next === "\n" || next === "\r" || next === "#") continue;
			if (after > maxAfter) {
				out.push(
					new YamlLintDiagnostic({
						rule: "hyphen-spacing",
						severity: "error",
						message: `Too many spaces after "-" (${after} > ${maxAfter})`,
						offset: token.offset + token.length,
						length: after,
						line: token.line,
						character: token.character + token.length,
						fix: YamlEdit.make({
							offset: token.offset + token.length,
							length: after - maxAfter,
							content: "",
						}),
					}),
				);
			}
		}
		return out;
	},
};
