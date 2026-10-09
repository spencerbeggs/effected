import { Schema } from "effect";

const causeMessage = (cause: unknown): string => {
	let current = cause;
	for (let depth = 0; depth < 8 && current instanceof Error && current.cause instanceof Error; depth++)
		current = current.cause;
	return current instanceof Error ? current.message : String(current);
};

/**
 * An image backend read or write failed.
 *
 * @public
 */
export class ImageBackendError extends Schema.TaggedError<ImageBackendError>()("ImageBackendError", {
	/** The backend operation that failed. */
	operation: Schema.Literals(["get", "set"]),
	/** The key involved. */
	key: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Image backend ${this.operation} failed for key "${this.key}": ${causeMessage(this.cause)}`;
	}
}
