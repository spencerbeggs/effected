// The kit's one guarded cause-message read. The canonical text lives in
// okf/conventions/error-standards.md; every package carries this module
// verbatim rather than importing it, because no pure zero-dependency kit
// package is a regular dependency of every site that needs it. Change it
// there first, then re-copy.

import { Predicate } from "effect";

/** How many nodes of a cause chain the walk reads before stopping, so a cyclic chain cannot spin. */
const CAUSE_DEPTH = 8;

/** The message a single node carries: a thrown string, or a non-empty string `message` property. */
const messageAt = (node: unknown): string | undefined => {
	const text = Predicate.isString(node)
		? node
		: Predicate.hasProperty(node, "message") && Predicate.isString(node.message)
			? node.message
			: undefined;
	return text === undefined || text.trim() === "" ? undefined : text;
};

/**
 * Every distinct non-empty message a preserved cause chain carries, nearest
 * first and joined with `: `, or `undefined` when nothing along it has one.
 *
 * A `Schema.Defect()` field holds whatever was thrown, so the read is guarded
 * rather than assumed: `Predicate.hasProperty` + `Predicate.isString` accepts
 * an `Error`, a cross-realm `Error` that fails `instanceof`, a plain
 * `{ message }` object and a thrown string alike. An empty or whitespace-only
 * message counts as none. The walk follows `cause` links because a wrapper's
 * text is often the generic summary and the driver's text underneath is the
 * actionable detail, yet a wrapper that composes its own context must not
 * lose it either; so nothing is dropped, and a deeper text the nearer one
 * already contains is not repeated. The walk is bounded, so a cycle terminates.
 */
export const causeMessage = (cause: unknown): string | undefined => {
	let message: string | undefined;
	let node: unknown = cause;
	for (let depth = 0; depth < CAUSE_DEPTH && node !== undefined && node !== null; depth++) {
		const text = messageAt(node);
		if (text !== undefined) {
			if (message === undefined || text.includes(message)) message = text;
			else if (!message.includes(text)) message = `${message}: ${text}`;
		}
		node = Predicate.hasProperty(node, "cause") ? node.cause : undefined;
	}
	return message;
};
