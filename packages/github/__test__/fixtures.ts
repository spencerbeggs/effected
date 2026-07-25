/**
 * A scripted `fetch` for driving the REAL request path.
 *
 * @remarks
 * octokit accepts a replacement `fetch` as a documented option, so a test can
 * exercise the whole live client — classification, header capture, retry,
 * pagination — against canned HTTP responses. That is strictly more than a
 * hand-written double of the service can prove, because a double cannot get the
 * transport wrong.
 */

/** One scripted reply. */
export interface Reply {
	readonly status: number;
	readonly body?: unknown;
	readonly headers?: Record<string, string>;
}

/** What the scripted fetch recorded about one call. */
export interface Recorded {
	readonly url: string;
	readonly method: string;
	readonly headers: Record<string, string>;
	readonly body: string | undefined;
}

export interface ScriptedFetch {
	readonly fetch: typeof globalThis.fetch;
	/** Every call, in order. */
	readonly calls: ReadonlyArray<Recorded>;
	/** `calls.length`, for readability at assertion sites. */
	readonly count: () => number;
	/** The query parameters of call `index`. */
	readonly queryOf: (index: number) => URLSearchParams;
}

const toResponse = (reply: Reply): Response =>
	new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
		status: reply.status,
		headers: { "content-type": "application/json", ...reply.headers },
	});

/**
 * A `fetch` that answers with `replies` in order, repeating the last one once
 * the script runs out.
 */
export const scriptedFetch = (replies: ReadonlyArray<Reply>): ScriptedFetch => {
	const calls: Array<Recorded> = [];
	let index = 0;
	const fetch: typeof globalThis.fetch = async (input, init) => {
		const request = new Request(input as URL | globalThis.Request | string, init);
		calls.push({
			url: request.url,
			method: request.method,
			headers: Object.fromEntries(request.headers.entries()),
			body: init?.body === undefined || init.body === null ? undefined : String(init.body),
		});
		const reply = replies[Math.min(index, replies.length - 1)] ?? { status: 500 };
		index += 1;
		if (init?.signal?.aborted === true) {
			throw new DOMException("aborted", "AbortError");
		}
		return toResponse(reply);
	};
	return {
		fetch,
		calls,
		count: () => calls.length,
		queryOf: (at) => new URL(calls[at]?.url ?? "https://example.invalid").searchParams,
	};
};

/** A `Link` header pointing at the next page of the same route. */
export const linkNext = (url: string): Record<string, string> => ({ link: `<${url}>; rel="next"` });

/** GitHub's rate-limit header triple. */
export const rateLimitHeaders = (options: {
	remaining: number;
	limit?: number;
	resetEpochSeconds?: number;
}): Record<string, string> => ({
	"x-ratelimit-remaining": String(options.remaining),
	"x-ratelimit-limit": String(options.limit ?? 5000),
	"x-ratelimit-reset": String(options.resetEpochSeconds ?? 1_700_000_000),
});
