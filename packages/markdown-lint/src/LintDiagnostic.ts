// The diagnostic one lint rule reports, in the shape markdownlint's `onError`
// takes, plus the two things only the programmatic host needs: the reporting
// rule's names and a column. Every positional field is derived from kit
// offsets by `PositionMapping`; a rule author normally builds a diagnostic
// through `LintContext.diagnostic`, never by counting lines.

import { MarkdownEdit } from "@effected/markdown";
import { Schema } from "effect";

const PositiveInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

/**
 * A markdownlint `fixInfo`: a one-line edit, 1-based, in markdownlint's own
 * field names. Every field is optional, exactly as markdownlint's
 * `RuleOnErrorFixInfo` is.
 *
 * @remarks
 * `lineNumber` is present only when the fix lands on a different line than
 * the diagnostic's own `lineNumber`; markdownlint reads an absent one as the
 * diagnostic's line. `deleteCount` is `-1` for a fix that deletes the whole
 * line, terminator included — markdownlint's spelling for that edit, and the
 * only way its `fixInfo` can remove a line break. An edit that crosses a line
 * break any other way has no `fixInfo` at all (see
 * {@link PositionMapping.fixInfo}); the kit edit still rides on
 * {@link LintDiagnostic} as `edit`.
 *
 * @public
 */
export class LintFixInfo extends Schema.Class<LintFixInfo>("LintFixInfo")({
	/** The 1-based line of the fix, when it is not the diagnostic's line. */
	lineNumber: Schema.optionalKey(PositiveInt),
	/** The 1-based column, in UTF-16 code units, where the edit starts. */
	editColumn: Schema.optionalKey(PositiveInt),
	/** How many characters to delete, or `-1` to delete the whole line. */
	deleteCount: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1))),
	/** The text to insert after deleting. */
	insertText: Schema.optionalKey(Schema.String),
}) {}

/**
 * A markdownlint `range`: the 1-based column and the length, in UTF-16 code
 * units, of the reported span on the diagnostic's line. Both are at least 1.
 *
 * @public
 */
export type LintRange = readonly [column: number, length: number];

/**
 * One finding a lint rule reports: markdownlint's `onError` fields, derived
 * from kit positions, plus the reporting rule's names and the column.
 *
 * @remarks
 * Line numbers count the WHOLE source, frontmatter included — the lines an
 * editor shows. The markdownlint adapter converts them to markdownlint's own
 * numbering (relative to the content after its front matter, with
 * `frontMatter: true` for a line inside it) at the boundary; nothing else
 * ever sees that numbering.
 *
 * Absence is `Option.none()` on every optional field, never an empty string:
 * markdownlint itself reads an empty `detail` or `context` as absent, so the
 * two spellings would collapse at the adapter anyway.
 *
 * Built by `LintContext.diagnostic` in a rule, which stamps the rule's names
 * and derives every position from the node or span it is given. `make`
 * validates: a `lineNumber` or `column` below 1, a fractional one, or an empty
 * `ruleNames` throws, as wiring errors do.
 *
 * @public
 */
export class LintDiagnostic extends Schema.Class<LintDiagnostic>("LintDiagnostic")({
	/** The reporting rule's names, as `LintRule.names` spells them. */
	ruleNames: Schema.NonEmptyArray(Schema.NonEmptyString),
	/** The 1-based line of the finding, counting the whole source. */
	lineNumber: PositiveInt,
	/** The 1-based column of the finding's start, in UTF-16 code units. */
	column: PositiveInt,
	/** What is wrong, for a reader. */
	detail: Schema.Option(Schema.String),
	/** The offending text, as markdownlint's `context`. */
	context: Schema.Option(Schema.String),
	/** The reported span on the finding's line, as markdownlint's `range`. */
	range: Schema.Option(Schema.Tuple([PositiveInt, PositiveInt])),
	/** The fix as markdownlint's one-line `fixInfo`, when it can say it. */
	fixInfo: Schema.Option(LintFixInfo),
	/**
	 * The fix as a kit offset edit, for `MarkdownEdit.applyAll`; present
	 * whenever the rule offered a fix, `fixInfo` or not.
	 */
	edit: Schema.Option(MarkdownEdit),
}) {}
