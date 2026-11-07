// CSH003, ported from savvy-web/systems (src/changesets/rules/content-structure.ts
// and its markdownlint twin; MIT, Copyright (c) 2026 Savvy Web Systems) as ONE
// definition over kit trees. Findings come in three passes — empty sections,
// fences without a language, empty list items — the order both systems
// engines agreed on. An example rule, not public API.

import { MarkdownVisitor, Mdast } from "@effected/markdown";
import type { LintDiagnostic } from "../../src/LintDiagnostic.js";
import { LintRule } from "../../src/LintRule.js";
import { RULE_DOCS } from "./docs.js";

export const ContentStructure = LintRule.make({
	names: ["changeset-content-structure", "CSH003"],
	description: "Sections must have content, code blocks need languages, list items need text",
	tags: ["changeset"],
	check: (context, report) => {
		const children = context.root.children;
		children.forEach((node, index) => {
			if (node.type !== "heading" || node.depth !== 2) return;
			const next = children[index + 1];
			if (next === undefined || (next.type === "heading" && next.depth === 2)) {
				report(
					context.diagnostic({
						at: node,
						detail: `Empty section: heading has no content before the next section or end of file. Add a list of changes (e.g., "- Added feature X") under this heading, or remove the empty heading. See: ${RULE_DOCS.CSH003}`,
					}),
				);
			}
		});

		const codes: Array<LintDiagnostic> = [];
		const items: Array<LintDiagnostic> = [];
		MarkdownVisitor.traverse(context.root, ["code", "listItem"], {
			enter: (node) => {
				if (node.type === "code" && (node.lang === undefined || node.lang === "")) {
					codes.push(
						context.diagnostic({
							at: node,
							detail: `Code block is missing a language identifier. Add a language after the opening fence (e.g., \`\`\`ts, \`\`\`json, \`\`\`bash). See: ${RULE_DOCS.CSH003}`,
						}),
					);
				} else if (node.type === "listItem" && Mdast.toText(node).trim() === "") {
					items.push(
						context.diagnostic({
							at: node,
							detail: `Empty list item. Each list item must contain descriptive text (e.g., "- Fixed login timeout issue"). See: ${RULE_DOCS.CSH003}`,
						}),
					);
				}
				return undefined;
			},
		});
		for (const finding of [...codes, ...items]) report(finding);
	},
});
