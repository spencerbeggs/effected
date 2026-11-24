// MD019 `no-multiple-space-atx`: a port of markdownlint's MD019 (in
// lib/md019-md021.mjs) over the kit tree. The whitespace after an ATX
// heading's opening sequence, micromark's `whitespace` token, is read from
// the heading's source span.

import type * as Lint from "@effected/markdown-lint";
import { atxParts, headingNodes, headingStyle } from "../internal/headings.js";
import { errorContext } from "../internal/lines.js";
import { LintRule } from "../LintRule.js";

/**
 * MD019 `no-multiple-space-atx`: one space follows the hashes of an ATX
 * heading that has no closing sequence.
 *
 * @remarks
 * No settings. Closed ATX headings are MD021's.
 *
 * @public
 */
export const MD019: Lint.LintRule = LintRule.make({
	names: ["MD019", "no-multiple-space-atx"],
	description: "Multiple spaces after hash on atx style heading",
	tags: ["headings", "atx", "spaces"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.1/doc/md019.md",
	check: (context, report) => {
		for (const heading of headingNodes(context)) {
			if (headingStyle(context, heading) !== "atx") continue;
			const { open } = atxParts(context, heading);
			const after = open.offset + open.length;
			const whitespace = (/^[ \t]+/.exec(context.source.slice(after, heading.position.end.offset))?.[0] ?? "").length;
			if (whitespace <= 1) continue;
			const text = context.source.slice(heading.position.start.offset, heading.position.end.offset);
			report(
				context.diagnostic({
					at: { offset: heading.position.start.offset, length: 0 },
					context: errorContext(text.trim(), true, false),
					range: { offset: after + 1, length: whitespace - 1 },
					fix: { offset: after + 1, length: whitespace - 1, content: "" },
				}),
			);
		}
	},
});
