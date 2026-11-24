// The real markdownlint, as the differential oracle every built-in rule port
// is held to. The one place a test loads it: the exact-pinned `markdownlint`
// devDependency, 0.42.2 like the vendored source and the copy the workspace
// root's markdownlint-cli2 resolves,
// through variable specifiers so that no `src/` type ever resolves against its
// declarations. Its rule list is read from `lib/rules.mjs` by file URL, since
// the package exports no subpath for it.

import os from "node:os";
import type { MarkdownlintRule } from "../../src/MarkdownlintAdapter.js";

/** One markdownlint result, as its `lint` reports it. */
export interface OracleFinding {
	readonly lineNumber: number;
	readonly ruleNames: ReadonlyArray<string>;
	readonly errorDetail: string | null;
	readonly errorContext: string | null;
	readonly errorRange: readonly [number, number] | null;
	readonly fixInfo: unknown;
	readonly severity: string;
}

/** A markdownlint result with the fields only a whole-result comparison reads. */
export interface MarkdownlintResult extends OracleFinding {
	readonly ruleDescription: string;
	readonly ruleInformation: string | null;
}

/** The options of markdownlint's sync `lint` the tests use. */
export interface MarkdownlintOptions {
	readonly strings: Readonly<Record<string, string>>;
	readonly config: Readonly<Record<string, unknown>>;
	readonly customRules?: ReadonlyArray<MarkdownlintRule | object>;
	readonly noInlineConfig?: boolean;
	readonly handleRuleFailures?: boolean;
}

interface MarkdownlintSync {
	readonly lint: (options: MarkdownlintOptions) => Record<string, ReadonlyArray<MarkdownlintResult>>;
}

interface MarkdownlintHelpers {
	readonly applyFixes: (input: string, errors: ReadonlyArray<OracleFinding>) => string;
	readonly getVersion: () => string;
}

interface MarkdownlintInternalHelpers {
	readonly getPreferredLineEnding: (input: string, os?: { readonly EOL: string }) => string;
}

interface OracleRule {
	names: string[];
	description: string;
	tags: string[];
	information: URL;
}

const syncSpecifier = "markdownlint/sync";
const mainSpecifier = "markdownlint";
const helpersSpecifier = "markdownlint/helpers";
const rulesSpecifier = new URL("../../node_modules/markdownlint/lib/rules.mjs", import.meta.url).href;

const sync: MarkdownlintSync = await import(syncSpecifier);
const main: MarkdownlintHelpers = await import(mainSpecifier);
const internal: MarkdownlintInternalHelpers = (await import(helpersSpecifier)).default;
const builtIn: { readonly default: ReadonlyArray<OracleRule> } = await import(rulesSpecifier);

/** markdownlint's sync `lint`, for a test that passes custom rules or other options. */
export const markdownlintLint = (options: MarkdownlintOptions): Record<string, ReadonlyArray<MarkdownlintResult>> =>
	sync.lint(options);

/** The installed markdownlint's version. */
export const oracleVersion = (): string => main.getVersion();

/** Lint `source` with markdownlint's built-in rules under `config`. */
export const oracleLint = (source: string, config: Record<string, unknown>): ReadonlyArray<OracleFinding> =>
	sync.lint({ strings: { input: source }, config }).input ?? [];

/**
 * markdownlint's `applyFixes`, over the source as given: a leading byte order
 * mark is set aside, as markdownlint lints the text after it, and put back.
 */
export const oracleApplyFixes = (source: string, findings: ReadonlyArray<OracleFinding>): string => {
	const lead = source.charCodeAt(0) === 0xfeff ? 1 : 0;
	return source.slice(0, lead) + main.applyFixes(source.slice(lead), findings);
};

/** The line ending markdownlint's `applyFixes` writes an inserted `\n` as, for `source`. */
export const oracleLineEnding = (source: string): string => internal.getPreferredLineEnding(source, os);

/** markdownlint's built-in rules, in its own order. */
export const oracleRules = (): ReadonlyArray<OracleRule> => builtIn.default;

interface OracleToken {
	readonly type: string;
	readonly startLine: number;
	readonly startColumn: number;
	readonly text: string;
	readonly children: ReadonlyArray<OracleToken>;
}

const parseSpecifier = new URL("../../node_modules/markdownlint/lib/micromark-parse.mjs", import.meta.url).href;
const micromarkParse: { readonly parse: (markdown: string) => ReadonlyArray<OracleToken> } = await import(
	parseSpecifier
);

/**
 * markdownlint's `data` tokens for `source`, as `[line, column, text]`, in document order: the text MD044 scans as
 * `data`. Those under the parts MD044 passes over (a link's destination and title, a full reference's label, a
 * definition, a fence's info) and the copies markdownlint's undefined-reference shim makes are left out.
 */
export const oracleDataTokens = (source: string): ReadonlyArray<readonly [number, number, string]> => {
	const skipped = new Set(["resource", "reference", "definition", "codeFencedFence", "undefinedReference"]);
	const found: Array<readonly [number, number, string]> = [];
	const walk = (tokens: ReadonlyArray<OracleToken>): void => {
		for (const token of tokens) {
			if (skipped.has(token.type)) continue;
			if (token.type === "data") found.push([token.startLine, token.startColumn, token.text]);
			walk(token.children);
		}
	};
	// markdownlint parses the content after its front matter, and numbers lines from the source's start.
	const frontMatter =
		/^---[^\S\r\n]*(?:\r\n|\r|\n)[\s\S]*?(?:\r\n|\r|\n)---\s*?(?:\r\n|\r|\n|$)/.exec(source)?.[0] ?? "";
	const lines = frontMatter === "" ? 0 : frontMatter.split(/\r\n|\r|\n/).length - 1;
	walk(micromarkParse.parse(source.slice(frontMatter.length)));
	return found.map(([line, column, text]) => [line + lines, column, text] as const);
};
