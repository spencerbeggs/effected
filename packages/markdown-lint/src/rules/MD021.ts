// MD021 `no-multiple-space-closed-atx`: a port of markdownlint's MD021 (in
// lib/md019-md021.mjs) over the kit tree. The whitespace after a closed ATX
// heading's opening sequence and before its closing sequence, micromark's
// `whitespace` tokens, is read from the heading's source span.

import type * as Lint from "@effected/markdown-lint";
import { Option } from "effect";
import { atxParts, headingNodes, headingStyle } from "../internal/headings.js";
import { errorContext } from "../internal/lines.js";
import { LintRule } from "../LintRule.js";

/**
 * MD021 `no-multiple-space-closed-atx`: one space separates a closed ATX
 * heading's text from the hashes on each side.
 *
 * @remarks
 * No settings. Open ATX headings are MD019's.
 *
 * @public
 */
export const MD021: Lint.LintRule = LintRule.make({
	names: ["MD021", "no-multiple-space-closed-atx"],
	description: "Multiple spaces inside hashes on closed atx style heading",
	tags: ["headings", "atx_closed", "spaces"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md021.md",
	check: (context, report) => {
		for (const heading of headingNodes(context)) {
			if (headingStyle(context, heading) !== "atx_closed") continue;
			const { open, closing } = atxParts(context, heading);
			if (Option.isNone(closing)) continue;
			const after = open.offset + open.length;
			const inside = context.source.slice(after, closing.value.offset);
			const text = context.source.slice(heading.position.start.offset, heading.position.end.offset).trim();
			// The run after the opening hashes, then the run before the closing ones: one run when the heading is empty.
			const leading = (/^[ \t]+/.exec(inside)?.[0] ?? "").length;
			const trailing = (/[ \t]+$/.exec(inside)?.[0] ?? "").length;
			for (const [start, length, fromStart] of [
				[after, leading, true],
				[closing.value.offset - trailing, trailing, false],
			] as const) {
				if (length <= 1) continue;
				report(
					context.diagnostic({
						at: { offset: heading.position.start.offset, length: 0 },
						context: errorContext(text, fromStart, !fromStart),
						range: { offset: start + 1, length: length - 1 },
						fix: { offset: start + 1, length: length - 1, content: "" },
					}),
				);
			}
		}
	},
});
