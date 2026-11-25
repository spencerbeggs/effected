// MD037 `no-space-in-emphasis`: a port of markdownlint's lib/md037.mjs over
// the kit tree. markdownlint pairs, per token, its `data` children that are a
// bare marker run (`*`, `**`, `***`, `_`, `__`, `___`), first with second and
// so on per marker, and reports the spaces after an opening one and before a
// closing one. The kit reads the bare runs from each block's top-level inline
// content (see `bareMarkers`).

import type * as Lint from "@effected/markdown-lint";
import type { BareMarker } from "../internal/inline.js";
import { bareMarkers } from "../internal/inline.js";
import { LintRule } from "../LintRule.js";

const markers = ["_", "__", "___", "*", "**", "***"];

// Whitespace on the marker's own line, then a non-space: markdownlint's `/^\s+\S/` over the rest of the line.
const spacesThenText = /(?:(?![\r\n])\s)+\S/y;

// How many whitespace characters on its line end just before `offset`, after a non-space: markdownlint's
// `/\S\s+$/` over the line up to the marker; 0 when they do not.
const spacesBefore = (source: string, lineStart: number, offset: number): number => {
	let at = offset;
	while (at > lineStart && /\s/.test(source.charAt(at - 1))) at--;
	return at > lineStart && at < offset ? offset - at : 0;
};

/**
 * MD037 `no-space-in-emphasis`: no space just inside emphasis markers.
 *
 * @remarks
 * No settings. A space there stops the markers being emphasis; the fix
 * deletes the whitespace between the marker and the text, as markdownlint's
 * does.
 *
 * @public
 */
export const MD037: Lint.LintRule = LintRule.make({
	names: ["MD037", "no-space-in-emphasis"],
	description: "Spaces inside emphasis markers",
	tags: ["whitespace", "emphasis"],
	information: "https://github.com/DavidAnson/markdownlint/blob/v0.42.2/doc/md037.md",
	check: (context, report) => {
		const { source } = context;
		for (const runs of bareMarkers(context)) {
			for (const marker of markers) {
				const tokens = runs.filter((run) => run.marker === marker);
				for (let index = 0; index + 1 < tokens.length; index += 2) {
					const start = tokens[index] as BareMarker;
					const end = tokens[index + 1] as BareMarker;
					spacesThenText.lastIndex = start.end;
					const startMatch = spacesThenText.exec(source);
					if (startMatch !== null) {
						const count = startMatch[0].length - 1;
						report(
							context.diagnostic({
								at: { offset: start.start, length: 0 },
								context: `${marker}${startMatch[0]}`,
								range: { offset: start.end, length: count },
								fix: { offset: start.end, length: count, content: "" },
							}),
						);
					}
					const count = spacesBefore(
						source,
						context.mapping.lineStart(context.mapping.lineNumber(end.start)),
						end.start,
					);
					if (count > 0) {
						report(
							context.diagnostic({
								at: { offset: end.start, length: 0 },
								context: `${source.slice(end.start - count - 1, end.start)}${marker}`,
								range: { offset: end.start - count, length: count },
								fix: { offset: end.start - count, length: count, content: "" },
							}),
						);
					}
				}
			}
		}
	},
});
