import { Schema } from "effect";
import { causeMessage } from "../internal/causeMessage.js";

/**
 * An entry could not go through the bundler, or could not be bundled at all.
 *
 * @public
 */
export class BundleFailed extends Schema.TaggedError<BundleFailed>()("BundleFailed", {
	/** The entry at fault, as its bundle name or source path. */
	entry: Schema.String,
	/** What went wrong. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Could not bundle ${this.entry}: ${causeMessage(this.cause) ?? String(this.cause)}`;
	}
}

/**
 * The output directory could not be cleaned.
 *
 * @public
 */
export class CleanError extends Schema.TaggedError<CleanError>()("CleanError", {
	/** The directory. */
	directory: Schema.String,
	/** What went wrong. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Could not clean ${this.directory}: ${causeMessage(this.cause) ?? String(this.cause)}`;
	}
}

/**
 * An output file could not be written.
 *
 * @public
 */
export class WriteError extends Schema.TaggedError<WriteError>()("WriteError", {
	/** The file. */
	path: Schema.String,
	/** What went wrong. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Could not write ${this.path}: ${causeMessage(this.cause) ?? String(this.cause)}`;
	}
}
