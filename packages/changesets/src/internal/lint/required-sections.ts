// CSH002, ported from savvy-web/systems (src/changesets/rules/required-sections.ts
// and its markdownlint twin; MIT, Copyright (c) 2026 Savvy Web Systems) as ONE
// definition over kit trees.

import { LintRule } from "@effected/markdown-lint";
import { CATEGORY_HEADINGS, RULE_DOCS, headingAnchor, isValidHeading, oneLine, writtenText } from "./docs.js";

export const RequiredSections = LintRule.make({
	names: ["changeset-required-sections", "CSH002"],
	description: "Section headings must match known changeset categories",
	tags: ["changeset"],
	information: RULE_DOCS.CSH002,
	check: (context, report) => {
		// Top-level h2s, compared as written: ``## `Features` `` is not the
		// Features category, because systems' markdownlint rule (the engine
		// markdownlint-cli2 runs) reads the heading's source text with its
		// formatting, resolving only backslash escapes.
		const children = context.root.children;
		children.forEach((heading, index) => {
			if (heading.type !== "heading" || heading.depth !== 2) return;
			const text = oneLine(writtenText(context.source, heading));
			if (!isValidHeading(text)) {
				report(
					context.diagnostic({
						at: headingAnchor(context.source, children, index),
						detail: `Unknown section "${text}". Valid h2 headings are: ${CATEGORY_HEADINGS.join(", ")}. Heading comparison is case-insensitive. See: ${RULE_DOCS.CSH002}`,
					}),
				);
			}
		});
	},
});
