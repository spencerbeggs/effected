// JournalFile against real files: the sync, runtime-free reads on `./node`.
//
// Real disk rather than memfs because the reader is `node:fs` itself, and the
// resets it reports (a new inode, a moved mtime) are properties of a real
// filesystem.

import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	renameSync,
	rmSync,
	truncateSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, assert, describe, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";
import { Envelope, JsonlEvent, Line } from "../../src/index.js";
import type { JournalCursor, JournalFileError, JournalRead } from "../../src/node.js";
import { JournalCursor as JournalCursorSchema, JournalFile } from "../../src/node.js";

const DIR = mkdtempSync(join(tmpdir(), "jsonl-journal-file-"));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));
let counter = 0;
const fresh = (content: string | Uint8Array = ""): string => {
	const path = join(DIR, `journal-${counter++}.jsonl`);
	writeFileSync(path, content);
	return path;
};

const read = (path: string, cursor?: JournalCursor): JournalRead => {
	const result = JournalFile.readFromResult(path, cursor);
	assert.isTrue(Result.isSuccess(result), Result.isFailure(result) ? String(result.failure) : "");
	return (result as Result.Success<JournalRead, JournalFileError>).success;
};
const texts = (result: JournalRead): ReadonlyArray<string> => result.lines.map((line) => line.text);

const State = JsonlEvent.make("state", { data: Schema.Struct({ round: Schema.Number }) });
const events = [State] as const;
const envelope = (round: number): string =>
	`${JSON.stringify({ at: "2026-11-21T00:00:00.000Z", event: "state", data: { round } })}\n`;

describe("JournalFile.readFromResult", () => {
	it("reads every complete line from the start, holding back a torn tail", () => {
		const path = fresh('{"a":1}\n{"b":2}\n{"c":');
		const first = read(path);
		assert.strictEqual(first.reset, "initial");
		assert.deepStrictEqual(texts(first), ['{"a":1}', '{"b":2}']);
		assert.strictEqual(first.cursor.end, 16);
		assert.deepStrictEqual(
			first.lines.map(({ offset, end }) => [offset, end]),
			[
				[0, 8],
				[8, 16],
			],
		);
	});

	it("reads only what was appended since the cursor, and the torn line once it completes", () => {
		const path = fresh('{"a":1}\n{"c":');
		const first = read(path);
		assert.deepStrictEqual(texts(first), ['{"a":1}']);
		// Nothing new: the torn tail is still held back.
		const idle = read(path, first.cursor);
		assert.strictEqual(idle.reset, "none");
		assert.deepStrictEqual(texts(idle), []);
		appendFileSync(path, '3}\n{"d":4}\n');
		const next = read(path, idle.cursor);
		assert.strictEqual(next.reset, "none");
		assert.deepStrictEqual(texts(next), ['{"c":3}', '{"d":4}']);
		assert.strictEqual(next.lines[0]?.offset, first.cursor.end);
	});

	it("restarts from 0 on truncation", () => {
		const path = fresh('{"a":1}\n{"b":2}\n');
		const first = read(path);
		truncateSync(path, 0);
		writeFileSync(path, '{"z":9}\n');
		const next = read(path, first.cursor);
		assert.strictEqual(next.reset, "truncated");
		assert.deepStrictEqual(texts(next), ['{"z":9}']);
	});

	it("restarts from 0 when the path is renamed over by a new file", () => {
		const path = fresh('{"a":1}\n');
		const first = read(path);
		const replacement = join(DIR, `replacement-${counter++}.jsonl`);
		writeFileSync(replacement, '{"a":1}\n{"b":2}\n');
		renameSync(replacement, path);
		const next = read(path, first.cursor);
		assert.strictEqual(next.reset, "replaced");
		assert.deepStrictEqual(texts(next), ['{"a":1}', '{"b":2}']);
	});

	it("restarts from 0 on a same-size rewrite in place", () => {
		const path = fresh('{"a":1}\n');
		const first = read(path);
		writeFileSync(path, '{"q":7}\n');
		// Pin a different mtime: a fast rewrite can land in the same clock tick.
		utimesSync(path, new Date(0), new Date(1_000_000));
		const next = read(path, first.cursor);
		assert.strictEqual(next.reset, "rewritten");
		assert.deepStrictEqual(texts(next), ['{"q":7}']);
	});

	it("restarts from 0 when an in-place rewrite grew the file and moved the line boundary", () => {
		const path = fresh('{"a":1}\n');
		const first = read(path);
		writeFileSync(path, '{"longer":1}\n');
		const next = read(path, first.cursor);
		assert.strictEqual(next.reset, "rewritten");
		assert.deepStrictEqual(texts(next), ['{"longer":1}']);
	});

	it("control: an append keeps the boundary byte, so it reads on with no reset", () => {
		const path = fresh('{"a":1}\n');
		const first = read(path);
		appendFileSync(path, '{"b":2}\n');
		const next = read(path, first.cursor);
		assert.strictEqual(next.reset, "none");
		assert.deepStrictEqual(texts(next), ['{"b":2}']);
	});

	it("a cursor survives a JSON round trip and still reads on", () => {
		const path = fresh('{"a":1}\n');
		const first = read(path);
		const restored = Schema.decodeUnknownSync(JournalCursorSchema)(JSON.parse(JSON.stringify(first.cursor)));
		appendFileSync(path, '{"b":2}\n');
		const next = read(path, restored);
		assert.strictEqual(next.reset, "none");
		assert.deepStrictEqual(texts(next), ['{"b":2}']);
	});

	it("a cursor naming no offset reads from the start", () => {
		const path = fresh('{"a":1}\n');
		const first = read(path);
		for (const end of [-1, 1.5, Number.NaN]) {
			const next = read(path, { ...first.cursor, end });
			assert.strictEqual(next.reset, "initial");
			assert.deepStrictEqual(texts(next), ['{"a":1}']);
		}
	});

	it("offsets past a BOM are logical, matching Line.split of the text after it", () => {
		const body = '{"a":"é"}\r\n{"b":2}\n';
		const path = fresh(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(body)]));
		const first = read(path);
		assert.deepStrictEqual(first.lines, Line.split(body));
		assert.strictEqual(first.cursor.end, Line.byteLength(body));
		appendFileSync(path, '{"c":3}\n');
		const next = read(path, first.cursor);
		assert.strictEqual(next.reset, "none");
		assert.deepStrictEqual(texts(next), ['{"c":3}']);
	});

	it("an empty file reads no lines and a cursor at 0", () => {
		const first = read(fresh());
		assert.deepStrictEqual(texts(first), []);
		assert.strictEqual(first.cursor.end, 0);
	});

	it("fails JournalNotFound for a missing path, and a PlatformError for a directory", () => {
		const missing = JournalFile.readFromResult(join(DIR, "absent.jsonl"));
		assert.isTrue(Result.isFailure(missing));
		assert.strictEqual(Result.isFailure(missing) ? missing.failure._tag : "", "JournalNotFound");
		const directory = join(DIR, `dir-${counter++}`);
		mkdirSync(directory);
		const refused = JournalFile.readFromResult(directory);
		assert.isTrue(Result.isFailure(refused));
		assert.strictEqual(Result.isFailure(refused) ? refused.failure._tag : "", "PlatformError");
	});
});

