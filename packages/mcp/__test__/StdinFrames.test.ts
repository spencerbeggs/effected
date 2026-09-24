import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer, Queue, Sink, Stdio, Stream } from "effect";
import {
	INVALID_REQUEST_FRAME,
	PARSE_ERROR_FRAME,
	guardStdin,
	makeFrameGuard,
	makeGuardedStdio,
} from "../src/internal/StdinFrames.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BOM = String.fromCodePoint(0xfeff);
const NBSP = String.fromCodePoint(0xa0);
const bytes = (chunk: string | Uint8Array): Uint8Array => (typeof chunk === "string" ? encoder.encode(chunk) : chunk);

/** Feed chunks through one guard; collect what it forwards and the replies it answered lines with, in order. */
const run = (chunks: ReadonlyArray<string | Uint8Array>, maxFrameLength?: number) => {
	const step = makeFrameGuard(maxFrameLength);
	let forwarded = "";
	const replies: Array<string> = [];
	for (const chunk of chunks) {
		const result = step(bytes(chunk));
		if (result.forward !== undefined) forwarded += decoder.decode(result.forward);
		replies.push(...result.replies);
	}
	return { forwarded, replies };
};
const P = PARSE_ERROR_FRAME;
const I = INVALID_REQUEST_FRAME;

describe("makeFrameGuard", () => {
	it("holds a partial line until its newline, then forwards it whole", () => {
		assert.deepStrictEqual(run(['{"id":', '1}\n{"id"', ":2}\n"]), { forwarded: '{"id":1}\n{"id":2}\n', replies: [] });
	});

	it("answers an unparseable line, forwarding the lines around it in order", () => {
		assert.deepStrictEqual(run(['{"id":1}\n{not json\n{"id":2}\n']), {
			forwarded: '{"id":1}\n{"id":2}\n',
			replies: [P],
		});
	});

	it("answers an unparseable line split across chunks once, when its newline arrives", () => {
		assert.deepStrictEqual(run(["{not", " json", '\n{"id":2}\n']), { forwarded: '{"id":2}\n', replies: [P] });
	});

	it("drops a line of JSON whitespace without answering it", () => {
		assert.deepStrictEqual(run(['\n \t\r\n{"id":1}\r\n']), { forwarded: '{"id":1}\r\n', replies: [] });
	});

	it("answers a line of non-JSON whitespace, such as a no-break space", () => {
		assert.deepStrictEqual(run([`${NBSP}\n{"id":1}\n`]), { forwarded: '{"id":1}\n', replies: [P] });
	});

	it("decodes a UTF-8 character split across chunks whole", () => {
		const e = encoder.encode("é");
		assert.deepStrictEqual(
			run([
				Uint8Array.of(...encoder.encode('{"id":"'), e[0] ?? 0),
				Uint8Array.of(e[1] ?? 0, ...encoder.encode('"}\n')),
			]),
			{
				forwarded: '{"id":"é"}\n',
				replies: [],
			},
		);
	});

	it("strips a byte-order mark at the start of the stream, as core does", () => {
		assert.deepStrictEqual(run([`${BOM}{"id":1}\n`]), { forwarded: '{"id":1}\n', replies: [] });
	});

	it("answers a later line that opens with U+FEFF, which core would not strip", () => {
		assert.deepStrictEqual(run(['{"id":1}\n', `${BOM}{"id":2}\n{"id":3}\n`]), {
			forwarded: '{"id":1}\n{"id":3}\n',
			replies: [P],
		});
	});

	it("forwards a line at exactly the cap and answers a longer complete line without forwarding it", () => {
		assert.deepStrictEqual(run(['{"id":1}\n'], 8), { forwarded: '{"id":1}\n', replies: [] });
		assert.deepStrictEqual(run(['{"id":12}\n{"id":1}\n'], 8), { forwarded: '{"id":1}\n', replies: [P] });
	});

	it("answers a held line once it passes the cap, then discards the rest of it up to its newline", () => {
		assert.deepStrictEqual(run(['"1234567', "89", '0"\n{"id":1}\n'], 8), { forwarded: '{"id":1}\n', replies: [P] });
	});

	it("answers a bare null with an invalid request and keeps the partial frame after it", () => {
		assert.deepStrictEqual(run(['null\n{"jsonrpc":"2.0","id":2,"meth', 'od":"tools/list"}\n']), {
			forwarded: '{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
			replies: [I],
		});
	});

	it("answers every JSON value that is neither an object nor an array with an invalid request", () => {
		for (const value of ["null", "0", "-1.5e3", '"text"', "true", "false"]) {
			assert.deepStrictEqual(run([`${value}\n{"id":1}\n`]), { forwarded: '{"id":1}\n', replies: [I] }, value);
		}
	});

	it("answers an object carrying neither a method nor an id, which is no JSON-RPC message at all", () => {
		for (const value of ["{}", '{"foo":1}', '{"jsonrpc":"2.0"}', '{"jsonrpc":"2.0","result":{}}']) {
			assert.deepStrictEqual(run([`${value}\n`]), { forwarded: "", replies: [I] }, value);
		}
	});

	it("answers an object whose method is not a string and whose id is absent or null", () => {
		for (const value of ['{"method":1}', '{"method":null}', '{"jsonrpc":"2.0","method":["x"],"id":null}']) {
			assert.deepStrictEqual(run([`${value}\n`]), { forwarded: "", replies: [I] }, value);
		}
	});

	it("forwards every frame core answers or ignores itself: arrays, responses, and requests it can reply to", () => {
		const frames = [
			"[]",
			"[1]",
			"[null]",
			'[{"jsonrpc":"2.0","id":7,"method":"tools/list"}]',
			'{"jsonrpc":"2.0","id":4,"method":5}',
			'{"jsonrpc":"2.0","id":4,"result":{}}',
			'{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"x"}}',
			'{"id":null}',
			'{"jsonrpc":"2.0","method":"notifications/initialized"}',
		];
		const input = frames.map((frame) => `${frame}\n`).join("");
		assert.deepStrictEqual(run([input]), { forwarded: input, replies: [] });
	});

	it("answers each bad line in stdin order, a parse error and an invalid request alike", () => {
		assert.deepStrictEqual(run(['{not json\n7\n{"id":1}\n{x\n']), { forwarded: '{"id":1}\n', replies: [P, I, P] });
	});
});

