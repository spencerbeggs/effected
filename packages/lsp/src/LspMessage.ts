/**
 * A JSON-RPC 2.0 message as an LSP frame body carries it: a request (an `id`
 * and a `method`), a notification (a `method`, no `id`) or a response (an
 * `id` and either `result` or `error`).
 *
 * @remarks
 * Structural on purpose. Every field but `jsonrpc` is optional, because one
 * shape describes all three kinds and the reader distinguishes them by which
 * fields are present: `method` and `id` is a request, `method` alone is a
 * notification, `id` without `method` is a response. A decoded frame body is
 * `unknown` until a caller has checked it is one of these.
 *
 * @public
 */
export interface LspMessage {
	/** Always `"2.0"`. */
	readonly jsonrpc: "2.0";
	/** Present on a request and a response; `null` on a response to a request whose id could not be read. */
	readonly id?: number | string | null;
	/** Present on a request and a notification. */
	readonly method?: string;
	/** A request's or notification's parameters. */
	readonly params?: unknown;
	/** A successful response's result; `null` is a valid result (`shutdown` answers it). */
	readonly result?: unknown;
	/** A failed response's error. */
	readonly error?: {
		readonly code: number;
		readonly message: string;
		readonly data?: unknown;
	};
}
