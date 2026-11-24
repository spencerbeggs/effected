// markdownlint's `applyFixes` policy over kit edits: which of a set of fixes
// apply when they meet, ported from lib/markdownlint.mjs. markdownlint works on
// line fixes; this works on the findings' offset edits, choosing them in
// markdownlint's order by each finding's `fixInfo` and applying the chosen
// edits to the text.

import { Option } from "effect";
import type { LintDiagnostic } from "../LintDiagnostic.js";
import { PositionMapping } from "../PositionMapping.js";
import { LINE_BREAK, preferredLineEnding } from "./line-endings.js";

interface Fix {
	readonly lineNumber: number;
	readonly editColumn: number;
	readonly deleteCount: number;
	readonly insertText: string;
	/**
	 * The length markdownlint ranks `insertText` by: its rules insert a line break as `\n` and `applyFix` writes it
	 * as the file's ending afterwards, where a kit edit carries the ending itself, so each line break counts one.
	 */
	readonly insertLength: number;
	/** The offset span the kit edit replaces with `insertText`. */
	readonly offset: number;
	readonly length: number;
}

// markdownlint's result order (`formatResults`): first rule name by `localeCompare`, then line, stably. Its
// `applyFixes` always receives results in this order, so a tie between two rules' fixes is decided by it. A collator
// compares as `localeCompare` with no arguments does, without building one per call.
const ruleNameOrder = new Intl.Collator();
const inMarkdownlintOrder = (findings: ReadonlyArray<LintDiagnostic>): ReadonlyArray<LintDiagnostic> =>
	findings
		.map((finding, index) => ({ finding, index, name: finding.ruleNames[0] ?? "" }))
		.sort(
			(a, b) =>
				ruleNameOrder.compare(a.name, b.name) || a.finding.lineNumber - b.finding.lineNumber || a.index - b.index,
		)
		.map((entry) => entry.finding);

// The `\r\n` pairs in `text`: each is one line break, one character to markdownlint.
const countCrlf = (text: string): number => {
	let count = 0;
	for (let index = text.indexOf("\r\n"); index !== -1; index = text.indexOf("\r\n", index + 2)) count++;
	return count;
};

/**
 * Apply `findings`' kit edits to `source` under markdownlint's fix policy, and
 * count the edits the splice skipped because they reached into one already
 * applied: a skip markdownlint's policy does not make, so a sign of an edit
 * whose span disagrees with its `fixInfo`. @internal
 */
export const applyFixesCounted = (
	source: string,
	findings: ReadonlyArray<LintDiagnostic>,
): { readonly text: string; readonly skipped: number } => {
	const lead = source.charCodeAt(0) === 0xfeff ? 1 : 0;
	const mapping = PositionMapping.of(source.slice(lead));
	const fixes: Array<Fix> = [];
	for (const finding of inMarkdownlintOrder(findings)) {
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
			insertLength: edit.content.length - countCrlf(edit.content),
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
			b.insertLength - a.insertLength,
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
			collapsed[collapsed.length - 1] = {
				...fix,
				insertText: previous.insertText,
				insertLength: previous.insertLength,
			};
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
	// Splice from the end backwards; an edit that would reach into one already applied is skipped. Every edit kept
	// ends at or before the one after it starts, so the text before it is still the source's: collect the pieces
	// back to front and join once, rather than rebuilding the whole text per edit.
	const pieces: Array<string> = [];
	let limit = Number.POSITIVE_INFINITY;
	let skipped = 0;
	for (const fix of applied) {
		if (fix.offset + fix.length > limit) {
			skipped++;
			continue;
		}
		pieces.push(source.slice(fix.offset + fix.length, limit), fix.insertText);
		limit = fix.offset;
	}
	pieces.push(source.slice(0, limit));
	const result = pieces.reverse().join("");
	// markdownlint splits the file on every line break (a lone `\r` too) and joins it with the line ending it
	// prefers for the original, so a fixed file comes back with one line ending throughout, fixed or not.
	const ending = preferredLineEnding(source.slice(lead));
	const text = source.slice(0, lead) + result.slice(lead).split(LINE_BREAK).join(ending);
	return { text, skipped };
};

/** Apply `findings`' kit edits to `source` under markdownlint's fix policy. @internal */
export const applyFixes = (source: string, findings: ReadonlyArray<LintDiagnostic>): string =>
	applyFixesCounted(source, findings).text;
