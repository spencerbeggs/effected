// The five changeset rules' documentation links and shared vocabulary, ported
// verbatim from savvy-web/systems (`src/changesets/constants.ts`,
// `src/changesets/categories/index.ts`, `src/changesets/schemas/dependency-table.ts`),
// MIT, Copyright (c) 2026 Savvy Web Systems. The diagnostics embed these
// strings, so agreement with systems' own output depends on them verbatim.

const DOCS_BASE = "https://github.com/savvy-web/systems/blob/main/packages/silk-effects/docs/rules";

export const RULE_DOCS = {
	CSH001: `${DOCS_BASE}/CSH001.md`,
	CSH002: `${DOCS_BASE}/CSH002.md`,
	CSH003: `${DOCS_BASE}/CSH003.md`,
	CSH004: `${DOCS_BASE}/CSH004.md`,
	CSH005: `${DOCS_BASE}/CSH005.md`,
} as const;

/** The thirteen changeset category headings, in display order. */
export const CATEGORY_HEADINGS: ReadonlyArray<string> = [
	"Breaking Changes",
	"Features",
	"Bug Fixes",
	"Performance",
	"Documentation",
	"Refactoring",
	"Tests",
	"Build System",
	"CI",
	"Dependencies",
	"Maintenance",
	"Reverts",
	"Other",
];

const headingSet = new Set(CATEGORY_HEADINGS.map((heading) => heading.toLowerCase()));

/** Whether `heading` names a category, ignoring case. */
export const isValidHeading = (heading: string): boolean => headingSet.has(heading.toLowerCase());

/** A semver version, a protocol specifier, or the em-dash sentinel. */
export const VERSION_RE =
	/^(—|[~^]?\d+\.\d+\.\d+(?:[-+.][\w.+-]+)?|(?:catalog|workspace|npm|jsr|file|link|portal):[^\s|]+)$/u;

const BACKSLASH_ESCAPE_RE = /\\([!-/:-@[-`{-~])/g;

/**
 * A node's text as written, from its first child to its last, with
 * CommonMark backslash escapes resolved: what systems' markdownlint rules
 * read from a micromark heading or cell token. Inline formatting is kept, so
 * a heading of `Features` in a code span reads with its backticks.
 */
export const writtenText = (
	source: string,
	node: {
		readonly children: ReadonlyArray<{
			readonly position: { readonly start: { readonly offset: number }; readonly end: { readonly offset: number } };
		}>;
	},
): string => {
	const first = node.children[0];
	const last = node.children.at(-1);
	if (first === undefined || last === undefined) return "";
	return source.slice(first.position.start.offset, last.position.end.offset).replace(BACKSLASH_ESCAPE_RE, "$1");
};

/** Line breaks as spaces, as markdownlint writes every `errorDetail`. */
export const oneLine = (text: string): string => text.replace(/\r\n?|\n/g, " ");

interface Positioned {
	readonly type: string;
	readonly position: { readonly start: { readonly offset: number }; readonly end: { readonly offset: number } };
}

/**
 * Where a top-level heading is reported. micromark reads link reference
 * definitions directly above a setext heading, with no blank line between, as
 * the start of the heading's own token, so markdownlint reports that heading
 * on the first definition's line; anywhere else the heading is its own anchor.
 */
export const headingAnchor = (
	source: string,
	siblings: ReadonlyArray<Positioned>,
	index: number,
): { readonly offset: number; readonly length: number } => {
	const heading = siblings[index] as Positioned & { readonly headingStyle?: string };
	const end = heading.position.end.offset;
	let start = heading.position.start.offset;
	if (heading.headingStyle !== "setext") return { offset: start, length: end - start };
	for (let previous = index - 1; previous >= 0; previous--) {
		const sibling = siblings[previous] as Positioned;
		if (sibling.type !== "definition") break;
		if (!/^[ \t]*(?:\r\n?|\n)[ \t]*$/.test(source.slice(sibling.position.end.offset, start))) break;
		start = sibling.position.start.offset;
	}
	return { offset: start, length: end - start };
};
