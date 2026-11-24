// MD040 `fenced-code-language`: a port of markdownlint's lib/md040.mjs over
// the kit tree. markdownlint reads each `codeFenced` token's opening fence
// and its `codeFencedFenceInfo` and `codeFencedFenceMeta` text as written;
// the kit's fenced `code` nodes give the same blocks, and the info and meta
// are read from the opening fence line's raw text, since the kit's `lang`
// and `meta` are decoded. The fences the kit reads inside a math block are
// dropped, as micromark reads those lines as math.

import type { Code } from "@effected/markdown";
import type * as Lint from "@effected/markdown-lint";
import { codeNodes } from "../internal/code-blocks.js";
import { errorContext } from "../internal/lines.js";
import { inMathBlock, mathFlowBlocks } from "../internal/math-flow.js";
import { LintRule } from "../LintRule.js";

// An opening fence line from its fence on: the fence, then the info word and the meta after it.
const openingFence = /^([`~]+)[ \t]*([^ \t]*)[ \t]*(.*)$/;

/**
 * MD040 `fenced-code-language`: fenced code blocks name a language.
 *
 * @remarks
 * markdownlint's settings: `allowed_languages` (default `[]`, any language;
 * a value that is not an array reads as `[]`) and `language_only` (default
 * `false`; read by truthiness, as markdownlint reads it).
 *
 * @public
 */
export const MD040: Lint.LintRule = LintRule.make({
	names: ["MD040", "fenced-code-language"],
	description: "Fenced code blocks should have a language specified",
	tags: ["code", "language"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md040.md",
	check: (context, report) => {
		const allowed = Array.isArray(context.config.allowed_languages)
			? (context.config.allowed_languages as ReadonlyArray<unknown>)
			: [];
		const languageOnly = !!context.config.language_only;
		const math = mathFlowBlocks(context);
		for (const code of codeNodes(context) as ReadonlyArray<Code>) {
			if (code.fenceChar === undefined || inMathBlock(math, code.position.start.line)) continue;
			const offset = code.position.start.offset;
			const line = code.position.start.line;
			// The opening fence, from its first character to its line's end.
			const text = (context.lines[line - 1] as string).slice(offset - context.mapping.lineStart(line));
			const [, , info = "", meta = ""] = openingFence.exec(text) ?? [];
			const at = { offset, length: 0 };
			if (info === "") report(context.diagnostic({ at, context: errorContext(text) }));
			else if (allowed.length > 0 && !allowed.includes(info)) {
				report(context.diagnostic({ at, detail: `"${info}" is not allowed` }));
			}
			if (languageOnly && meta !== "") {
				report(context.diagnostic({ at, detail: `Info string contains more than language: "${text}"` }));
			}
		}
	},
});
