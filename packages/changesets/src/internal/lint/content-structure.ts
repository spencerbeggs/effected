// CSH003, ported from savvy-web/systems (src/changesets/rules/content-structure.ts
// and its markdownlint twin; MIT, Copyright (c) 2026 Savvy Web Systems) as ONE
// definition over kit trees. Findings come in three passes — empty sections,
// fences without a language, empty list items — the order both systems
// engines agreed on.

import type { LintDiagnostic } from "@effected/markdown-lint";
import { LintRule } from "@effected/markdown-lint";
import { RULE_DOCS, headingAnchor } from "./docs.js";

export const ContentStructure = LintRule.make({
	names: ["changeset-content-structure", "CSH003"],
	description: "Sections must have content, code blocks need languages, list items need text",
	tags: ["changeset"],
	information: RULE_DOCS.CSH003,
	check: (context, report) => {
		const children = context.root.children;
		children.forEach((node, index) => {
			if (node.type !== "heading" || node.depth !== 2) return;
			const next = children[index + 1];
			if (next === undefined || (next.type === "heading" && next.depth === 2)) {
				report(
					context.diagnostic({
						at: headingAnchor(context.source, children, index),
						detail: `Empty section: heading has no content before the next section or end of file. Add a list of changes (e.g., "- Added feature X") under this heading, or remove the empty heading. See: ${RULE_DOCS.CSH003}`,
					}),
				);
			}
		});

		// Fenced code and list items as systems' markdownlint rule sees them:
		// top-level blocks only, so code or a list inside a block quote or an
		// item is not checked; an indented code block has no fence to name a
		// language on; and an item is empty unless it holds a paragraph, so an
		// item of only an HTML comment, a nested list or a fence is empty, and an
		// item of only an image is not.
		const codes: Array<LintDiagnostic> = [];
		const items: Array<LintDiagnostic> = [];
		for (const node of children) {
			if (node.type === "code" && node.fenceChar !== undefined && (node.lang === undefined || node.lang === "")) {
				codes.push(
					context.diagnostic({
						at: node,
						detail: `Code block is missing a language identifier. Add a language after the opening fence (e.g., \`\`\`ts, \`\`\`json, \`\`\`bash). See: ${RULE_DOCS.CSH003}`,
					}),
				);
			} else if (node.type === "list") {
				for (const item of node.children) {
					if (item.children.some((child) => child.type === "paragraph")) continue;
					items.push(
						context.diagnostic({
							at: item,
							detail: `Empty list item. Each list item must contain descriptive text (e.g., "- Fixed login timeout issue"). See: ${RULE_DOCS.CSH003}`,
						}),
					);
				}
			}
		}
		for (const finding of [...codes, ...items]) report(finding);
	},
});
