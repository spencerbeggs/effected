import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option, Stream } from "effect";
import type { TailWindow } from "../src/internal/tail.js";
import { MAX_WINDOW, readLinePages, readTailUntil } from "../src/internal/tail.js";
import { Line } from "../src/Line.js";
import type { MemFs } from "./helpers/memfs.js";
import { makeMemFs } from "./helpers/memfs.js";

const PATH = "/journal/tail.jsonl";
const BOM = "﻿";

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Run `body` against a memfs seeded with `content`, handing it the memfs too. */
const withFile = <A, E>(
	content: string | Uint8Array,
	body: (fs: FileSystem.FileSystem, memfs: MemFs) => Effect.Effect<A, E>,
): Effect.Effect<A, E> => {
	const memfs = makeMemFs();
	memfs.write(PATH, content);
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		return yield* body(fs, memfs);
	}).pipe(Effect.provide(memfs.layer));
};

/** A line as offsets plus text, comparable with `deepStrictEqual`. */
interface Seen {
	readonly offset: number;
	readonly end: number;
	readonly text: string;
	readonly terminated: boolean;
}

const collectLines = (fs: FileSystem.FileSystem, from: number, end: number, bomBytes: number, pageSize: number) =>
	Stream.runCollect(readLinePages(fs, PATH, from, end, bomBytes, pageSize)).pipe(
		Effect.map((pages) =>
			pages.flatMap((page) =>
				Line.split(page.text).map(
					(line): Seen => ({
						offset: line.offset + page.start,
						end: line.end + page.start,
						text: line.text,
						terminated: line.terminated,
					}),
				),
			),
		),
	);

/**
 * The reference answer: split the whole logical text in one go, keep the lines
 * starting at or after the cursor. A cursor INTO a line therefore drops that
 * line whole, which is the contract.
 */
const reference = (logical: string, from: number): ReadonlyArray<Seen> =>
	Line.split(logical)
		.filter((line) => line.offset >= from)
		.map((line) => ({ offset: line.offset, end: line.end, text: line.text, terminated: line.terminated }));

// Multi-byte characters of every UTF-8 width, a blank line, a CRLF line, and an
// unterminated tail: every shape a page boundary can cut through.
const LOGICAL = 'a\n{"é":1}\n\n日本語のテキスト\r\n😀😀\nlast-without-newline';
const LOGICAL_BYTES = encode(LOGICAL).length;

describe("readLinePages", () => {
	for (const bom of [false, true]) {
		it.effect(`matches a whole-text split for every page size and cursor${bom ? " (BOM)" : ""}`, () =>
			withFile(bom ? BOM + LOGICAL : LOGICAL, (fs) =>
				Effect.gen(function* () {
					const bomBytes = bom ? 3 : 0;
					let checked = 0;
					for (let pageSize = 1; pageSize <= LOGICAL_BYTES + 2; pageSize++) {
						for (let from = 0; from <= LOGICAL_BYTES; from++) {
							const got = yield* collectLines(fs, from, LOGICAL_BYTES, bomBytes, pageSize);
							assert.deepStrictEqual(got, reference(LOGICAL, from), `pageSize=${pageSize} from=${from}`);
							checked++;
						}
					}
					assert.isAbove(checked, 1000, "the sweep actually ran");
				}),
			),
		);
	}

	it.effect("never reads past the caller's end, even when the file has grown", () =>
		withFile("one\ntwo\nthree\n", (fs) =>
			Effect.gen(function* () {
				const got = yield* collectLines(fs, 0, 8, 0, 3);
				assert.deepStrictEqual(
					got.map((line) => line.text),
					["one", "two"],
				);
			}),
		),
	);

	it.effect("no single read exceeds a page", () => {
		const content = Array.from({ length: 500 }, (_, index) => `{"n":${index}}\n`).join("");
		return withFile(content, (fs, memfs) =>
			Effect.gen(function* () {
				const got = yield* collectLines(fs, 0, encode(content).length, 0, 64);
				assert.strictEqual(got.length, 500);
				const sizes = memfs.readRequests();
				assert.isAbove(sizes.length, 50, "the region was read in many pages");
				assert.isAtMost(Math.max(...sizes), 64, "no read is bigger than a page");
			}),
		);
	});

	it.effect("a consumer that stops early stops the reading", () => {
		const content = Array.from({ length: 500 }, (_, index) => `{"n":${index}}\n`).join("");
		const size = encode(content).length;
		return withFile(content, (fs, memfs) =>
			Effect.gen(function* () {
				const first = yield* Stream.runCollect(readLinePages(fs, PATH, 0, size, 0, 64).pipe(Stream.take(1)));
				assert.strictEqual(first.length, 1);
				const requested = memfs.readRequests().reduce((sum, bytes) => sum + bytes, 0);
				assert.isAtMost(requested, 128, `one page (plus at most one pre-pulled) was read, not ${size} bytes`);
			}),
		);
	});

	it.effect("a line longer than a page is carried whole across pages", () => {
		const long = "x".repeat(1000);
		const content = `short\n${long}\nafter\n`;
		return withFile(content, (fs) =>
			Effect.gen(function* () {
				const got = yield* collectLines(fs, 0, encode(content).length, 0, 7);
				assert.deepStrictEqual(
					got.map((line) => line.text),
					["short", long, "after"],
				);
			}),
		);
	});
});

