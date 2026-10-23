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
 * @remarks
 * `reason` says why, so a caller branches on a literal rather than reading
 * the message: `backend` is a failure of the store underneath (the file
 * system for `layerDirectory`, the adapted service for `layerFrom`), and
 * `unsupported-content-type` is a `set` whose content type the directory
 * backend has no file extension for. `backend` names the source rather than
 * claiming file IO, because `layerFrom` wraps any source failure — a store
 * `Cache` error included — under it.
 *
 * `reason` is required: a hand-written backend states which case it hit.
 *
 * @public
 */
export class ImageBackendError extends Schema.TaggedError<ImageBackendError>()("ImageBackendError", {
	/** The backend operation that failed. */
	operation: Schema.Literals(["get", "set"]),
	/** Why it failed: the store underneath, or a content type the backend cannot store. */
	reason: Schema.Literals(["backend", "unsupported-content-type"]),
	/** The key involved. */
	key: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Image backend ${this.operation} failed for key "${this.key}" (${this.reason}): ${causeMessage(this.cause)}`;
	}
}
