import { Option } from "effect";
import type { ClosingKeyword } from "./IssueReferences.js";
import { CLOSING_KEYWORDS } from "./IssueReferences.js";

/**
 * The closing-list dialect: one whole line naming several issues at once.
 *
 * @remarks
 * The third dialect, alongside the two in `IssueReferences`: after trimming,
 * the **entire** line must be `<keyword>[:] <list>` — keyword
 * case-insensitive (lowercased to canonical form in the result), colon
 * optional, and the list one or more `#<digits>` items separated by `,`,
 * `and`, or the Oxford `, and`. Whitespace inside the line is `[ \t]` only,
 * so an embedded newline cannot smuggle two lines past a parser whose
 * contract is one — the same posture as the bare-line pattern. Any trailing
 * content after the list rejects the line; duplicates are preserved in order,
 * because whether `#1, #1` means one issue or two is the caller's business.
 *
 * Two keyword sets play here. {@link parseClosingList} accepts only the nine
 * closing keywords and yields a {@link ClosingList}; {@link parseReferenceList}
 * additionally accepts the non-closing {@link REFERENCE_KEYWORDS} (`ref`,
 * `refs`, `references`) and reports which set matched via
 * {@link ReferenceList}'s `closing` flag.
 *
 * An item whose digits exceed `Number.MAX_SAFE_INTEGER` rejects the **whole
 * line**, where `harvestIssueReferences` merely skips the one match. The
 * asymmetry is deliberate: a harvest drops one reference out of running
 * prose, but a list line is a single claim about a set of issues, and
 * returning the parseable subset would misrepresent the line as claiming
 * less than it does.
 *
 * Complexity posture: parsing is a single left-to-right character scan —
 * this module contains **no regular expressions at all** — so worst-case
 * time is linear in the line length by construction. There is no
 * backtracking engine to feed, no polynomial blow-up for a scanner to flag,
 * and therefore no input truncation.
 */

/**
 * The non-closing reference keywords the list dialect accepts, lowercased.
 *
 * @remarks
 * GitHub does not act on these — they associate without closing — but a
 * references region writes them, so the parser must read them.
 *
 * @public
 */
export const REFERENCE_KEYWORDS = ["ref", "refs", "references"] as const;

/**
 * One of the non-closing reference keywords, in canonical lowercase form.
 *
 * @public
 */
export type ReferenceKeyword = (typeof REFERENCE_KEYWORDS)[number];

/**
 * The issues a closing-list line names, per {@link parseClosingList}.
 *
 * @public
 */
export interface ClosingList {
	/** The matched closing keyword, lowercased to its canonical form. */
	readonly keyword: ClosingKeyword;
	/** The referenced issue numbers, duplicates preserved, in line order. */
	readonly issueNumbers: ReadonlyArray<number>;
}

/**
 * The issues a reference-list line names, per {@link parseReferenceList}.
 *
 * @public
 */
export interface ReferenceList {
	/** The matched keyword, lowercased to its canonical form. */
	readonly keyword: ClosingKeyword | ReferenceKeyword;
	/** Whether the keyword is one of the nine closing keywords. */
	readonly closing: boolean;
	/** The referenced issue numbers, duplicates preserved, in line order. */
	readonly issueNumbers: ReadonlyArray<number>;
}

/**
 * Both keyword tables ARE the exported constants — membership sets built from
 * them once — so the constants and the grammar cannot drift.
 */
const ALL_KEYWORDS: ReadonlySet<string> = new Set([...CLOSING_KEYWORDS, ...REFERENCE_KEYWORDS]);

/** Membership test for reporting `closing`, widened once so no call casts. */
const CLOSING_SET: ReadonlySet<string> = new Set(CLOSING_KEYWORDS);

const HASH = 0x23; // #
const COLON = 0x3a; // :
const COMMA = 0x2c; // ,

/** `[ \t]` — the only whitespace the dialect admits, per the module remarks. */
const isSpaceTab = (code: number): boolean => code === 0x20 || code === 0x09;

const isDigit = (code: number): boolean => code >= 0x30 && code <= 0x39;

const isAsciiLetter = (code: number): boolean => (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);

/** The index after the run of `[ \t]` starting at `from` (possibly `from` itself). */
const skipSpaceTab = (line: string, from: number): number => {
	let index = from;
	while (index < line.length && isSpaceTab(line.charCodeAt(index))) index += 1;
	return index;
};