describe("JournalFile.lastValidResult", () => {
	const last = (path: string, window?: number) => {
		const result = JournalFile.lastValidResult(events, path, window);
		assert.isTrue(Result.isSuccess(result), Result.isFailure(result) ? String(result.failure) : "");
		return Result.isSuccess(result) ? result.success : Option.none();
	};

	it("walks back over a torn tail and foreign lines to the last valid envelope", () => {
		const path = fresh(`${envelope(1)}${envelope(2)}{"foreign":true}\n{"at":"2026`);
		const found = last(path);
		assert.isTrue(Option.isSome(found));
		assert.strictEqual(Option.isSome(found) ? found.value.data.round : -1, 2);
	});

	it("widens past windows that hold no envelope, matching a whole-file walk", () => {
		const noise = '{"foreign":true}\n'.repeat(2_000);
		const text = `${envelope(1)}${envelope(2)}${noise}`;
		const path = fresh(text);
		const found = last(path, 64);
		const whole = Envelope.lastValid(events, text);
		assert.isTrue(Option.isSome(found));
		assert.deepStrictEqual(found, whole);
	});

	// Longer than the 1 MiB window clamp too: a shorter line is reached by widening alone.
	it("reads a line longer than the window, and than the window clamp, whole", () => {
		const big = `${JSON.stringify({ at: "2026-11-21T00:00:00.000Z", event: "state", data: { round: 3, pad: "x".repeat(1_536 * 1024) } })}\n`;
		const text = `${envelope(1)}${big}`;
		const path = fresh(text);
		const found = last(path, 16);
		assert.deepStrictEqual(found, Envelope.lastValid(events, text));
		assert.strictEqual(Option.isSome(found) ? found.value.data.round : -1, 3);
	});

	it("positions match the service's logical offsets past a BOM", () => {
		const text = `${envelope(1)}${envelope(2)}`;
		const path = fresh(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]));
		assert.deepStrictEqual(last(path, 8), Envelope.lastValid(events, text));
	});

	it("is none for a file with no valid envelope, and for an empty one", () => {
		assert.isTrue(Option.isNone(last(fresh('{"foreign":true}\n'.repeat(50)), 32)));
		assert.isTrue(Option.isNone(last(fresh())));
	});

	it("fails JournalNotFound for a missing path", () => {
		const missing = JournalFile.lastValidResult(events, join(DIR, "absent.jsonl"));
		assert.strictEqual(Result.isFailure(missing) ? missing.failure._tag : "", "JournalNotFound");
	});
});
