// The machinery both hosts share: read a source the way markdownlint reads it,
// build a rule's context, run its check, and turn a parse refusal into
// findings. Keeping it in one module is what makes "the two hosts agree" a
// property of the code rather than of two copies of it.

import type {
	Frontmatter,
	MarkdownDialect,
	MarkdownNode,
	MarkdownParseError,
	MarkdownRangeLike,
} from "@effected/markdown";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Option, Result } from "effect";
import { InlineDirectives } from "../InlineDirectives.js";
import type { LintConfigRecord, LintSeverity } from "../LintConfig.js";
import { LintConfig } from "../LintConfig.js";
import type { LintContext, LintFrontmatter, LintReport } from "../LintContext.js";
import { LintDiagnostic } from "../LintDiagnostic.js";
import type { LintRule } from "../LintRule.js";
import { PositionMapping } from "../PositionMapping.js";
import { maskHtmlComments } from "./reading.js";

/** How a host parses the text it lints. @internal */
export interface ParseSettings {
	readonly dialect: MarkdownDialect;
	readonly frontmatter: boolean;
}

/** Resolve the parse settings; both hosts default to gfm with frontmatter capture on. @internal */
export const parseSettings = (options?: {
	readonly dialect?: MarkdownDialect;
	readonly frontmatter?: boolean;
}): ParseSettings => ({ dialect: options?.dialect ?? "gfm", frontmatter: options?.frontmatter ?? true });

const parseDocument = (source: string, settings: ParseSettings): Result.Result<MarkdownDocument, MarkdownParseError> =>
	MarkdownDocument.parseResult(
		source,
		MarkdownParseOptions.make({ dialect: settings.dialect, frontmatter: settings.frontmatter }),
	);

/**
 * What a rule reads: the source it sees, the tree, the mapping over that
 * source and the front matter facts. `source` and `document.source` differ
 * only when the front matter is a block the kit does not capture, whose
 * lines the parse saw as spaces. @internal
 */
export interface Reading {
	readonly source: string;
	readonly document: MarkdownDocument;
	readonly mapping: PositionMapping;
	readonly frontmatter: Option.Option<LintFrontmatter>;
}

/** markdownlint's line split: every line of `text` without its terminator. @internal */
export const splitLines = (text: string): Array<string> => text.split(/\r\n?|\n/);

/** The offset line `count + 1` starts at, or the length when there is no such line. @internal */
export const offsetAfterLines = (text: string, count: number): number => {
	if (count === 0) return 0;
	let seen = 0;
	for (const match of text.matchAll(/\r\n?|\n/g)) {
		seen++;
		if (seen === count) return match.index + match[0].length;
	}
	return text.length;
};

/**
 * `text` as markdownlint hands it to rules: comment bodies masked in the
 * content after its `frontMatterLines`-line front matter, never inside it.
 * markdownlint masks `\n`-normalized text; a lone `\r` is read as the `\n`
 * it becomes there, and kept. @internal
 */
export const maskContent = (text: string, frontMatterLines: number): string => {
	const end = offsetAfterLines(text, frontMatterLines);
	const content = text.slice(end);
	if (!/\r(?!\n)/.test(content)) return text.slice(0, end) + maskHtmlComments(content);
	const masked = maskHtmlComments(content.replace(/\r(?!\n)/g, "\n")).split("");
	for (let at = 0; at < content.length; at++) if (content[at] === "\r") masked[at] = "\r";
	return text.slice(0, end) + masked.join("");
};

// The 1-based line of a capture's last character, whether or not its span
// includes the closing fence's terminator.
const lastLineOf = (node: Frontmatter, mapping: PositionMapping): number =>
	mapping.lineNumber(Math.max(node.position.start.offset, node.position.end.offset - 1));

const frontmatterFacts = (
	node: Option.Option<Frontmatter>,
	lineCount: number,
	mapping: PositionMapping,
): LintFrontmatter => {
	const lines: Array<string> = [];
	for (let line = 1; line <= lineCount; line++) lines.push(mapping.lineText(line));
	return { node, lineCount, lines };
};

/**
 * Read `source` — markdownlint's text, comment bodies already masked after
 * its front matter — given markdownlint's front matter line count. The kit's
 * capture is kept when it lies inside those lines; otherwise the parse sees
 * them as spaces of equal length, so no tree node lies inside them and no
 * offset moves. With capture off, front matter is not read at all. @internal
 */
export const readSource = (
	source: string,
	frontMatterLines: number,
	settings: ParseSettings,
): Result.Result<Reading, MarkdownParseError> => {
	const count = settings.frontmatter ? frontMatterLines : 0;
	if (count > 0) {
		const captured = parseDocument(source, settings);
		if (Result.isFailure(captured)) return Result.fail(captured.failure);
		const mapping = PositionMapping.fromDocument(captured.success);
		const node = captured.success.frontmatter;
		if (Option.isSome(node) && lastLineOf(node.value, mapping) <= count) {
			return Result.succeed({
				source,
				document: captured.success,
				mapping,
				frontmatter: Option.some(frontmatterFacts(node, count, mapping)),
			});
		}
		const end = offsetAfterLines(source, count);
		const blanked = source.slice(0, end).replace(/[^\r\n]/g, " ") + source.slice(end);
		return Result.map(parseDocument(blanked, { ...settings, frontmatter: false }), (document) => {
			const sourceMapping = PositionMapping.of(source);
			return {
				source,
				document,
				mapping: sourceMapping,
				frontmatter: Option.some(frontmatterFacts(Option.none(), count, sourceMapping)),
			};
		});
	}
	// No front matter for markdownlint: a kit capture (a `---json` block) would
	// be content to markdownlint, so the parse does not capture one.
	return Result.map(parseDocument(source, { ...settings, frontmatter: false }), (document) => ({
		source,
		document,
		mapping: PositionMapping.fromDocument(document),
		frontmatter: Option.none(),
	}));
};

