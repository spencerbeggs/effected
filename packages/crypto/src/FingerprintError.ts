import { Schema } from "effect";

/**
 * A value handed to `Fingerprint` has no canonical JSON form, so it cannot be
 * fingerprinted.
 *
 * @remarks
 * Raised for a `bigint`, a function or symbol anywhere, a top-level
 * `undefined`, a non-finite number, a cycle, a getter or
 * `Date`'s `toJSON` that throws, and any object that is neither a `Date`, an
 * array nor a plain object (a `Map`, a `Set`, a class instance, an Effect
 * data type such as `Option`, whatever `toJSON` it carries): encode a domain
 * value to plain JSON first. `path` locates the offending value as a JSON-pointer-like
 * string (`""` is the root, `/rules/0/name` a nested member), and `detail`
 * says what was found there. A fingerprint is decided by its input, so this
 * is caller input: recover with `Effect.catchTag("FingerprintError", ...)`.
 *
 * @public
 */
export class FingerprintError extends Schema.TaggedError<FingerprintError>()("FingerprintError", {
	/** Where the offending value sits: `""` for the root, `/a/0` for a nested member. */
	path: Schema.String,
	/** What was found there, such as `a bigint` or `a cycle`. */
	detail: Schema.String,
}) {
	override get message(): string {
		const where = this.path === "" ? "the root" : JSON.stringify(this.path);
		return `cannot fingerprint ${where}: ${this.detail} has no canonical JSON form`;
	}
}
