// The machinery both hosts share: parse a source the one way, build a rule's
// context, run its check, and turn a parse refusal into findings. Keeping it
// in one module is what makes "the two hosts agree" a property of the code
// rather than of two copies of it.

import type { MarkdownDialect, MarkdownNode, MarkdownParseError, MarkdownRangeLike } from "@effected/markdown";
import { MarkdownDocument, MarkdownParseOptions } from "@effected/markdown";
import type { Result } from "effect";
import { Option } from "effect";
import type { LintContext, LintFrontmatter, LintReport } from "../LintContext.js";
import { LintDiagnostic } from "../LintDiagnostic.js";
import type { LintRule } from "../LintRule.js";
import { PositionMapping } from "../PositionMapping.js";

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

/** Parse `source` with `settings`. @internal */
export const parseDocument = (
	source: string,
	settings: ParseSettings,
): Result.Result<MarkdownDocument, MarkdownParseError> =>
	MarkdownDocument.parseResult(
		source,
		MarkdownParseOptions.make({ dialect: settings.dialect, frontmatter: settings.frontmatter }),
	);

const isNode = (at: MarkdownNode | MarkdownRangeLike): at is MarkdownNode => "type" in at && "position" in at;

const spanOf = (at: MarkdownNode | MarkdownRangeLike): MarkdownRangeLike =>
	isNode(at)
		? { offset: at.position.start.offset, length: Math.max(0, at.position.end.offset - at.position.start.offset) }
		: at;

const frontmatterOf = (document: MarkdownDocument, mapping: PositionMapping): Option.Option<LintFrontmatter> =>
	Option.map(document.frontmatter, (node) => {
		// The block's last character's line, whether or not its span includes
		// the closing fence's terminator.
		const lastOffset = Math.max(node.position.start.offset, node.position.end.offset - 1);
		const lineCount = mapping.lineNumber(lastOffset);
		const lines: Array<string> = [];
		for (let line = 1; line <= lineCount; line++) lines.push(mapping.lineText(line));
		return { node, lineCount, lines };
	});

/** Build the context `rule` runs in over `document`. @internal */
export const makeContext = (document: MarkdownDocument, rule: LintRule, name: string): LintContext => {
	const mapping = PositionMapping.fromDocument(document);
	return {
		name,
		document,
		root: document.root,
		source: document.source,
		lines: mapping.lines(),
		frontmatter: frontmatterOf(document, mapping),
		mapping,
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
				detail: report.detail === undefined || report.detail === "" ? Option.none() : Option.some(report.detail),
				context: report.context === undefined || report.context === "" ? Option.none() : Option.some(report.context),
				range,
				fixInfo: edit === undefined ? Option.none() : mapping.fixInfo(edit, lineNumber),
				edit: edit === undefined ? Option.none() : Option.some(edit),
			});
		},
	};
};

/** Run `rule` over `document`, collecting its findings in report order. @internal */
export const runRule = (document: MarkdownDocument, rule: LintRule, name: string): Array<LintDiagnostic> => {
	const findings: Array<LintDiagnostic> = [];
	rule.check(makeContext(document, rule, name), (diagnostic) => {
		findings.push(diagnostic);
	});
	return findings;
};

/**
 * The finding a rule reports when the source could not be parsed at all —
 * only a hardening guard refuses a markdown document, so this is a document
 * nested past the cap. Positioned at the refusal, attributed to the rule,
 * because both hosts report per rule. @internal
 */
export const refusalDiagnostic = (error: MarkdownParseError, rule: LintRule): LintDiagnostic =>
	LintDiagnostic.make({
		ruleNames: rule.names,
		lineNumber: error.diagnostic.line + 1,
		column: error.diagnostic.character + 1,
		detail: Option.some(error.message),
		context: Option.none(),
		range: Option.none(),
		fixInfo: Option.none(),
		edit: Option.none(),
	});
