import { Schema } from "effect";

/**
 * A changeset file could not be parsed: no front matter, a malformed YAML
 * block, or a bump outside `patch | minor | major`.
 *
 * @public
 */
export class ChangesetParseError extends Schema.TaggedError<ChangesetParseError>()("ChangesetParseError", {
	/** What was wrong with the file. */
	reason: Schema.String,
	/** The 1-based line the problem was found on, when known. */
	line: Schema.optionalKey(Schema.Number),
	/** The changeset file name, when the file was read from `.changeset/`. */
	file: Schema.optionalKey(Schema.String),
}) {
	override get message(): string {
		const where = this.file === undefined ? "" : ` (${this.file}${this.line === undefined ? "" : `:${this.line}`})`;
		return `Invalid changeset${where}: ${this.reason}`;
	}
}
