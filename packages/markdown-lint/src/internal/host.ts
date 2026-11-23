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
import { FrontmatterSource, MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import { Option, Result } from "effect";
import { InlineDirectives } from "../InlineDirectives.js";
import type { LintConfigRecord, LintSeverity } from "../LintConfig.js";
import { LintConfig } from "../LintConfig.js";
import type { LintContext, LintFrontmatter, LintReport } from "../LintContext.js";
import { LintDiagnostic } from "../LintDiagnostic.js";
import type { LintRule } from "../LintRule.js";
import { PositionMapping } from "../PositionMapping.js";
import { frontMatterLineCount, maskHtmlComments } from "./reading.js";

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
	/** `source` before comment masking: the same offsets, comment bodies as written. */
	readonly unmaskedSource: string;
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

const frontmatterFacts = (
	node: Option.Option<Frontmatter>,
	lineCount: number,
	mapping: PositionMapping,
): LintFrontmatter => {
	const lines: Array<string> = [];
	for (let line = 1; line <= lineCount; line++) lines.push(mapping.lineText(line));
	return { node, lineCount, lines };
};

// Whether the kit's capture grammar takes a block that ends inside
// markdownlint's `frontMatterLines`-line front matter. `FrontmatterSource`
// runs the parser's own offset-0 pre-scan, so this decides the capture
// without parsing.
const captureFits = (source: string, frontMatterLines: number): boolean => {
	const split = FrontmatterSource.split(source);
	return split.frontmatter !== undefined && split.bodyOffset <= offsetAfterLines(source, frontMatterLines);
};

/**
 * Read `source` — markdownlint's text, comment bodies already masked after
 * its front matter, with `unmaskedSource` the same text before masking —
 * given markdownlint's front matter line count, in one
 * parse. The kit's capture is kept when it lies inside those lines;
 * otherwise the parse sees them as spaces of equal length, so no tree node
 * lies inside them and no offset moves. With capture off, front matter is
 * not read at all. @internal
 */
export const readSource = (
	source: string,
	frontMatterLines: number,
	settings: ParseSettings,
	unmaskedSource: string = source,
): Result.Result<Reading, MarkdownParseError> => {
	const count = settings.frontmatter ? frontMatterLines : 0;
	if (count > 0 && captureFits(source, count)) {
		return Result.map(parseDocument(source, settings), (document) => {
			const mapping = PositionMapping.fromDocument(document);
			return {
				source,
				unmaskedSource,
				document,
				mapping,
				frontmatter: Option.some(frontmatterFacts(document.frontmatter, count, mapping)),
			};
		});
	}
	if (count > 0) {
		const end = offsetAfterLines(source, count);
		const blanked = source.slice(0, end).replace(/[^\r\n]/g, " ") + source.slice(end);
		return Result.map(parseDocument(blanked, { ...settings, frontmatter: false }), (document) => {
			const mapping = PositionMapping.of(source);
			return {
				source,
				unmaskedSource,
				document,
				mapping,
				frontmatter: Option.some(frontmatterFacts(Option.none(), count, mapping)),
			};
		});
	}
	// No front matter for markdownlint: a kit capture (a `---json` block) would
	// be content to markdownlint, so the parse does not capture one.
	return Result.map(parseDocument(source, { ...settings, frontmatter: false }), (document) => ({
		source,
		unmaskedSource,
		document,
		mapping: PositionMapping.fromDocument(document),
		frontmatter: Option.none(),
	}));
};

/**
 * `document` as the aligned reading, when it already is one: no leading
 * byte order mark, nothing for markdownlint to mask, and a front matter
 * capture exactly when markdownlint reads a block the kit's grammar takes
 * (so no `{…}` block to blank and no `---json` capture). Otherwise
 * `Option.none()`, and the caller re-reads the source. @internal
 */
export const alignedReading = (document: MarkdownDocument): Option.Option<Reading> => {
	const source = document.source;
	if (source.charCodeAt(0) === 0xfeff) return Option.none();
	const count = frontMatterLineCount(source);
	if (maskContent(source, count) !== source) return Option.none();
	const captured = Option.isSome(document.frontmatter);
	if (count === 0 ? captured : !captured || !captureFits(source, count)) return Option.none();
	const mapping = PositionMapping.fromDocument(document);
	return Option.some({
		source,
		unmaskedSource: source,
		document,
		mapping,
		frontmatter: count === 0 ? Option.none() : Option.some(frontmatterFacts(document.frontmatter, count, mapping)),
	});
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
		unmaskedSource: reading.unmaskedSource,
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
