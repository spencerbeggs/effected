// hyphen-spacing: at most one space after the block-sequence `-`
// indicator. Spaces BEFORE the hyphen are indentation — the indentation
// rule's business — and a comment after the hyphen belongs to
// comments-spacing.

import { Schema } from "effect";
import { YamlEdit } from "../../YamlEdit.js";
import type { YamlRule } from "../../YamlLintRule.js";
import { YamlLintDiagnostic, YamlLintSeverity } from "../../YamlLintRule.js";
import { insideComposedScalar, multilineBlockCollectionIn, positiveIntegerOption } from "./util.js";

/**
 * Options for `hyphen-spacing`: `maxSpacesAfter` (default 1) after the `-`.
 * At least one separation space must follow the indicator — `0` would make
 * the fix emit `-item`, a plain scalar, not a sequence entry.
 */
export const hyphenSpacingOptions = Schema.Struct({
	severity: Schema.optionalKey(YamlLintSeverity),
	maxSpacesAfter: Schema.optionalKey(positiveIntegerOption),
});

interface HyphenSpacingOptions {
	readonly maxSpacesAfter?: number;
}

/** Spacing after the block-sequence `-` indicator. */
export const hyphenSpacing: YamlRule = {
	id: "hyphen-spacing",
	check: (ctx, options) => {
		const opts = (options ?? {}) as HyphenSpacingOptions;
		// Clamped so a hand-built options object cannot bypass the schema and
		// delete the separation space.
		const maxAfter = Math.max(1, opts.maxSpacesAfter ?? 1);
		const out: Array<YamlLintDiagnostic> = [];
		for (const token of ctx.tokens) {
			if (token.kind !== "block-seq-entry") continue;
			// The lexer can mint a hyphen the composer reads as scalar content:
			// `b\n -  a` folds into the plain scalar `"b -  a"`, and deleting
			// a space there changes the value. No entry, so no spacing to check.
			if (insideComposedScalar(ctx, token.offset)) continue;
			let j = token.offset + token.length;
			let after = 0;
			while (j < ctx.text.length && ctx.text[j] === " ") {
				after++;
				j++;
			}
			const next = ctx.text[j];
			if (next === undefined || next === "\n" || next === "\r" || next === "#") continue;
			if (after > maxAfter) {
				// A block collection opening after the hyphen and running onto
				// later lines pins those lines to its column: moving it re-parents
				// them. The finding stands and the fix declines.
				const safe = !multilineBlockCollectionIn(ctx, token.offset + token.length, j);
				out.push(
					new YamlLintDiagnostic({
						rule: "hyphen-spacing",
						severity: "error",
						message: `Too many spaces after "-" (${after} > ${maxAfter})`,
						offset: token.offset + token.length,
						length: after,
						line: token.line,
						character: token.character + token.length,
						...(safe
							? {
									fix: YamlEdit.make({
										offset: token.offset + token.length,
										length: after - maxAfter,
										content: "",
									}),
								}
							: {}),
					}),
				);
			}
		}
		return out;
	},
};
