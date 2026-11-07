// The five example rules' documentation links and shared vocabulary, ported
// verbatim from savvy-web/systems (`src/changesets/constants.ts`,
// `src/changesets/categories/index.ts`, `src/changesets/schemas/dependency-table.ts`),
// MIT, Copyright (c) 2026 Savvy Web Systems. The diagnostics embed these
// strings, so a byte-identical golden comparison depends on them verbatim.

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
