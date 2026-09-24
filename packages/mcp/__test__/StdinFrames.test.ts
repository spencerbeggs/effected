import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Layer, Queue, Sink, Stdio, Stream } from "effect";
import { GuardedStdio, PARSE_ERROR_FRAME, guardStdin, makeFrameGuard } from "../src/internal/StdinFrames.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BOM = String.fromCodePoint(0xfeff);
const NBSP = String.fromCodePoint(0xa0);
const bytes = (chunk: string | Uint8Array): Uint8Array => (typeof chunk === "string" ? encoder.encode(chunk) : chunk);

/** Feed chunks through one guard; collect what it forwards and how many lines it answered. */
const run = (chunks: ReadonlyArray<string | Uint8Array>, maxFrameLength?: number) => {
	const step = makeFrameGuard(maxFrameLength);
	let forwarded = "";
	let parseErrors = 0;
	for (const chunk of chunks) {
		const result = step(bytes(chunk));
		if (result.forward !== undefined) forwarded += decoder.decode(result.forward);
		parseErrors += result.parseErrors;
	}
	return { forwarded, parseErrors };
};

describe("makeFrameGuard", () => {
	it("holds a partial line until its newline, then forwards it whole", () => {
		assert.deepStrictEqual(run(['{"a":', '1}\n{"b"', ":2}\n"]), { forwarded: '{"a":1}\n{"b":2}\n', parseErrors: 0 });
	});

	it("answers an unparseable line, forwarding the lines around it in order", () => {
		assert.deepStrictEqual(run(['{"a":1}\n{not json\n{"b":2}\n']), { forwarded: '{"a":1}\n{"b":2}\n', parseErrors: 1 });
	});

	it("answers an unparseable line split across chunks once, when its newline arrives", () => {
		assert.deepStrictEqual(run(["{not", " json", '\n{"b":2}\n']), { forwarded: '{"b":2}\n', parseErrors: 1 });
	});

	it("drops a line of JSON whitespace without answering it", () => {
		assert.deepStrictEqual(run(['\n \t\r\n{"a":1}\r\n']), { forwarded: '{"a":1}\r\n', parseErrors: 0 });
	});

	it("answers a line of non-JSON whitespace, such as a no-break space", () => {
		assert.deepStrictEqual(run([`${NBSP}\n{"a":1}\n`]), { forwarded: '{"a":1}\n', parseErrors: 1 });
	});

	it("decodes a UTF-8 character split across chunks whole", () => {
		const e = encoder.encode("é");
		assert.deepStrictEqual(
			run([Uint8Array.of(...encoder.encode('{"a":"'), e[0] ?? 0), Uint8Array.of(e[1] ?? 0, ...encoder.encode('"}\n'))]),
			{
				forwarded: '{"a":"é"}\n',
				parseErrors: 0,
			},
		);
	});

	it("strips a byte-order mark at the start of the stream, as core does", () => {
		assert.deepStrictEqual(run([`${BOM}{"a":1}\n`]), { forwarded: '{"a":1}\n', parseErrors: 0 });
	});

	it("answers a later line that opens with U+FEFF, which core would not strip", () => {
		assert.deepStrictEqual(run(['{"a":1}\n', `${BOM}{"b":2}\n{"c":3}\n`]), {
			forwarded: '{"a":1}\n{"c":3}\n',
			parseErrors: 1,
		});
	});

	it("forwards a line at exactly the cap and answers a longer complete line without forwarding it", () => {
		assert.deepStrictEqual(run(['"123456"\n'], 8), { forwarded: '"123456"\n', parseErrors: 0 });
		assert.deepStrictEqual(run(['"1234567"\n{"a":1}\n'], 8), { forwarded: '{"a":1}\n', parseErrors: 1 });
	});

	it("answers a held line once it passes the cap, then discards the rest of it up to its newline", () => {
		assert.deepStrictEqual(run(['"1234567', "89", '0"\n{"a":1}\n'], 8), { forwarded: '{"a":1}\n', parseErrors: 1 });
	});

	it("forwards a valid-JSON non-request and keeps the partial frame after it", () => {
		assert.deepStrictEqual(run(['null\n{"jsonrpc":"2.0","id":2,"meth', 'od":"tools/list"}\n']), {
			forwarded: 'null\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
			parseErrors: 0,
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
			const guarded = guardStdin(stdioOver(Stream.make(bytes('{not json\n{"a":1}\n')), out));
			assert.strictEqual(text(yield* Stream.runCollect(guarded.stdin)), '{"a":1}\n');
			assert.deepStrictEqual(out, [PARSE_ERROR_FRAME]);
		}),
	);

	it.effect("keeps a held partial line when stdin is subscribed again, as core does after a failure", () =>
		Effect.gen(function* () {
			const chunks = yield* Queue.unbounded<Uint8Array>();
			const guarded = guardStdin(stdioOver(Stream.fromQueue(chunks), []));
			yield* Queue.offer(chunks, bytes('null\n{"jsonrpc":"2.0","id":2,"meth'));
			assert.strictEqual(text(yield* Stream.runCollect(Stream.take(guarded.stdin, 1))), "null\n");
			yield* Queue.offer(chunks, bytes('od":"tools/list"}\n'));
			assert.strictEqual(
				text(yield* Stream.runCollect(Stream.take(guarded.stdin, 1))),
				'{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n',
			);
		}),
	);
});

describe("GuardedStdio", () => {
	it.effect("provides the guarded Stdio over the ambient one", () =>
		Effect.gen(function* () {
			const out: Array<string> = [];
			const ambient = stdioOver(Stream.make(bytes('{not json\n{"a":1}\n')), out);
			const context = yield* Layer.build(GuardedStdio.pipe(Layer.provide(Layer.succeed(Stdio.Stdio, ambient))));
			const guarded = Context.get(context, Stdio.Stdio);
			assert.notStrictEqual(guarded, ambient);
			assert.strictEqual(text(yield* Stream.runCollect(guarded.stdin)), '{"a":1}\n');
			assert.deepStrictEqual(out, [PARSE_ERROR_FRAME]);
		}),
	);
});