describe("INVALID_REQUEST_FRAME", () => {
	it("is one newline-framed JSON-RPC -32600 response with a null id", () => {
		assert.isTrue(INVALID_REQUEST_FRAME.endsWith("}\n"));
		assert.deepStrictEqual(JSON.parse(INVALID_REQUEST_FRAME), {
			jsonrpc: "2.0",
			id: null,
			error: { code: -32600, message: "Invalid Request" },
		});
	});
});

describe("PARSE_ERROR_FRAME", () => {
	it("is one newline-framed JSON-RPC -32700 response with a null id", () => {
		assert.isTrue(PARSE_ERROR_FRAME.endsWith("}\n"));
		assert.deepStrictEqual(JSON.parse(PARSE_ERROR_FRAME), {
			jsonrpc: "2.0",
			id: null,
			error: { code: -32700, message: "Parse error" },
		});
	});
});

const recordInto = (out: Array<string>) => (data: string | Uint8Array) =>
	Effect.sync(() => {
		out.push(typeof data === "string" ? data : decoder.decode(data));
	});

/** A `Stdio` over the given stdin whose stdout writes land in `out`. */
const stdioOver = (stdin: Stream.Stream<Uint8Array>, out: Array<string>): Stdio.Stdio =>
	Stdio.make({
		args: Effect.succeed([]),
		stdin,
		stdout: () => Sink.forEach(recordInto(out)),
		stderr: () => Sink.drain,
	});

