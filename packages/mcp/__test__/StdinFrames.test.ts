import { assert, describe, it } from "@effect/vitest";
import { PARSE_ERROR_FRAME, makeFrameGuard } from "../src/internal/StdinFrames.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Feed text chunks through one guard; collect what it forwards and how many lines it dropped. */
const run = (chunks: ReadonlyArray<string>, maxFrameBytes?: number) => {
	const step = makeFrameGuard(maxFrameBytes);
	let forwarded = "";
	let parseErrors = 0;
	for (const chunk of chunks) {
		const result = step(encoder.encode(chunk));
		if (result.forward !== undefined) forwarded += decoder.decode(result.forward);
		parseErrors += result.parseErrors;
	}
	return { forwarded, parseErrors };
};

describe("makeFrameGuard", () => {
	it("holds a partial line until its newline, then forwards it whole", () => {
		assert.deepStrictEqual(run(['{"a":', '1}\n{"b"', ":2}\n"]), { forwarded: '{"a":1}\n{"b":2}\n', parseErrors: 0 });
	});

	it("drops and counts an unparseable line, forwarding the lines around it in order", () => {
		assert.deepStrictEqual(run(['{"a":1}\n{not json\n{"b":2}\n']), { forwarded: '{"a":1}\n{"b":2}\n', parseErrors: 1 });
	});

	it("counts an unparseable line split across chunks once, when its newline arrives", () => {
		assert.deepStrictEqual(run(["{not", " json", '\n{"b":2}\n']), { forwarded: '{"b":2}\n', parseErrors: 1 });
	});

	it("drops a whitespace-only line without counting it", () => {
		assert.deepStrictEqual(run(['\n  \r\n{"a":1}\r\n']), { forwarded: '{"a":1}\r\n', parseErrors: 0 });
	});

	it("forwards an over-cap line unexamined, split or whole, so core's own frame cap still applies", () => {
		assert.deepStrictEqual(run(["{not json at all\n"], 8), { forwarded: "{not json at all\n", parseErrors: 0 });
		assert.deepStrictEqual(run(["{not json", " at all\n{bad\n"], 8), {
			forwarded: "{not json at all\n",
			parseErrors: 1,
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
