import { Schema } from "effect";

/**
 * Raised when a package manager's lockfile text cannot be read as that
 * manager's native document: `PackageLockDocument.parse` here,
 * `PnpmLockDocument.parse` and `PnpmEnvDocument.parse` in `@effected/pnpm`,
 * and `BunLockDocument.parse` in `@effected/bun`.
 *
 * @remarks
 * It lives in `@effected/npm` because all three manager packages depend on
 * it, and `@effected/lockfiles` maps it into its own `LockfileParseError` and
 * `LockfileFramingError` without losing a field those errors carry.
 *
 * `reason` is the discriminant:
 *
 * - `"syntax"`: the text is not well-formed JSON, JSONC or YAML. `cause` is
 *   the engine's own error, and `line` the zero-based line of its first
 *   diagnostic where the engine reports one (the JSONC and YAML engines do;
 *   native `JSON.parse` does not).
 * - `"framing"`: the text parsed, but no single lockfile document could be
 *   located in it. `framing` says which check failed and `documents` how many
 *   YAML documents the stream carried. Only pnpm's YAML stream is framed.
 * - `"shape"`: the text parsed but does not have the document's shape.
 *   `cause` is the `SchemaError`.
 * - `"version"`: the document records a `lockfileVersion` older than the
 *   kit reads (npm `3`, pnpm `9`), or one that is not a number at all.
 *   `lockfileVersion` is the value found, verbatim, and `minimumSupported`
 *   the lowest version read. The gate runs before the shape decode, so an
 *   old document fails as too old rather than as malformed.
 *
 * Malformed input always fails through this error, never as a defect.
 *
 * @public
 */
export class LockfileDocumentError extends Schema.TaggedError<LockfileDocumentError>()("LockfileDocumentError", {
	/** Which manager's document was being read. */
	format: Schema.Literals(["npm", "pnpm", "bun"]),
	/** Which stage failed; see the class remarks for each. */
	reason: Schema.Literals(["syntax", "framing", "shape", "version"]),
	/** For `syntax`: the zero-based line of the engine's first diagnostic, when it reports one. */
	line: Schema.optionalKey(Schema.Number),
	/** For `syntax` and `shape`: the engine or schema failure, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
	/** For `framing`: which framing check failed. */
	framing: Schema.optionalKey(Schema.Literals(["noLockfileDocument", "noImporters", "unexpectedDocuments"])),
	/** For `framing`: how many YAML documents the stream carried. */
	documents: Schema.optionalKey(Schema.Int),
	/** For `version`: the `lockfileVersion` found, verbatim. */
	lockfileVersion: Schema.optionalKey(Schema.Union([Schema.String, Schema.Number])),
	/** For `version`: the lowest `lockfileVersion` the kit reads for this format. */
	minimumSupported: Schema.optionalKey(Schema.Number),
}) {
	/** Renders the format, the reason and the reason's own fields into one line. */
	override get message(): string {
		return this.reason === "syntax"
			? `${this.format} lockfile is not well-formed${this.line === undefined ? "" : ` (line ${this.line + 1})`}`
			: this.reason === "framing"
				? `${this.format} lockfile carries no single lockfile document (${this.framing ?? "noLockfileDocument"}, ${this.documents ?? 0} document(s))`
				: this.reason === "version"
					? `${this.format} lockfileVersion ${JSON.stringify(this.lockfileVersion)} is not supported: the kit reads ${this.format} lockfileVersion ${this.minimumSupported} and newer`
					: `${this.format} lockfile does not have the expected ${this.format} shape`;
	}
}