const text = (chunks: ReadonlyArray<Uint8Array>) => chunks.map((chunk) => decoder.decode(chunk)).join("");

describe("guardStdin", () => {
	it.effect("writes the parse error to stdout and forwards the lines that parse", () =>
		Effect.gen(function* () {
			const out: Array<string> = [];
			const guarded = guardStdin(stdioOver(Stream.make(bytes('{not json\n{"id":1}\n')), out));
			assert.strictEqual(text(yield* Stream.runCollect(guarded.stdin)), '{"id":1}\n');
			assert.deepStrictEqual(out, [PARSE_ERROR_FRAME]);
		}),
	);

	it.effect("writes every reply a chunk earns to stdout in one write, in stdin order", () =>
		Effect.gen(function* () {
			const out: Array<string> = [];
			const guarded = guardStdin(stdioOver(Stream.make(bytes('null\n{not json\n{"id":1}\n')), out));
			assert.strictEqual(text(yield* Stream.runCollect(guarded.stdin)), '{"id":1}\n');
			assert.deepStrictEqual(out, [INVALID_REQUEST_FRAME + PARSE_ERROR_FRAME]);
		}),
	);

	it.effect("keeps a held partial line when stdin is subscribed again, as core does after a failure", () =>
		Effect.gen(function* () {
			const chunks = yield* Queue.unbounded<Uint8Array>();
			const guarded = guardStdin(stdioOver(Stream.fromQueue(chunks), []));
			yield* Queue.offer(chunks, bytes('{"id":1}\n{"jsonrpc":"2.0","id":2,"meth'));
			assert.strictEqual(text(yield* Stream.runCollect(Stream.take(guarded.stdin, 1))), '{"id":1}\n');
			yield* Queue.offer(chunks, bytes('od":"tools/list"}\n'));
			assert.strictEqual(
				text(yield* Stream.runCollect(Stream.take(guarded.stdin, 1))),
				'{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
			);
		}),
	);
});

class SeenA extends Context.Service<SeenA, Stdio.Stdio>()("test/SeenA") {}
class SeenB extends Context.Service<SeenB, Stdio.Stdio>()("test/SeenB") {}

describe("makeGuardedStdio", () => {
	it.effect("mints a guard per call, so two in one graph each wrap their own ambient Stdio", () =>
		Effect.gen(function* () {
			const side = <I>(seen: Context.Key<I, Stdio.Stdio>, stdin: string) =>
				Layer.effect(seen, Stdio.Stdio).pipe(
					Layer.provide(makeGuardedStdio()),
					Layer.provide(Layer.succeed(Stdio.Stdio, stdioOver(Stream.make(bytes(stdin)), []))),
				);
			const context = yield* Layer.build(Layer.mergeAll(side(SeenA, '{"id":1}\n'), side(SeenB, '{"id":2}\n')));
			assert.strictEqual(text(yield* Stream.runCollect(Context.get(context, SeenA).stdin)), '{"id":1}\n');
			assert.strictEqual(text(yield* Stream.runCollect(Context.get(context, SeenB).stdin)), '{"id":2}\n');
		}),
	);

	it.effect("provides the guarded Stdio over the ambient one", () =>
		Effect.gen(function* () {
			const out: Array<string> = [];
			const ambient = stdioOver(Stream.make(bytes('{not json\n{"id":1}\n')), out);
			const context = yield* Layer.build(makeGuardedStdio().pipe(Layer.provide(Layer.succeed(Stdio.Stdio, ambient))));
			const guarded = Context.get(context, Stdio.Stdio);
			assert.notStrictEqual(guarded, ambient);
			assert.strictEqual(text(yield* Stream.runCollect(guarded.stdin)), '{"id":1}\n');
			assert.deepStrictEqual(out, [PARSE_ERROR_FRAME]);
		}),
	);
});
