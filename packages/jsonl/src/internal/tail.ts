// The bounded reads.
//
// Backward: `readTailUntil` answers "what is the current state" by stepping
// back from the end one window at a time, so the cost tracks the answer, not
// the age of the journal. Forward: `readLinePages` reads a region in fixed
// pages, emitting each page's complete lines and carrying the unterminated
// fragment into the next, so memory tracks the page, not the region.
//
// Every single read here is bounded — a tail window is clamped to `MAX_WINDOW`,
// a forward read takes at most a page — so no path allocates the file. The one
// thing allowed past a bound is a single LINE longer than it, because decoding
// a line needs all of it.
//
// Every offset in and out of this module is LOGICAL — post-BOM — except where a
// name says physical.

import type { FileSystem, PlatformError } from "effect";
import { ByteSize, Effect, Option, Stream } from "effect";

/** UTF-8 BOM, as bytes. `U+FEFF` encodes to these three. */
const BOM = [0xef, 0xbb, 0xbf] as const;

/** Byte value of `\n`. Cannot occur inside a UTF-8 multi-byte sequence. */
const LF = 0x0a;

/**
 * The first tail window. Large enough that a snapshot journal's last line is
 * almost always inside it, small enough to be cheap against a journal of any
 * age.
 *
 * @internal
 */
export const DEFAULT_WINDOW = 8192;

/**
 * The largest window a single tail read allocates.
 *
 * A regression fence: the historical read once sized a "tail" window to its
 * whole region. A caller needing more than this pages for it.
 *
 * @internal
 */
export const MAX_WINDOW = 1024 * 1024;

/**
 * The forward page size of {@link readLinePages}.
 *
 * @internal
 */
export const PAGE_SIZE = 64 * 1024;

/**
 * A decoded tail window.
 *
 * @internal
 */
export interface TailWindow {
	/** The decoded text, starting at a line boundary. */
	readonly text: string;
	/** The logical offset `text` starts at. */
	readonly start: number;
	/** Whether the window reaches the start of the content — nothing earlier remains. */
	readonly atFileStart: boolean;
}

/**
 * One forward page of {@link readLinePages}: complete lines, decoded.
 *
 * @internal
 */
export interface LinePage {
	/** Whole `\n`-terminated lines, except that the last page may end in the region's unterminated fragment. */
	readonly text: string;
	/** The logical offset `text` starts at. */
	readonly start: number;
}

const EMPTY: Uint8Array = new Uint8Array(0);

const decoder = new TextDecoder();

/** Join byte chunks with one allocation. */
const join = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
	if (chunks.length === 1) return chunks[0] as Uint8Array;
	let length = 0;
	for (const chunk of chunks) length += chunk.length;
	const joined = new Uint8Array(length);
	let at = 0;
	for (const chunk of chunks) {
		joined.set(chunk, at);
		at += chunk.length;
	}
	return joined;
};

/** Read `[from, to)` (physical) from an open handle. */
const readAt = (
	file: FileSystem.File,
	from: number,
	to: number,
): Effect.Effect<Uint8Array, PlatformError.PlatformError> =>
	Effect.gen(function* () {
		yield* file.seek(BigInt(from), "start");
		return Option.getOrElse(yield* file.readAlloc(to - from), () => EMPTY);
	});

/**
 * Probe the first three bytes of a file for a BOM.
 *
 * A property of the FILE, read once from the start — never inferred from a
 * window's position, which for a journal larger than the window never reaches
 * offset 0.
 *
 * @internal
 */
export const probeBomBytes = (
	fs: FileSystem.FileSystem,
	path: string,
): Effect.Effect<number, PlatformError.PlatformError> =>
	Effect.gen(function* () {
		const file = yield* fs.open(path, { flag: "r" });
		const head = yield* readAt(file, 0, BOM.length);
		return head.length >= 3 && head[0] === BOM[0] && head[1] === BOM[1] && head[2] === BOM[2] ? BOM.length : 0;
	}).pipe(Effect.scoped);

/**
 * Read the window of at most {@link MAX_WINDOW} bytes ending at physical `end`,
 * decoded from a line boundary.
 *
 * Unless the window reaches the start of the content, its leading partial line
 * is discarded — through the first `\n`, which cannot occur inside a UTF-8
 * multi-byte sequence, so the decode starts on a character boundary too. A BOM
 * is excluded by starting the read past it, never by an implicit strip.
 */
