import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, Redacted, Stream } from "effect";
import { GitHubClient } from "../src/GitHubClient.js";
import { RetryPolicy } from "../src/Resilience.js";
import type { Reply } from "./fixtures.js";
import { linkNext } from "./fixtures.js";

// Interrupting a read must abort the HTTP request it has in flight, not leave
// it running unobserved. octokit's paginator drops every request option but
// `method`, `url` and `headers`, so the fiber's AbortSignal has to be threaded
// back in by the transport's own page-request function; these tests drive the
// REAL client over a fetch whose last call never resolves and read the signal
// that call received.

/** One call the hanging fetch saw: its URL and the signal it was handed. */
interface SeenCall {
	readonly url: string;
	readonly signal: AbortSignal | undefined;
}

/**
 * A `fetch` that answers `replies` in order and then never resolves.
 * `hung` settles when the never-resolving call arrives.
 */
const hangingFetch = (replies: ReadonlyArray<Reply>) => {
	const calls: Array<SeenCall> = [];
	let arrived: () => void = () => {};
	const hung = new Promise<void>((resolve) => {
		arrived = resolve;
	});
	const fetch: typeof globalThis.fetch = (input, init) => {
		const url = new Request(input as URL | globalThis.Request | string, init).url;
		calls.push({ url, signal: init?.signal ?? undefined });
		const reply = replies[calls.length - 1];
		if (reply === undefined) {
			arrived();
			return new Promise<Response>(() => {});
		}
		const response = new Response(JSON.stringify(reply.body ?? null), {
			status: reply.status,
			headers: { "content-type": "application/json", ...reply.headers },
		});
		Object.defineProperty(response, "url", { value: url });
		return Promise.resolve(response);
	};
	return { fetch, calls, hung };
};

const COORDS = { owner: "acme", repo: "widget" } as const;
const NEXT = "https://api.github.com/repositories/1/pulls?page=2";

/** Fork `read` over a client on `script`, wait for the hanging call, interrupt. */
const interruptWhenHung = <A, E>(
	script: ReturnType<typeof hangingFetch>,
	read: (client: GitHubClient["Service"]) => Effect.Effect<A, E>,
) =>
	Effect.gen(function* () {
		const client = yield* GitHubClient;
		const fiber = yield* Effect.forkChild(read(client));
		yield* Effect.promise(() => script.hung);
		yield* Fiber.interrupt(fiber);
	}).pipe(
		Effect.provide(
			GitHubClient.layerFromToken({
				token: Redacted.make("ghs_secret"),
				fetch: script.fetch,
				retry: RetryPolicy.none,
			}),
		),
	);

const walks = [
	["paginate", (client: GitHubClient["Service"]) => client.paginate("GET /repos/{owner}/{repo}/pulls", COORDS)],
	[
		"paginateStream",
		(client: GitHubClient["Service"]) =>
			Stream.runCollect(client.paginateStream("GET /repos/{owner}/{repo}/pulls", COORDS)),
	],
] as const;

describe("interrupting a paginated read aborts its in-flight request", () => {
	it.effect("control: interrupting a single request aborts its signal", () =>
		Effect.gen(function* () {
			// Proves the harness can observe an abort at all: `request` threaded
			// its signal before pagination did.
			const script = hangingFetch([]);
			yield* interruptWhenHung(script, (client) => client.request("GET /repos/{owner}/{repo}", COORDS));
			assert.strictEqual(script.calls.length, 1);
			assert.isTrue(script.calls[0]?.signal?.aborted === true, "the request's signal is aborted");
		}),
	);

	it.effect("interrupted on the first page: that request is aborted and nothing more is sent", () =>
		Effect.gen(function* () {
			for (const [member, walk] of walks) {
				const script = hangingFetch([]);
				yield* interruptWhenHung(script, walk);
				assert.strictEqual(script.calls.length, 1, member);
				assert.isDefined(script.calls[0]?.signal, `${member}: the page request carries a signal`);
				assert.isTrue(script.calls[0]?.signal?.aborted === true, `${member}: the in-flight page is aborted`);
			}
		}),
	);

	it.effect("interrupted mid-walk: the in-flight page is aborted and no further page is requested", () =>
		Effect.gen(function* () {
			for (const [member, walk] of walks) {
				const script = hangingFetch([{ status: 200, body: [{ number: 1 }], headers: linkNext(NEXT) }]);
				yield* interruptWhenHung(script, walk);
				assert.strictEqual(script.calls.length, 2, `${member}: page 1, then the hanging page 2, then nothing`);
				assert.strictEqual(script.calls[1]?.url, NEXT, member);
				assert.isTrue(script.calls[1]?.signal?.aborted === true, `${member}: page 2's request is aborted`);
				// The completed first page's signal belonged to a finished attempt.
				assert.isFalse(script.calls[0]?.signal?.aborted === true, `${member}: page 1 completed, never aborted`);
			}
		}),
	);
});
