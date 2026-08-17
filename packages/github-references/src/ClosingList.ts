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
 * ReDoS posture: parsing is an anchored head match for `<keyword>[:]?`
 * followed by an **iterative** sticky-regex walk over the list — item, then
 * separator, then item — never a single regex quantifying over the whole
 * separator/list structure. No alternation nests a quantifier, so a hostile
 * line cannot trigger catastrophic backtracking, and no input truncation is
 * needed.
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
 * The head pattern derives from the keyword constants so the constants and
 * the grammar cannot drift. Alternation order is safe for the same reason as
 * the sibling module's patterns: `ref` matching inside `references` fails at
 * the mandatory colon-or-whitespace and the engine retries the longer
 * keyword.
 */
const ALL_KEYWORDS = [...CLOSING_KEYWORDS, ...REFERENCE_KEYWORDS].join("|");

/**
 * Anchored head: the keyword, an optional colon, then mandatory same-line
 * whitespace. `[ \t]` rather than `\s`, per the module's newline posture.
 */
const HEAD_PATTERN = new RegExp(`^(${ALL_KEYWORDS}):?[ \\t]+`, "i");

/** One list item, matched stickily at the walker's cursor. */
const ITEM_PATTERN = /#(\d+)/y;

/**
 * One separator, matched stickily: a comma (optionally Oxford — followed by
 * `and`), or a bare `and`. Each alternative is a flat sequence — no nested
 * quantifiers, per the module's ReDoS posture.
 */
const SEPARATOR_PATTERN = /[ \t]*,[ \t]*(?:and[ \t]+)?|[ \t]+and[ \t]+/y;

/** Membership test for reporting `closing`, widened once so no call casts. */
const CLOSING_SET: ReadonlySet<string> = new Set(CLOSING_KEYWORDS);

/**
 * `#<digits>` parsed to a number — or `undefined` when the digits exceed
 * `Number.MAX_SAFE_INTEGER`, because a silently rounded issue number is
 * worse than a rejected line. Here the caller rejects the whole line — see
 * the module remarks for why a list does not skip.
 */
const safeIssueNumber = (digits: string): number | undefined => {
	const value = Number(digits);
	return Number.isSafeInteger(value) ? value : undefined;
};

/**
 * The iterative walk: item, then separator, then item, until the cursor
 * stands exactly at the end of the string. Anything else — a malformed item,
 * an unknown separator, trailing content, an unsafe issue number — is
 * `undefined`, and the caller rejects the whole line.
 */
const parseItems = (list: string): ReadonlyArray<number> | undefined => {
	const issueNumbers: Array<number> = [];
	let cursor = 0;
	for (;;) {
		ITEM_PATTERN.lastIndex = cursor;
		const item = ITEM_PATTERN.exec(list);
		if (item === null) return undefined;
		const issueNumber = safeIssueNumber(item[1] ?? "");
		if (issueNumber === undefined) return undefined;
		issueNumbers.push(issueNumber);
		cursor = ITEM_PATTERN.lastIndex;
		if (cursor === list.length) return issueNumbers;
		SEPARATOR_PATTERN.lastIndex = cursor;
		if (SEPARATOR_PATTERN.exec(list) === null) return undefined;
		cursor = SEPARATOR_PATTERN.lastIndex;
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
	const head = HEAD_PATTERN.exec(trimmed);
	if (head === null) return Option.none();
	const keyword = (head[1] ?? "").toLowerCase() as ClosingKeyword | ReferenceKeyword;
	const issueNumbers = parseItems(trimmed.slice(head[0].length));
	if (issueNumbers === undefined) return Option.none();
	return Option.some({ keyword, closing: CLOSING_SET.has(keyword), issueNumbers });
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
