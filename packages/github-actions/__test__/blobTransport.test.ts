import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Cause, Effect, Exit, FileSystem, Option, Schedule } from "effect";
import { HttpBody, HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { BlobTransferError } from "../src/index.js";
import type { BlobTransferOptions } from "../src/internal/blobTransport.js";
import {
	BlobRequestError,
	SERVICE_VERSION,
	httpDataTransfer,
	httpFileTransfer,
} from "../src/internal/blobTransport.js";

const SIG = "SECRET_sig_7e7e";
const URL_ = `https://blob.example/acct/cont/blob?sv=2023-01-03&sr=b&sp=rw&sig=${SIG}`;

/** Small blocks and a fast schedule, so a block list takes bytes, not megabytes. */
const options = (over: Partial<BlobTransferOptions> = {}): BlobTransferOptions => ({
	maxSingleShotSize: 4,
	blockSize: 4,
	concurrency: 2,
	retrySchedule: Schedule.spaced("1 millis"),
	retries: 3,
	...over,
});

interface Recorded {
	readonly method: string;
	readonly url: URL;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: Uint8Array;
}

type Answer = Response | "transport";

/** A client that records every request and answers from `answer`. */
const fakeHttp = (answer: (request: Recorded, attempt: number) => Answer) => {
	const requests: Array<Recorded> = [];
	const client = HttpClient.make((request, url) => {
		const body =
			HttpBody.isHttpBody(request.body) && request.body._tag === "Uint8Array" ? request.body.body : new Uint8Array();
		const recorded: Recorded = { method: request.method, url, headers: { ...request.headers }, body };
		requests.push(recorded);
		const result = answer(recorded, requests.length);
		return result === "transport"
			? Effect.fail(new HttpClientError.HttpClientError({ reason: new HttpClientError.TransportError({ request }) }))
			: Effect.succeed(HttpClientResponse.fromWeb(request, result));
	});
	return { client, requests };
};

const ok = () => new Response(null, { status: 201 });
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const bytes = (s: string) => new TextEncoder().encode(s);

const failureOf = <A, E>(exit: Exit.Exit<A, E>): E => {
	if (Exit.isSuccess(exit)) return assert.fail("expected a failure");
	const error = Cause.findErrorOption(exit.cause);
	return Option.isSome(error) ? error.value : assert.fail("expected a typed failure");
};

const volume = (files: Readonly<Record<string, string>>) =>
	MemoryFileSystem.makeSync(
		Object.fromEntries(Object.entries(files).map(([path, content]) => [path, MemoryFileSystem.file(content)])),
	);

describe("blob transport upload", () => {
	it.effect("sends one PUT with the blob type and service version up to the threshold", () =>
		Effect.gen(function* () {
			const { client, requests } = fakeHttp(ok);
			yield* httpDataTransfer(client, options()).uploadData(URL_, bytes("abcd"));
			assert.strictEqual(requests.length, 1);
			const [put] = requests;
			assert.strictEqual(put?.method, "PUT");
			assert.strictEqual(put?.headers["x-ms-blob-type"], "BlockBlob");
			assert.strictEqual(put?.headers["x-ms-version"], SERVICE_VERSION);
			assert.strictEqual(put?.url.searchParams.get("sig"), SIG, "the SAS query is kept");
			assert.isNull(put?.url.searchParams.get("comp"));
			assert.strictEqual(text(put?.body ?? new Uint8Array()), "abcd");
		}),
	);

	it.effect("uploads a larger buffer as ordered fixed-width blocks and a block list", () =>
		Effect.gen(function* () {
			const { client, requests } = fakeHttp(ok);
			yield* httpDataTransfer(client, options()).uploadData(URL_, bytes("abcdefghij"));
			const blocks = requests.filter((r) => r.url.searchParams.get("comp") === "block");
			const lists = requests.filter((r) => r.url.searchParams.get("comp") === "blocklist");
			assert.strictEqual(blocks.length, 3);
			assert.strictEqual(lists.length, 1);
			assert.strictEqual(requests.at(-1), lists[0], "the block list goes last");
			const ids = blocks.map((b) => b.url.searchParams.get("blockid") ?? "");
			assert.strictEqual(new Set(ids.map((id) => id.length)).size, 1, "every id is one width");
			assert.deepStrictEqual(
				ids.map((id) => atob(id)),
				["00000000", "00000001", "00000002"],
			);
			const byId = new Map(blocks.map((b) => [b.url.searchParams.get("blockid"), text(b.body)]));
			assert.deepStrictEqual(
				ids.map((id) => byId.get(id)),
				["abcd", "efgh", "ij"],
			);
			assert.isUndefined(blocks[0]?.headers["x-ms-blob-type"]);
			assert.strictEqual(blocks[0]?.headers["x-ms-version"], SERVICE_VERSION);
			assert.strictEqual(blocks[0]?.url.searchParams.get("sig"), SIG);
			assert.strictEqual(
				text(lists[0]?.body ?? new Uint8Array()),
				`<?xml version="1.0" encoding="utf-8"?><BlockList>${ids.map((id) => `<Latest>${id}</Latest>`).join("")}</BlockList>`,
			);
			assert.include(lists[0]?.headers["content-type"] ?? "", "xml");
		}),
	);

	it.effect("uploads a file from the filesystem, single-shot and as blocks", () =>
		Effect.gen(function* () {
			const files = volume({ "/small": "abc", "/big": "0123456789" });
			const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(files.layer));
			const small = fakeHttp(ok);
			yield* httpFileTransfer(small.client, fs, options()).uploadFile(URL_, "/small");
			assert.strictEqual(small.requests.length, 1);
			assert.strictEqual(text(small.requests[0]?.body ?? new Uint8Array()), "abc");
			const big = fakeHttp(ok);
			yield* httpFileTransfer(big.client, fs, options()).uploadFile(URL_, "/big");
			const blocks = big.requests.filter((r) => r.url.searchParams.get("comp") === "block");
			assert.deepStrictEqual(
				blocks
					.map((b) => [atob(b.url.searchParams.get("blockid") ?? ""), text(b.body)] as const)
					.sort(([a], [b]) => a.localeCompare(b)),
				[
					["00000000", "0123"],
					["00000001", "4567"],
					["00000002", "89"],
				],
			);
		}),
	);

	it.effect("never has more blocks in flight than the concurrency", () =>
		Effect.gen(function* () {
			let inFlight = 0;
			let peak = 0;
			const requests: Array<Recorded> = [];
			const client = HttpClient.make((request, url) =>
				Effect.gen(function* () {
					inFlight++;
					peak = Math.max(peak, inFlight);
					yield* Effect.yieldNow;
					yield* Effect.yieldNow;
					inFlight--;
					requests.push({ method: request.method, url, headers: {}, body: new Uint8Array() });
					return HttpClientResponse.fromWeb(request, ok());
				}),
			);
			yield* httpDataTransfer(client, options({ concurrency: 2 })).uploadData(URL_, bytes("abcdefghijklmnop"));
			assert.isAtMost(peak, 2);
			assert.isAbove(peak, 1, "blocks do overlap");
		}),
	);

	it.live("retries a 503 and a transport fault, then succeeds", () =>
		Effect.gen(function* () {
			const { client, requests } = fakeHttp((_r, attempt) =>
				attempt === 1 ? "transport" : attempt === 2 ? new Response(null, { status: 503 }) : ok(),
			);
			yield* httpDataTransfer(client, options()).uploadData(URL_, bytes("ab"));
			assert.strictEqual(requests.length, 3);
		}),
	);

	it.live("retries a 429 and gives up after the configured retries", () =>
		Effect.gen(function* () {
			const { client, requests } = fakeHttp(() => new Response(null, { status: 429 }));
			const exit = yield* Effect.exit(httpDataTransfer(client, options({ retries: 2 })).uploadData(URL_, bytes("ab")));
			assert.strictEqual(requests.length, 3);
			const error = failureOf(exit);
			assert.instanceOf(error, BlobTransferError);
			assert.strictEqual(error.reason, "uploadFailed");
		}),
	);

	it.effect("does not retry a 403, and keeps the status, code and request id but no signature", () =>
		Effect.gen(function* () {
			const { client, requests } = fakeHttp(
				() =>
					new Response('<?xml version="1.0"?><Error><Code>AuthenticationFailed</Code><Message>nope</Message></Error>', {
						status: 403,
						headers: { "x-ms-request-id": "req-1", "set-cookie": "s=SECRET_cookie" },
					}),
			);
			const error = failureOf(yield* Effect.exit(httpDataTransfer(client, options()).uploadData(URL_, bytes("ab"))));
			assert.strictEqual(requests.length, 1);
			assert.strictEqual(error.reason, "uploadFailed");
			const cause = error.cause as BlobRequestError;
			assert.instanceOf(cause, BlobRequestError);
			assert.strictEqual(cause.statusCode, 403);
			assert.strictEqual(cause.code, "AuthenticationFailed");
			assert.strictEqual(cause.requestId, "req-1");
			assert.strictEqual(cause.method, "PUT");
			assert.include(cause.url, "sig=REDACTED");
			assert.include(cause.url, "sv=2023-01-03");
			const rendered = `${String(cause)}${JSON.stringify(cause)}${cause.url}${cause.stack ?? ""}`;
			assert.notInclude(rendered, SIG);
			assert.notInclude(rendered, "SECRET_cookie");
		}),
	);

	it.live("a transport fault that never recovers fails uploadFailed with no request kept", () =>
		Effect.gen(function* () {
			const { client } = fakeHttp(() => "transport");
			const error = failureOf(
				yield* Effect.exit(httpDataTransfer(client, options({ retries: 1 })).uploadData(URL_, bytes("ab"))),
			);
			const cause = error.cause as BlobRequestError;
			assert.isUndefined(cause.statusCode);
			assert.notInclude(`${String(cause)}${JSON.stringify(cause)}`, SIG);
		}),
	);

	it.effect("a missing file fails uploadFailed with the filesystem error", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(volume({}).layer));
			const { client, requests } = fakeHttp(ok);
			const error = failureOf(yield* Effect.exit(httpFileTransfer(client, fs, options()).uploadFile(URL_, "/missing")));
			assert.strictEqual(error.reason, "uploadFailed");
			assert.strictEqual(requests.length, 0);
		}),
	);
});

