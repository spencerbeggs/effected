// markdownlint's `applyFixes` policy over kit edits: which of a set of fixes
// apply when they meet, ported from lib/markdownlint.mjs. markdownlint works on
// line fixes; this works on the findings' offset edits, choosing them in
// markdownlint's order by each finding's `fixInfo` and applying the chosen
// edits to the text.

import { Option } from "effect";
import type { LintDiagnostic } from "../LintDiagnostic.js";
import { PositionMapping } from "../PositionMapping.js";

interface Fix {
	readonly lineNumber: number;
	readonly editColumn: number;
	readonly deleteCount: number;
	readonly insertText: string;
	/** The offset span the kit edit replaces with `insertText`. */
	readonly offset: number;
	readonly length: number;
}

/** Apply `findings`' kit edits to `source` under markdownlint's fix policy. @internal */
export const applyFixes = (source: string, findings: ReadonlyArray<LintDiagnostic>): string => {
	const lead = source.charCodeAt(0) === 0xfeff ? 1 : 0;
	const mapping = PositionMapping.of(source.slice(lead));
	const fixes: Array<Fix> = [];
	for (const finding of findings) {
		if (Option.isNone(finding.edit)) continue;
		const edit = finding.edit.value;
		// markdownlint's `normalizeFixInfo` over the finding's `fixInfo` (its own line or the finding's, column 1,
		// nothing deleted). An edit with no `fixInfo`, one markdownlint could not say, is placed by its own offset.
		const fixInfo = Option.getOrUndefined(finding.fixInfo);
		fixes.push({
			lineNumber:
				fixInfo === undefined ? mapping.lineNumber(edit.offset - lead) : (fixInfo.lineNumber ?? finding.lineNumber),
			editColumn: fixInfo === undefined ? mapping.column(edit.offset - lead) : (fixInfo.editColumn ?? 1),
			deleteCount: fixInfo === undefined ? edit.length : (fixInfo.deleteCount ?? 0),
			insertText: edit.content,
			offset: edit.offset,
			length: edit.length,
		});
	}
	// Bottom to top, whole-line deletes last on a line, right to left, longer inserts first.
	fixes.sort(
		(a, b) =>
			b.lineNumber - a.lineNumber ||
			(a.deleteCount === -1 ? 1 : b.deleteCount === -1 ? -1 : 0) ||
			b.editColumn - a.editColumn ||
			b.insertText.length - a.insertText.length,
	);
	// Drop a fix identical to the one before it.
	const unique: Array<Fix> = [];
	for (const fix of fixes) {
		const last = unique.at(-1);
		if (
			last !== undefined &&
			fix.lineNumber === last.lineNumber &&
			fix.editColumn === last.editColumn &&
			fix.deleteCount === last.deleteCount &&
			fix.insertText === last.insertText
		) {
			continue;
		}
		unique.push(fix);
	}
	// An insert and a delete at one line and column become one replace.
	const collapsed: Array<Fix> = [];
	for (const fix of unique) {
		const previous = collapsed.at(-1);
		if (
			previous !== undefined &&
			fix.lineNumber === previous.lineNumber &&
			fix.editColumn === previous.editColumn &&
			fix.insertText === "" &&
			fix.deleteCount > 0 &&
			previous.insertText !== "" &&
			previous.deleteCount === 0
		) {
			collapsed[collapsed.length - 1] = { ...fix, insertText: previous.insertText };
			continue;
		}
		collapsed.push(fix);
	}
	// Choose right to left, skipping a fix that runs into the one before it on its line.
	const chosen: Array<Fix> = [];
	let lastLine = -1;
	let lastEdit = -1;
	for (const fix of collapsed) {
		const editIndex = fix.editColumn - 1;
		if (
			fix.lineNumber !== lastLine ||
			fix.deleteCount === -1 ||
			editIndex + fix.deleteCount <= lastEdit - (fix.deleteCount > 0 ? 0 : 1)
		) {
			chosen.push(fix);
		}
		lastLine = fix.lineNumber;
		lastEdit = editIndex;
	}
	// A whole-line delete removes its line, and with it every other fix chosen on that line.
	const deleted = new Set(chosen.filter((fix) => fix.deleteCount === -1).map((fix) => fix.lineNumber));
	const applied = chosen
		.filter((fix) => fix.deleteCount === -1 || !deleted.has(fix.lineNumber))
		.sort((a, b) => b.offset - a.offset || b.length - a.length);
	// Splice from the end backwards; an edit that would reach into one already applied is skipped.
	let result = source;
	let limit = Number.POSITIVE_INFINITY;
	for (const fix of applied) {
		if (fix.offset + fix.length > limit) continue;
		result = result.slice(0, fix.offset) + fix.insertText + result.slice(fix.offset + fix.length);
		limit = fix.offset;
	}
	return result;
};
