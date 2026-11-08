// CSH004, ported from savvy-web/systems (src/changesets/rules/uncategorized-content.ts
// and its markdownlint twin; MIT, Copyright (c) 2026 Savvy Web Systems) as ONE
// definition over kit trees. The systems kit rule ran on a tree with the
// frontmatter node already dropped; here the host captures frontmatter as a
// node and the rule skips it. An example rule, not public API.

import { LintRule } from "../../src/LintRule.js";
import { RULE_DOCS } from "./docs.js";

export const UncategorizedContent = LintRule.make({
	names: ["changeset-uncategorized-content", "CSH004"],
	description: "All content must be placed under a category heading (## heading)",
	tags: ["changeset"],
	check: (context, report) => {
		for (const node of context.root.children) {
			if (node.type === "heading" && node.depth === 2) break;
			if (node.type === "heading" || node.type === "html" || node.type === "frontmatter") continue;
			report(
				context.diagnostic({
					at: node,
					detail: `Content must be placed under a category heading (## heading). Move this content under an appropriate section like "## Features" or "## Bug Fixes". If it doesn't fit an existing category, use "## Other". See: ${RULE_DOCS.CSH004}`,
				}),
			);
		}
	},
});