describe("blob transport download", () => {
	it.effect("GETs into a buffer, sending the service version and keeping the SAS query", () =>
		Effect.gen(function* () {
			const { client, requests } = fakeHttp(() => new Response("hello", { status: 200 }));
			const got = yield* httpDataTransfer(client, options()).downloadToBuffer(URL_);
			assert.strictEqual(text(got), "hello");
			assert.strictEqual(requests[0]?.method, "GET");
			assert.strictEqual(requests[0]?.headers["x-ms-version"], SERVICE_VERSION);
			assert.strictEqual(requests[0]?.url.searchParams.get("sig"), SIG);
		}),
	);

	it.effect("streams into a file", () =>
		Effect.gen(function* () {
			const files = volume({});
			const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(files.layer));
			const { client } = fakeHttp(() => new Response("0123456789", { status: 200 }));
			yield* httpFileTransfer(client, fs, options()).downloadToFile(URL_, "/out");
			assert.strictEqual(yield* fs.readFileString("/out"), "0123456789");
		}),
	);

	it.live("retries a 500 and restarts the file from the start", () =>
		Effect.gen(function* () {
			const files = volume({});
			const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(files.layer));
			const { client, requests } = fakeHttp((_r, attempt) =>
				attempt === 1
					? new Response(null, { status: 500 })
					: attempt === 2
						? new Response(
								new ReadableStream({
									start(controller) {
										controller.enqueue(bytes("par"));
										controller.error(new Error("socket hang up"));
									},
								}),
								{ status: 200 },
							)
						: new Response("whole", { status: 200 }),
			);
			yield* httpFileTransfer(client, fs, options()).downloadToFile(URL_, "/out");
			assert.strictEqual(requests.length, 3);
			assert.strictEqual(yield* fs.readFileString("/out"), "whole");
		}),
	);

	it.effect("a 404 fails downloadFailed at once, to a buffer or a file", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(volume({}).layer));
			const { client, requests } = fakeHttp(
				() => new Response("<Error><Code>BlobNotFound</Code></Error>", { status: 404 }),
			);
			const transfer = httpFileTransfer(client, fs, options());
			const toFile = failureOf(yield* Effect.exit(transfer.downloadToFile(URL_, "/out")));
			const toBuffer = failureOf(yield* Effect.exit(httpDataTransfer(client, options()).downloadToBuffer(URL_)));
			assert.strictEqual(requests.length, 2, "no retry");
			for (const error of [toFile, toBuffer]) {
				assert.strictEqual(error.reason, "downloadFailed");
				assert.strictEqual((error.cause as BlobRequestError).statusCode, 404);
				assert.strictEqual((error.cause as BlobRequestError).code, "BlobNotFound");
			}
		}),
	);
});
