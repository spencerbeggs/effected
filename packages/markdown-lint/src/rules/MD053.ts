// MD053 `link-image-reference-definitions`: a port of markdownlint's
// lib/md053.mjs over the kit tree. markdownlint reads its reference link and
// image data (see `referenceData`): each definition no reference or shortcut
// uses, then each duplicate definition, its label not in
// `ignored_definitions`, is reported on its label's line, the context that
// line (ellipsized) and the range the whole line. A line holding the whole
// definition (text after its `]:`) is deleted by the fix.

import type * as Lint from "@effected/markdown-lint";
import { errorContext } from "../internal/lines.js";
import { referenceData } from "../internal/references.js";
import { setSetting } from "../internal/settings.js";
import type { LintContext } from "../LintContext.js";
import { LintRule } from "../LintRule.js";

// markdownlint's `linkReferenceDefinitionRe`.
const linkReferenceDefinition = /^ {0,3}\[([^\]]*[^\\])\]:/;

// Whether `line` holds more than a definition's label: markdownlint deletes only such a line.
const singleLineDefinition = (line: string): boolean => line.replace(linkReferenceDefinition, "").trim().length > 0;

// markdownlint's whole-line delete of `lineNumber`: through the next line's start, or from the previous line's end
// on the last line.
const deleteLine = (context: LintContext, lineNumber: number) => {
	const start = context.mapping.lineStart(lineNumber);
	const end = start + (context.lines[lineNumber - 1] ?? "").length;
	if (lineNumber < context.lines.length) {
		return { offset: start, length: context.mapping.lineStart(lineNumber + 1) - start, content: "" };
	}
	if (lineNumber > 1) {
		const previous = context.mapping.lineStart(lineNumber - 1) + (context.lines[lineNumber - 2] ?? "").length;
		return { offset: previous, length: end - previous, content: "" };
	}
	return { offset: start, length: end - start, content: "" };
};

/**
 * MD053 `link-image-reference-definitions`: a link or image reference
 * definition is used, and defined once.
 *
 * @remarks
 * Setting: `ignored_definitions` (default `["//"]`, the `[//]: # (comment)`
 * idiom) names labels never reported. The fix deletes the definition's line
 * when the definition is on one line.
 *
 * @public
 */
export const MD053: Lint.LintRule = LintRule.make({
	names: ["MD053", "link-image-reference-definitions"],
	description: "Link and image reference definitions should be needed",
	tags: ["images", "links"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md053.md",
	check: (context, report) => {
		const ignored = setSetting(context.config, "ignored_definitions", ["//"]);
		const { definitions, duplicates, references, shortcuts } = referenceData(context);
		const reportLine = (offset: number, detail: string) => {
			const lineNumber = context.mapping.lineNumber(offset);
			const line = context.lines[lineNumber - 1] ?? "";
			const start = context.mapping.lineStart(lineNumber);
			report(
				context.diagnostic({
					at: { offset: start, length: 0 },
					detail,
					context: errorContext(line),
					range: { offset: start, length: line.length },
					...(singleLineDefinition(line) ? { fix: deleteLine(context, lineNumber), deletesLine: true } : {}),
				}),
			);
		};
		for (const [label, definition] of definitions) {
			if (ignored.has(label) || references.has(label) || shortcuts.has(label)) continue;
			reportLine(definition.offset, `Unused link or image reference definition: "${label}"`);
		}
		for (const { label, offset } of duplicates) {
			if (ignored.has(label)) continue;
			reportLine(offset, `Duplicate link or image reference definition: "${label}"`);
		}
	},
});
