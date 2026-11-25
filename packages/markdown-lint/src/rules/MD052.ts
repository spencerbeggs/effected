// MD052 `reference-links-images`: a port of markdownlint's lib/md052.mjs over
// the kit tree. markdownlint reads its reference link and image data (see
// `referenceData`): each full or collapsed reference, and with
// `shortcut_syntax` each shortcut (footnote calls among them), whose label
// no definition has and `ignored_labels` does not name, is reported at its
// start, its context and range its source up to the end of that line.

import type * as Lint from "@effected/markdown-lint";
import { referenceData } from "../internal/references.js";
import { flagSetting, setSetting } from "../internal/settings.js";
import { LintRule } from "../LintRule.js";

/**
 * MD052 `reference-links-images`: a reference link or image uses a label that
 * is defined.
 *
 * @remarks
 * Settings: `shortcut_syntax` (default `false`) also checks shortcut
 * references (`[label]`), and `ignored_labels` (default `["x"]`, a task list
 * item's checkbox) names labels never reported. No fix.
 *
 * @public
 */
export const MD052: Lint.LintRule = LintRule.make({
	names: ["MD052", "reference-links-images"],
	description: "Reference links and images should use a label that is defined",
	tags: ["images", "links"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md052.md",
	check: (context, report) => {
		const ignored = setSetting(context.config, "ignored_labels", ["x"]);
		const { definitions, references, shortcuts } = referenceData(context);
		const entries = flagSetting(context.config, "shortcut_syntax") ? [...references, ...shortcuts] : [...references];
		for (const [label, uses] of entries) {
			if (definitions.has(label) || ignored.has(label)) continue;
			for (const use of uses) {
				const lineNumber = context.mapping.lineNumber(use.offset);
				const line = context.lines[lineNumber - 1] ?? "";
				const index = use.offset - context.mapping.lineStart(lineNumber);
				// Its source up to the end of its line: a reference across lines is cut there.
				const text = line.slice(index, index + use.length);
				report(
					context.diagnostic({
						at: { offset: use.offset, length: 0 },
						detail: `Missing link or image reference definition: "${label}"`,
						context: text,
						range: { offset: use.offset, length: text.length },
					}),
				);
			}
		}
	},
});