const readWindow = (
	file: FileSystem.File,
	end: number,
	window: number,
	bomBytes: number,
): Effect.Effect<TailWindow, PlatformError.PlatformError> =>
	Effect.gen(function* () {
		// The clamp is the fence: no caller can turn a tail read into a file read.
		const from = Math.max(bomBytes, end - Math.min(window, MAX_WINDOW));
		const bytes = yield* readAt(file, from, end);
		const atFileStart = from === bomBytes;
		let cursor = 0;
		if (!atFileStart) {
			const newline = bytes.indexOf(LF);
			cursor = newline === -1 ? bytes.length : newline + 1;
		}
		return { text: decoder.decode(bytes.subarray(cursor)), start: from + cursor - bomBytes, atFileStart };
	});

/**
 * Read the one line that ends at physical `end`, however long it is, in
 * clamped steps backward to the newline before it.
 *
 * The escape hatch for a window with no line boundary inside it: the line is
 * longer than the window, and the clamp forbids asking for a bigger one.
 */
const readLineEnding = (
	file: FileSystem.File,
	end: number,
	bomBytes: number,
): Effect.Effect<TailWindow, PlatformError.PlatformError> =>
	Effect.gen(function* () {
		const chunks: Array<Uint8Array> = [];
		let position = end;
		for (;;) {
			const from = Math.max(bomBytes, position - MAX_WINDOW);
			const bytes = yield* readAt(file, from, position);
			// The byte at `end - 1` is the line's OWN terminator whenever `end` is a
			// line boundary; finding it would yield an empty line ending where the
			// search began, and the caller would never move. A negative `fromIndex`
			// counts from the end, so an exhausted search is spelled out.
			const searchFrom = position === end ? bytes.length - 2 : bytes.length - 1;
			const newline = searchFrom < 0 ? -1 : bytes.lastIndexOf(LF, searchFrom);
			if (newline !== -1) {
				chunks.unshift(bytes.subarray(newline + 1));
				return { text: decoder.decode(join(chunks)), start: from + newline + 1 - bomBytes, atFileStart: false };
			}
			chunks.unshift(bytes);
			if (from === bomBytes) {
				return { text: decoder.decode(join(chunks)), start: 0, atFileStart: true };
			}
			position = from;
		}
	});

/**
 * Search backward from the end of the journal, one window at a time, until
 * `decode` finds something or the whole file has been seen.
 *
 * Each window covers only bytes no earlier one did — it ends at the line
 * boundary where the previous one began — and the windows grow from
 * `initialWindow` by fours up to {@link MAX_WINDOW}. `decode` sees each window
 * on its own: "the last match in this window" is the last match in the file
 * only because every later window has already answered none.
 *
 * @internal
 */
export const readTailUntil = <A>(
	fs: FileSystem.FileSystem,
	path: string,
	bomBytes: number,
	decode: (window: TailWindow) => Option.Option<A>,
	initialWindow = DEFAULT_WINDOW,
): Effect.Effect<Option.Option<A>, PlatformError.PlatformError> =>
	Effect.gen(function* () {
		const file = yield* fs.open(path, { flag: "r" });
		// One size, sampled once: a line appended mid-search cannot shift the
		// windows under it.
		let end = ByteSize.toNumberUnsafe((yield* file.stat).size);
		// Not clamped here: `readWindow` is the one fence every tail read passes
		// through, so it is the one that has to hold.
		let window = initialWindow;
		for (;;) {
			let tail = yield* readWindow(file, end, window, bomBytes);
			if (tail.text === "" && !tail.atFileStart && tail.start + bomBytes === end) {
				// No line boundary in the window: one line is longer than it.
				tail = yield* readLineEnding(file, end, bomBytes);
			}
			const found = decode(tail);
			if (Option.isSome(found) || tail.atFileStart) {
				return found;
			}
			end = tail.start + bomBytes;
			window = Math.min(window * 4, MAX_WINDOW);
		}
	}).pipe(Effect.scoped);

