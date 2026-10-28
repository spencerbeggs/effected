// colon-spacing: spaces around the block-mapping `:` indicator —
// none before it (a `key :` reads as a key containing a space), at most one
// after it. An explicit-value `:` at the head of its line is structure, not
// spacing, and a comment after the colon belongs to comments-spacing.

import { Schema } from "effect";
import { YamlEdit } from "../../YamlEdit.js";
import type { YamlRule } from "../../YamlLintRule.js";
import { YamlLintDiagnostic, YamlLintSeverity } from "../../YamlLintRule.js";
import {
	composedScalars,
	insideComposedScalar,
	laterLineInWindow,
	nonNegativeIntegerOption,
	positiveIntegerOption,
} from "./util.js";

/**
 * Options for `colon-spacing`: `maxSpacesBefore` (default 0) and
 * `maxSpacesAfter` (default 1) around the `:` indicator. `maxSpacesBefore: 0`
 * is legal (`key:` needs no space before the colon), but at least one
 * separation space must FOLLOW it — `0` would make the fix emit `a:val`, a
 * plain scalar, not a mapping entry.
 */
export const colonSpacingOptions = Schema.Struct({
	severity: Schema.optionalKey(YamlLintSeverity),
	maxSpacesBefore: Schema.optionalKey(nonNegativeIntegerOption),
	maxSpacesAfter: Schema.optionalKey(positiveIntegerOption),
});

interface ColonSpacingOptions {
	readonly maxSpacesBefore?: number;
	readonly maxSpacesAfter?: number;
}

/** Spacing around the block-mapping `:` indicator. */
export const colonSpacing: YamlRule = {
	id: "colon-spacing",
	check: (ctx, options) => {
		const opts = (options ?? {}) as ColonSpacingOptions;
		const maxBefore = opts.maxSpacesBefore ?? 0;
		// Clamped so a hand-built options object cannot bypass the schema and
		// delete the separation space.
		const maxAfter = Math.max(1, opts.maxSpacesAfter ?? 1);
		const out: Array<YamlLintDiagnostic> = [];
		for (const token of ctx.tokens) {
			if (token.kind !== "block-map-value") continue;
			// The lexer can mint an indicator the composer reads as scalar
			// content (`a\n  - :  b` folds into one plain scalar): that is no
			// colon at all, so there is no spacing to report or fix.
			if (insideComposedScalar(ctx, token.offset)) continue;
			// Spaces before: count the run, but only when non-space content
			// precedes it on the line — a `:` opening an explicit value sits
			// after indentation, which is not "space before the colon".
			let i = token.offset - 1;
			let before = 0;
			while (i >= 0 && ctx.text[i] === " ") {
				before++;
				i--;
			}
			const hasContentBefore = i >= 0 && ctx.text[i] !== "\n" && ctx.text[i] !== "\r" && ctx.text[i] !== "\t";
			// Spaces after: at most maxAfter before the value — unless the line
			// ends (value on the next line) or a comment follows (that spacing
			// is comments-spacing's business).
			let j = token.offset + token.length;
			let after = 0;
			while (j < ctx.text.length && ctx.text[j] === " ") {
				after++;
				j++;
			}
			const next = ctx.text[j];
			const inlineValue = next !== undefined && next !== "\n" && next !== "\r" && next !== "#";
			const shiftBefore = hasContentBefore && before > maxBefore ? before - maxBefore : 0;
			const shiftAfter = inlineValue && after > maxAfter ? after - maxAfter : 0;
			// Either fix moves an inline value left, and `YamlLint.fix` applies
			// both together, so both judge the combined move: from `valueColumn`
			// to `valueColumn - shiftBefore - shiftAfter`. A later line of the
			// entry indented into that window changes parents when the value
			// moves (block structure is read off columns), so there the finding
			// stands and the fix declines.
			const valueColumn = token.character + token.length + after;
			const moveSafe =
				!inlineValue ||
				!laterLineInWindow(
					ctx,
					token.line,
					token.character - shiftBefore,
					valueColumn - shiftBefore - shiftAfter,
					valueColumn,
				);
			if (shiftBefore > 0) {
				// The space is only spacing when what precedes it is the entry's
				// KEY, a plain or quoted scalar ending right there. Anything else
				// needs it: `- :` deleted to `-:` is the plain key `-`, `a: :` to
				// `a::` the key `a:`, and an alias, anchor or tag absorbs a `:`
				// into its name. There the finding stands and the fix declines.
				const keyEnd = i + 1;
				const safe =
					moveSafe &&
					(maxBefore === 0
						? composedScalars(ctx).some((scalar) => scalar.end === keyEnd && scalar.role === "key")
						: true);
				out.push(
					new YamlLintDiagnostic({
						rule: "colon-spacing",
						severity: "error",
						message: `Too many spaces before ":" (${before} > ${maxBefore})`,
						offset: token.offset - before,
						length: before,
						line: token.line,
						character: token.character - before,
						...(safe
							? {
									fix: YamlEdit.make({
										offset: token.offset - before,
										length: before - maxBefore,
										content: "",
									}),
								}
							: {}),
					}),
				);
			}
			if (shiftAfter > 0) {
				out.push(
					new YamlLintDiagnostic({
						rule: "colon-spacing",
						severity: "error",
						message: `Too many spaces after ":" (${after} > ${maxAfter})`,
						offset: token.offset + token.length,
						length: after,
						line: token.line,
						character: token.character + token.length,
						...(moveSafe
							? {
									fix: YamlEdit.make({
										offset: token.offset + token.length,
										length: shiftAfter,
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