/**
 * One list item at exactly `from`: `#<digits>` parsed to a safe integer and
 * the index one past it — or `undefined` for anything else, including digits
 * exceeding `Number.MAX_SAFE_INTEGER`, because a silently rounded issue
 * number is worse than a rejected line. The caller rejects the whole line —
 * see the module remarks for why a list does not skip.
 */
const readItem = (line: string, from: number): { readonly value: number; readonly next: number } | undefined => {
	if (line.charCodeAt(from) !== HASH) return undefined;
	const start = from + 1;
	let index = start;
	while (index < line.length && isDigit(line.charCodeAt(index))) index += 1;
	if (index === start) return undefined;
	const value = Number(line.slice(start, index));
	return Number.isSafeInteger(value) ? { value, next: index } : undefined;
};

/**
 * One separator at exactly `from`: a comma with optional surrounding `[ \t]`
 * and an optional Oxford `and` (consumed only when its own trailing `[ \t]+`
 * is present), or a bare `and` requiring `[ \t]+` on both sides. `and` is
 * lowercase-only — the keyword head is case-insensitive, the separator is
 * not. Returns the index where the next item must start, or `undefined` when
 * no separator is present.
 */
const scanSeparator = (line: string, from: number): number | undefined => {
	const afterLeading = skipSpaceTab(line, from);
	if (line.charCodeAt(afterLeading) === COMMA) {
		const afterComma = skipSpaceTab(line, afterLeading + 1);
		if (line.startsWith("and", afterComma)) {
			const afterAnd = skipSpaceTab(line, afterComma + 3);
			if (afterAnd > afterComma + 3) return afterAnd;
		}
		return afterComma;
	}
	if (afterLeading > from && line.startsWith("and", afterLeading)) {
		const afterAnd = skipSpaceTab(line, afterLeading + 3);
		if (afterAnd > afterLeading + 3) return afterAnd;
	}
	return undefined;
};

/**
 * The scan walk: item, then separator, then item, until the cursor stands
 * exactly at the end of the string. Anything else — a malformed item, an
 * unknown separator, trailing content, an unsafe issue number — is
 * `undefined`, and the caller rejects the whole line.
 */
const parseItems = (line: string, from: number): ReadonlyArray<number> | undefined => {
	const issueNumbers: Array<number> = [];
	let cursor = from;
	for (;;) {
		const item = readItem(line, cursor);
		if (item === undefined) return undefined;
		issueNumbers.push(item.value);
		cursor = item.next;
		if (cursor === line.length) return issueNumbers;
		const next = scanSeparator(line, cursor);
		if (next === undefined) return undefined;
		cursor = next;
	}
};

/**
 * The list a whole line carries under either keyword set, or `Option.none()`.
 *
 * @remarks
 * Accepts the nine closing keywords plus {@link REFERENCE_KEYWORDS}, and
 * reports which set matched in the result's `closing` flag. Grammar,
 * whole-line posture and the whole-line rejection of unsafe issue numbers
 * are in the module remarks.
 *
 * @public
 */
export const parseReferenceList = (line: string): Option.Option<ReferenceList> => {
	const trimmed = line.trim();
	let letters = 0;
	while (letters < trimmed.length && isAsciiLetter(trimmed.charCodeAt(letters))) letters += 1;
	if (letters === 0) return Option.none();
	const keyword = trimmed.slice(0, letters).toLowerCase();
	if (!ALL_KEYWORDS.has(keyword)) return Option.none();
	let cursor = letters;
	if (trimmed.charCodeAt(cursor) === COLON) cursor += 1;
	const afterWhitespace = skipSpaceTab(trimmed, cursor);
	if (afterWhitespace === cursor) return Option.none();
	const issueNumbers = parseItems(trimmed, afterWhitespace);
	if (issueNumbers === undefined) return Option.none();
	return Option.some({
		keyword: keyword as ClosingKeyword | ReferenceKeyword,
		closing: CLOSING_SET.has(keyword),
		issueNumbers,
	});
};

/**
 * The closing-only view of {@link parseReferenceList}: the list a whole line
 * carries under one of the nine closing keywords, or `Option.none()`.
 *
 * @remarks
 * A `Refs:` line is a valid reference list but not a closing one, so it
 * returns `Option.none()` here and `closing: false` from
 * {@link parseReferenceList}.
 *
 * @public
 */
export const parseClosingList = (line: string): Option.Option<ClosingList> =>
	Option.flatMap(parseReferenceList(line), (list) =>
		list.closing
			? // Safe: `closing` is exactly membership in CLOSING_KEYWORDS.
				Option.some({ keyword: list.keyword as ClosingKeyword, issueNumbers: list.issueNumbers })
			: Option.none(),
	);
