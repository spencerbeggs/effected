import type { LspMessage } from "../LspMessage.js";
import { LspTestFailure } from "../LspTestFailure.js";

/** How much text a failure message echoes. */
const ECHO = 2000;

/**
 * Cut `text` to the echo limit, marking the cut.
 *
 * @internal
 */
export const truncate = (text: string): string => (text.length <= ECHO ? text : `${text.slice(0, ECHO)}…`);

/**
 * A JSON object whose `jsonrpc` is `"2.0"`; a reader tells the three kinds
 * apart by their fields.
 *
 * @internal
 */
export const isLspMessage = (value: unknown): value is LspMessage =>
	typeof value === "object" &&
	value !== null &&
	!Array.isArray(value) &&
	(value as { readonly jsonrpc?: unknown }).jsonrpc === "2.0";

/**
 * The `NotJsonRpc` failure for a well-framed body that is no JSON-RPC 2.0 message.
 *
 * @internal
 */
export const notJsonRpc = (message: unknown): LspTestFailure =>
	new LspTestFailure({
		reason: "NotJsonRpc",
		message: `the server sent a frame that is not a JSON-RPC 2.0 message: ${truncate(JSON.stringify(message) ?? String(message))}`,
	});
