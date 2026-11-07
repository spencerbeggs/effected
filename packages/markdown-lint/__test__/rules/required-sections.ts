// CSH002, ported from savvy-web/systems (src/changesets/rules/required-sections.ts
// and its markdownlint twin; MIT, Copyright (c) 2026 Savvy Web Systems) as ONE
// definition over kit trees. An example rule, not public API.

import { MarkdownVisitor, Mdast } from "@effected/markdown";
import { LintRule } from "../../src/LintRule.js";
import { CATEGORY_HEADINGS, RULE_DOCS, isValidHeading } from "./docs.js";

export const RequiredSections = LintRule.make({
	names: ["changeset-required-sections", "CSH002"],
	description: "Section headings must match known changeset categories",
	tags: ["changeset"],
	check: (context, report) => {
		MarkdownVisitor.traverse(context.root, "heading", {
			enter: (heading) => {
				if (heading.depth !== 2) return undefined;
				const text = Mdast.toText(heading);
				if (!isValidHeading(text)) {
					report(
						context.diagnostic({
							at: heading,
							detail: `Unknown section "${text}". Valid h2 headings are: ${CATEGORY_HEADINGS.join(", ")}. Heading comparison is case-insensitive. See: ${RULE_DOCS.CSH002}`,
						}),
					);
				}
				return undefined;
			},
		});
	},
});