/**
 * Read an already-parsed document as given: its own source, tree and
 * capture. The capture's line count stretches to markdownlint's when the
 * capture lies inside markdownlint's block. @internal
 */
export const readDocument = (document: MarkdownDocument, frontMatterLines: number): Reading => {
	const mapping = PositionMapping.fromDocument(document);
	return {
		source: document.source,
		document,
		mapping,
		frontmatter: Option.map(document.frontmatter, (node) => {
			const last = lastLineOf(node, mapping);
			return frontmatterFacts(Option.some(node), Math.max(last, frontMatterLines), mapping);
		}),
	};
};

const isNode = (at: MarkdownNode | MarkdownRangeLike): at is MarkdownNode => "type" in at && "position" in at;

const spanOf = (at: MarkdownNode | MarkdownRangeLike): MarkdownRangeLike =>
	isNode(at)
		? { offset: at.position.start.offset, length: Math.max(0, at.position.end.offset - at.position.start.offset) }
		: at;

/** How the host runs one rule: its context's name, settings and severity. @internal */
export interface RuleRun {
	readonly name: string;
	readonly config: Readonly<Record<string, unknown>>;
	readonly severity: LintSeverity;
}

/** Build the context `rule` runs in over `reading`. @internal */
export const makeContext = (reading: Reading, rule: LintRule, run: RuleRun): LintContext => {
	const { mapping } = reading;
	return {
		name: run.name,
		document: reading.document,
		root: reading.document.root,
		source: reading.source,
		lines: mapping.lines(),
		frontmatter: reading.frontmatter,
		mapping,
		config: run.config,
		diagnostic: (report: LintReport) => {
			const span = spanOf(report.at);
			const lineNumber = mapping.lineNumber(span.offset);
			const range =
				report.range === undefined || report.range === false
					? Option.none()
					: mapping.range(report.range === true ? span : report.range, lineNumber);
			const edit = report.fix === undefined ? undefined : PositionMapping.edit(report.fix);
			return LintDiagnostic.make({
				ruleNames: rule.names,
				lineNumber,
				column: mapping.column(span.offset),
				severity: run.severity,
				detail: report.detail === undefined || report.detail === "" ? Option.none() : Option.some(report.detail),
				context: report.context === undefined || report.context === "" ? Option.none() : Option.some(report.context),
				range,
				fixInfo: edit === undefined ? Option.none() : mapping.fixInfo(edit, lineNumber),
				edit: edit === undefined ? Option.none() : Option.some(edit),
			});
		},
	};
};

/**
 * Run `rule` over `reading`, collecting its findings in report order, each
 * stamped with the run's severity whatever the rule built. @internal
 */
export const runRule = (reading: Reading, rule: LintRule, run: RuleRun): Array<LintDiagnostic> => {
	const findings: Array<LintDiagnostic> = [];
	rule.check(makeContext(reading, rule, run), (diagnostic) => {
		findings.push(
			diagnostic.severity === run.severity
				? diagnostic
				: LintDiagnostic.make({ ...diagnostic, severity: run.severity }),
		);
	});
	return findings;
};

/**
 * The finding a rule reports when the source could not be parsed at all —
 * only a hardening guard refuses a markdown document, so this is a document
 * nested past the cap. Positioned at the refusal, attributed to the rule,
 * because both hosts report per rule; always an error. @internal
 */
export const refusalDiagnostic = (error: MarkdownParseError, rule: LintRule): LintDiagnostic =>
	LintDiagnostic.make({
		ruleNames: rule.names,
		lineNumber: error.diagnostic.line + 1,
		column: error.diagnostic.character + 1,
		severity: "error",
		detail: Option.some(error.message),
		context: Option.none(),
		range: Option.none(),
		fixInfo: Option.none(),
		edit: Option.none(),
	});

/** What the programmatic host lints with. @internal */
export interface LintRun {
	readonly name: string;
	readonly config: LintConfigRecord;
	readonly noInlineConfig: boolean;
}

/**
 * The programmatic host's loop, as markdownlint's `lintContent` runs it:
 * inline comments resolved over `directiveLines` (the whole unmasked text,
 * front matter included, so its numbering is the findings' own), only rules
 * enabled on some line run, each with its settings and severity, and a
 * finding on a line where its rule is disabled is dropped. @internal
 */
export const lintReading = (
	reading: Result.Result<Reading, MarkdownParseError>,
	directiveLines: ReadonlyArray<string>,
	rules: ReadonlyArray<LintRule>,
	run: LintRun,
): Array<LintDiagnostic> => {
	const { effective, enabledPerLine } = InlineDirectives.resolve(directiveLines, run.config, rules, {
		noInlineConfig: run.noInlineConfig,
	});
	return rules.flatMap((rule) => {
		const key = LintConfig.key(rule);
		if (!enabledPerLine.some((enabled) => enabled.get(key) === true)) return [];
		const findings = Result.isFailure(reading)
			? [refusalDiagnostic(reading.failure, rule)]
			: runRule(reading.success, rule, {
					name: run.name,
					config: effective.settings.get(key) ?? {},
					severity: effective.severity.get(key) ?? "error",
				});
		return findings.filter((finding) => enabledPerLine[finding.lineNumber]?.get(key) === true);
	});
};
