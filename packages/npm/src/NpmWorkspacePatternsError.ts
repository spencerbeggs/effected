import { Schema } from "effect";

/**
 * Raised when a `workspaces` field cannot be read the way npm reads it: it
 * declares more patterns, wildcard patterns or brace alternatives than
 * {@link NpmWorkspacePatterns} matches, holds a matched pattern that is too
 * long, or holds one glob will not compile.
 *
 * @remarks
 * Each ceiling bounds the matcher's own cost, so a hostile field fails here,
 * typed, rather than being read some other way: a fallback reading would
 * silently misclassify the directories the patterns exist to tell apart.
 * `reason` is the discriminant; `actual` and `limit` are the measured value
 * and the ceiling it passed. `index` names the offending pattern's position
 * in the declaration where one pattern is at fault. For `tooManyAlternatives`,
 * `count` says what `actual` is: an `exact` sum of alternatives, the point
 * where counting `stopped` (a lower bound), an `inexact` weight (a numeric
 * range weighed by its value count, an upper bound), or `unbounded`. For
 * `uncompilable`, `cause` is glob's own `GlobPatternError`, whose `limit` and
 * `actual` are copied here.
 *
 * @public
 */
export class NpmWorkspacePatternsError extends Schema.TaggedError<NpmWorkspacePatternsError>()(
	"NpmWorkspacePatternsError",
	{
		/** Which ceiling the field passed, or `uncompilable` for a pattern glob rejects. */
		reason: Schema.Literals([
			"tooManyPatterns",
			"tooManyWildcards",
			"patternTooLong",
			"tooManyAlternatives",
			"uncompilable",
		]),
		/** The offending pattern's index in the declaration, where one pattern is at fault. */
		index: Schema.optionalKey(Schema.Number),
		/** The measured value: a count, a length, or an alternative weight (possibly `Infinity`). */
		actual: Schema.Number,
		/** The ceiling `actual` passed. */
		limit: Schema.Number,
		/** For `tooManyAlternatives`: what kind of figure `actual` is. */
		count: Schema.optionalKey(Schema.Literals(["exact", "stopped", "inexact", "unbounded"])),
		/** For `uncompilable`: glob's `GlobPatternError`. */
		cause: Schema.optionalKey(Schema.Defect()),
	},
) {
	/** Renders the reason, the offending pattern's index and the figures into one line. */
	override get message(): string {
		const at = this.index === undefined ? "" : ` (pattern at index ${this.index})`;
		const messages: Record<typeof this.reason, string> = {
			tooManyPatterns: `workspaces field declares ${this.actual} patterns, more than the ${this.limit} the matcher reads`,
			tooManyWildcards: `workspaces field declares ${this.actual} wildcard patterns, more than the ${this.limit} the matcher reads`,
			patternTooLong: `workspaces pattern is ${this.actual} characters long, more than the ${this.limit} the matcher reads${at}`,
			tooManyAlternatives: `workspaces field's wildcard patterns may expand to more than the ${this.limit} brace alternatives the matcher reads (${this.count ?? "exact"}: ${this.actual})`,
			uncompilable: `workspaces pattern will not compile${at}`,
		};
		return messages[this.reason];
	}
}