/** Where a forward page read stands between pulls. */
interface PageState {
	/** The next physical byte to read. */
	readonly position: number;
	/** Bytes read but not yet emitted: the start of a line no page has completed. */
	readonly carry: ReadonlyArray<Uint8Array>;
	/** The logical offset `carry` starts at. */
	readonly carryStart: number;
	/** Still discarding the partial line a mid-line `from` points into. */
	readonly skipping: boolean;
}

/**
 * Read the logical region `[from, end)` forward, in pages, as complete lines.
 *
 * Each pull reads at most `pageSize` bytes, emits every line that page
 * completes, and carries the trailing unterminated fragment into the next pull
 * — so a consumer that stops early never pays for the rest, and memory is a
 * page plus the longest line. Pages are cut at `\n`, so each decodes on its
 * own: a character a raw read split in two is still whole in the carry by the
 * time its line is emitted.
 *
 * `from` is a line cursor: at a line boundary it is exactly where reading
 * starts; pointing INTO a line, the straddled line is skipped whole. That is why
 * reading starts one byte early — a `from` at a line start hands the skip rule
 * the previous line's terminator and consumes exactly that byte. Whatever
 * remains at `end` without a terminator is emitted last.
 *
 * `end` is the caller's bound, sampled once: bytes appended past it are never
 * read. A file that shrinks underneath ends the stream at what was readable.
 *
 * @internal
 */
export const readLinePages = (
	fs: FileSystem.FileSystem,
	path: string,
	from: number,
	end: number,
	bomBytes: number,
	pageSize = PAGE_SIZE,
): Stream.Stream<LinePage, PlatformError.PlatformError> =>
	Stream.unwrap(
		Effect.gen(function* () {
			if (from >= end) {
				return Stream.empty;
			}
			// Held for the stream's lifetime: `Stream.unwrap` gives this effect the
			// stream's own scope, so the handle closes when the stream does.
			const file = yield* fs.open(path, { flag: "r" });
			const stop = end + bomBytes;
			const flush = (state: PageState): ReadonlyArray<LinePage> =>
				state.skipping || state.carry.length === 0
					? []
					: [{ text: decoder.decode(join(state.carry)), start: state.carryStart }];
			return Stream.paginate(
				{
					position: from === 0 ? bomBytes : from + bomBytes - 1,
					carry: [],
					carryStart: from,
					skipping: from > 0,
				} satisfies PageState,
				(
					state,
				): Effect.Effect<readonly [ReadonlyArray<LinePage>, Option.Option<PageState>], PlatformError.PlatformError> =>
					Effect.gen(function* () {
						const bytes =
							state.position >= stop
								? EMPTY
								: yield* readAt(file, state.position, Math.min(state.position + pageSize, stop));
						if (bytes.length === 0) {
							// The region is done — or the file shrank under the read.
							return [flush(state), Option.none()] as const;
						}
						const position = state.position + bytes.length;
						let fresh = bytes;
						let carryStart = state.carryStart;
						if (state.skipping) {
							const newline = bytes.indexOf(LF);
							if (newline === -1) {
								// Still inside the straddled line; nothing here is ours.
								return [[], Option.some({ ...state, position })] as const;
							}
							fresh = bytes.subarray(newline + 1);
							carryStart = state.position + newline + 1 - bomBytes;
						}
						// Search only the fresh bytes: the carry is known to hold no `\n`,
						// so a line spanning many pages costs one scan per page, not one
						// scan of everything carried so far.
						const last = fresh.lastIndexOf(LF);
						if (last === -1) {
							const carry = fresh.length === 0 ? state.carry : [...state.carry, fresh];
							return [[], Option.some({ position, carry, carryStart, skipping: false })] as const;
						}
						const page: LinePage = {
							text: decoder.decode(join([...state.carry, fresh.subarray(0, last + 1)])),
							start: carryStart,
						};
						let carryLength = 0;
						for (const chunk of state.carry) carryLength += chunk.length;
						// `slice`, not `subarray`: the carry must not pin the page's buffer.
						const rest = fresh.slice(last + 1);
						return [
							[page],
							Option.some({
								position,
								carry: rest.length === 0 ? [] : [rest],
								carryStart: carryStart + carryLength + last + 1,
								skipping: false,
							}),
						] as const;
					}),
			);
		}),
	);