/** Answer "the last line of this window that satisfies `keep`", rebased. */
const lastWhere =
	(keep: (text: string) => boolean) =>
	(window: TailWindow): Option.Option<Seen> => {
		const lines = Line.split(window.text);
		for (let index = lines.length - 1; index >= 0; index--) {
			const line = lines[index];
			if (line !== undefined && keep(line.text)) {
				return Option.some({
					offset: line.offset + window.start,
					end: line.end + window.start,
					text: line.text,
					terminated: line.terminated,
				});
			}
		}
		return Option.none();
	};

describe("readTailUntil", () => {
	it.effect("finds a match far behind the tail without any read exceeding MAX_WINDOW", () => {
		const filler = `${"f".repeat(99)}\n`;
		const head = "TARGET\n";
		const content = head + filler.repeat(Math.ceil((3 * MAX_WINDOW) / filler.length));
		return withFile(content, (fs, memfs) =>
			Effect.gen(function* () {
				const found = yield* readTailUntil(
					fs,
					PATH,
					0,
					lastWhere((text) => text === "TARGET"),
				);
				assert.deepStrictEqual(
					Option.map(found, (line) => line.offset),
					Option.some(0),
				);
				assert.isAtMost(Math.max(...memfs.readRequests()), MAX_WINDOW, "the window is clamped");
			}),
		);
	});

	it.effect("clamps an initial window larger than MAX_WINDOW", () => {
		const content = `${"y".repeat(99)}\n`.repeat(Math.ceil((2 * MAX_WINDOW) / 100));
		return withFile(content, (fs, memfs) =>
			Effect.gen(function* () {
				yield* readTailUntil(fs, PATH, 0, () => Option.none<never>(), 8 * MAX_WINDOW);
				assert.isAtMost(Math.max(...memfs.readRequests()), MAX_WINDOW);
			}),
		);
	});

	it.effect("finds a line longer than MAX_WINDOW, with later lines after it, in clamped reads", () => {
		const giant = `GIANT${"g".repeat(MAX_WINDOW + MAX_WINDOW / 2)}`;
		const content = `before\n${giant}\n${"z\n".repeat(100)}`;
		return withFile(content, (fs, memfs) =>
			Effect.gen(function* () {
				const found = yield* readTailUntil(
					fs,
					PATH,
					0,
					lastWhere((text) => text.startsWith("GIANT")),
					16,
				);
				assert.deepStrictEqual(
					Option.map(found, (line) => [line.offset, line.text.length]),
					Option.some([7, giant.length]),
				);
				assert.isAtMost(Math.max(...memfs.readRequests()), MAX_WINDOW, "the line was assembled, not allocated whole");
			}),
		);
	});

	it.effect("walks past a run of lines each longer than the window to the file start", () => {
		const content = `${BOM}first\n${"a".repeat(50)}\n${"b".repeat(50)}\n`;
		return withFile(content, (fs) =>
			Effect.gen(function* () {
				const found = yield* readTailUntil(
					fs,
					PATH,
					3,
					lastWhere((text) => text === "first"),
					8,
				);
				assert.deepStrictEqual(found, Option.some({ offset: 0, end: 6, text: "first", terminated: true }));
				const none = yield* readTailUntil(
					fs,
					PATH,
					3,
					lastWhere((text) => text === "absent"),
					8,
				);
				assert.isTrue(Option.isNone(none), "the search ends at the file start rather than looping");
			}),
		);
	});
});
