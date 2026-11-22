// Synchronous reads of a journal file over `node:fs`, for a consumer with no
// Effect runtime: a hook script, a monitor, a shell-adjacent tool.
//
// Every offset in and out of this module is LOGICAL — past any BOM — the same
// as the service's `LinePosition`, so a cursor taken from one reads on in the
// other. Root types are named through the package's own name, as in
// `NodeJournalWatcher.ts`.

import { Buffer } from "node:buffer";
import * as NFS from "node:fs";
import type * as Jsonl from "@effected/jsonl";
import { Option, PlatformError, Result, Schema } from "effect";
import { Envelope } from "./Envelope.js";
import { JournalNotFound } from "./JsonlError.js";
import { Line } from "./Line.js";

/** UTF-8 BOM, as bytes. */
const BOM = [0xef, 0xbb, 0xbf] as const;
/** Byte value of `\n`. Cannot occur inside a UTF-8 multi-byte sequence. */
const LF = 0x0a;
/** The first tail window, as the service's `latest` starts. */
const DEFAULT_WINDOW = 8192;
/** The largest tail window, as the service clamps. Only one line longer than it is read whole. */
const MAX_WINDOW = 1024 * 1024;
/** How many bytes before a cursor's `end` it keeps, to tell an append from a rewrite that kept the boundary. */
const TAIL_BYTES = 64;
// `ignoreBOM`: a U+FEFF that starts a read is content (a line can begin with one), never stripped. The file's own
// BOM is skipped by starting the read past it.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

/**
 * Where an incremental read of a journal file resumes, and the identity of the
 * file it was taken from.
 *
 * @remarks
 * A plain JSON-round-trippable record: persisting it between runs is the
 * caller's job. `end` is the logical byte offset just past the last complete
 * line read, the same number as a service envelope's `position.end`. `size`
 * is the logical size the read saw, `identity` the file's `dev:ino` and
 * `mtime` its modification time in nanoseconds, both as decimal strings so a
 * 64-bit inode survives JSON exactly. `tail` is the last 64 bytes before
 * `end` (fewer when `end` is smaller), base64: a resume whose bytes there
 * differ was rewritten, not appended to.
 *
 * @public
 */
export const JournalCursor = Schema.Struct({
	/** Logical byte offset just past the last complete line read: where the next read starts. */
	end: Schema.Number,
	/** The logical size of the file when the cursor was taken. */
	size: Schema.Number,
	/** The file's `dev:ino`, in decimal. */
	identity: Schema.String,
	/** The file's modification time in nanoseconds, in decimal. */
	mtime: Schema.String,
	/** The last bytes before `end`, base64. */
	tail: Schema.String,
});

/**
 * Where an incremental read of a journal file resumes.
 *
 * @public
 */
export type JournalCursor = typeof JournalCursor.Type;

/**
 * Why a read started where it did.
 *
 * @remarks
 * - `initial` — no cursor, or one that names no offset in this file (not a
 *   non-negative integer): read from the start.
 * - `none` — read on from the cursor's `end`.
 * - `truncated` — the file is smaller than when the cursor was taken: read
 *   from the start.
 * - `replaced` — the path names a different file (a new inode, a rename over
 *   it): read from the start.
 * - `rewritten` — the same file was rewritten in place: its size is unchanged
 *   but its modification time moved, or the last 64 bytes before `end` are not
 *   the ones the cursor saw. Read from the start. A `touch` of an unchanged
 *   file also reads as `rewritten`, so lines already seen are returned again.
 *   A rewrite that grows the file and leaves those 64 bytes as they were is
 *   not seen: the check reads only the bytes at the cursor, never the whole
 *   prefix.
 *
 * On any reset other than `none`, `lines` starts at offset 0: discard what
 * earlier reads built before applying them, or they are applied twice.
 *
 * An append-only journal only ever reads `initial` once, then `none`. Every
 * other reset means the writer broke the cooperative-writer contract, which
 * the service reports as `JournalResync`; here the caller decides.
 *
 * @public
 */
export type JournalReset = "initial" | "none" | "truncated" | "replaced" | "rewritten";

/**
 * What {@link JournalFile.readFromResult} read.
 *
 * @public
 */
export interface JournalRead {
	/**
	 * Every complete line from where the read started up to the last `\n`, in
	 * file order, offsets logical. A torn final line is held back: it is read
	 * again, whole, once its terminator lands.
	 */
	readonly lines: ReadonlyArray<Jsonl.LineSlice>;
	/** Where the next read resumes. */
	readonly cursor: JournalCursor;
	/** Why the read started where it did. */
	readonly reset: JournalReset;
}

/**
 * Why a journal file could not be read: the path names nothing, or the
 * filesystem refused, untranslated.
 *
 * @public
 */
export type JournalFileError = Jsonl.JournalNotFound | PlatformError.PlatformError;

/** The `SystemErrorTag` an errno code maps to, after core's Node filesystem mapping. */
const reasonOf = (code: unknown): PlatformError.SystemErrorTag => {
	switch (code) {
		case "ENOENT":
			return "NotFound";
		case "EACCES":
		case "EPERM":
			return "PermissionDenied";
		case "EISDIR":
		case "ENOTDIR":
		case "ELOOP":
			return "BadResource";
		default:
			return "Unknown";
	}
};

/** A thrown `node:fs` error as the result it becomes: `JournalNotFound` for a missing path. */
const failure = (path: string, method: string, cause: unknown): Result.Result<never, JournalFileError> => {
	const code = (cause as { readonly code?: unknown } | null)?.code;
	if (code === "ENOENT") return Result.fail(new JournalNotFound({ path }));
	return Result.fail(
		PlatformError.systemError({
			_tag: reasonOf(code),
			module: "FileSystem",
			method,
			pathOrDescriptor: path,
			syscall: method,
			cause,
		}),
	);
};

/** Physical bytes `[from, to)` of an open file, read whole. */
const readAt = (fd: number, from: number, to: number): Uint8Array => {
	const bytes = new Uint8Array(Math.max(0, to - from));
	let filled = 0;
	while (filled < bytes.length) {
		const read = NFS.readSync(fd, bytes, filled, bytes.length - filled, from + filled);
		if (read === 0) return bytes.subarray(0, filled);
		filled += read;
	}
	return bytes;
};

/** Bytes of leading BOM in a file of physical `size`. */
const bomBytes = (fd: number, size: number): number => {
	if (size < BOM.length) return 0;
	const head = readAt(fd, 0, BOM.length);
	return head[0] === BOM[0] && head[1] === BOM[1] && head[2] === BOM[2] ? BOM.length : 0;
};

/** Open `path`, run `body` over it, and close it, with every `node:fs` throw as a typed failure. */
const withFile = <A>(
	path: string,
	method: string,
	body: (fd: number, info: NFS.BigIntStats) => A,
): Result.Result<A, JournalFileError> => {
	let fd: number;
	try {
		fd = NFS.openSync(path, "r");
	} catch (cause) {
		return failure(path, "open", cause);
	}
	try {
		return Result.succeed(body(fd, NFS.fstatSync(fd, { bigint: true })));
	} catch (cause) {
		return failure(path, method, cause);
	} finally {
		NFS.closeSync(fd);
	}
};

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

/** Where a read with `cursor` starts in a file now at logical `size`, and why. */
const startOf = (
	size: number,
	identity: string,
	mtime: string,
	cursor: JournalCursor | undefined,
): { readonly from: number; readonly reset: JournalReset } => {
	if (cursor === undefined || !Number.isSafeInteger(cursor.end) || cursor.end < 0) {
		return { from: 0, reset: "initial" };
	}
	if (cursor.identity !== identity) return { from: 0, reset: "replaced" };
	if (size < cursor.size || size < cursor.end) return { from: 0, reset: "truncated" };
	if (size === cursor.size && mtime !== cursor.mtime) return { from: 0, reset: "rewritten" };
	return { from: cursor.end, reset: "none" };
};

/** A decoded tail window: its text from a line boundary, and that boundary's logical offset. */
interface TailWindow {
	readonly text: string;
	readonly start: number;
	readonly atFileStart: boolean;
}

/**
 * The window of at most {@link MAX_WINDOW} bytes ending at physical `end`,
 * decoded from a line boundary: the leading partial line is dropped through
 * the first `\n`. A window with no boundary inside it holds part of one line
 * longer than the window, which is read whole instead. The same reads as the
 * service's `readWindow` and `readLineEnding`.
 */
const tailWindow = (fd: number, end: number, window: number, bom: number): TailWindow => {
	const from = Math.max(bom, end - Math.min(window, MAX_WINDOW));
	const bytes = readAt(fd, from, end);
	if (from === bom) return { text: decoder.decode(bytes), start: 0, atFileStart: true };
	const newline = bytes.indexOf(LF);
	const cut = newline === -1 ? bytes.length : newline + 1;
	if (cut < bytes.length) {
		return { text: decoder.decode(bytes.subarray(cut)), start: from + cut - bom, atFileStart: false };
	}
	return lineEnding(fd, end, bom);
};

/** The one line that ends at physical `end`, however long, read back in clamped steps to the `\n` before it. */
const lineEnding = (fd: number, end: number, bom: number): TailWindow => {
	const chunks: Array<Uint8Array> = [];
	let position = end;
	for (;;) {
		const from = Math.max(bom, position - MAX_WINDOW);
		const bytes = readAt(fd, from, position);
		// The byte at `end - 1` is the line's own terminator; the search starts before it.
		const searchFrom = position === end ? bytes.length - 2 : bytes.length - 1;
		const newline = searchFrom < 0 ? -1 : bytes.lastIndexOf(LF, searchFrom);
		if (newline !== -1) {
			chunks.unshift(bytes.subarray(newline + 1));
			return { text: decoder.decode(join(chunks)), start: from + newline + 1 - bom, atFileStart: false };
		}
		chunks.unshift(bytes);
		if (from === bom) return { text: decoder.decode(join(chunks)), start: 0, atFileStart: true };
		position = from;
	}
};

const join = (chunks: ReadonlyArray<Uint8Array>): Uint8Array => {
	const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.length;
	}
	return out;
};

/**
 * Synchronous reads of a journal file over `node:fs`, for a consumer with no
 * Effect runtime.
 *
 * @remarks
 * Nothing here builds an `Effect` or needs a layer, and nothing throws: a
 * missing path fails `JournalNotFound`, any other filesystem refusal a core
 * `PlatformError`, both in a `Result`. Offsets are logical bytes, past any
 * BOM, exactly as the `Journal` service reports them, so a cursor from either
 * side reads on in the other.
 *
 * @example
 * ```ts
 * import type { JournalCursor } from "@effected/jsonl/node";
 * import { JournalFile } from "@effected/jsonl/node";
 * import { Result } from "effect";
 *
 * declare const saved: JournalCursor | undefined;
 *
 * const read = JournalFile.readFromResult(".claude/dogfood/mailbox.jsonl", saved);
 * if (Result.isSuccess(read)) {
 *   // Any reset reads from 0: drop what earlier reads built, or it is applied twice.
 *   if (read.success.reset !== "none") {
 *     // reset the state you derived from earlier lines
 *   }
 *   for (const line of read.success.lines) line.text; // each complete line, in order
 *   read.success.cursor; // persist it for the next run
 * }
 * ```
 *
 * @public
 */
export class JournalFile {
	private constructor() {}

	/**
	 * Read the lines appended to `path` since `cursor`.
	 *
	 * @remarks
	 * Reads the bytes from the cursor's `end` to the file's current size and
	 * returns every complete line among them; an unterminated final line is held
	 * back and read again, whole, once its `\n` lands. Without a cursor, or when
	 * the file was truncated, replaced or rewritten since the cursor was taken
	 * (see {@link JournalReset}), it reads from the start, and `reset` says why.
	 * The read is one buffer from the start offset to the end of the file, so a
	 * first read of a large journal costs its size; every read after that costs
	 * only what was appended.
	 *
	 * Line offsets are byte-exact for UTF-8 text. A byte sequence that is not
	 * UTF-8 decodes as U+FFFD, and the offsets of the lines after it in the same
	 * read drift; the cursor's `end` never does.
	 *
	 * @param path - The journal file.
	 * @param cursor - The cursor the previous read returned, if any.
	 * @returns What was read, or `JournalNotFound` when `path` names nothing,
	 *   or the `PlatformError` the filesystem raised.
	 */
	static readFromResult(path: string, cursor?: JournalCursor): Result.Result<JournalRead, JournalFileError> {
		return withFile(path, "read", (fd, info) => {
			const physical = Number(info.size);
			const bom = bomBytes(fd, physical);
			const size = physical - bom;
			const identity = `${info.dev}:${info.ino}`;
			const mtime = `${info.mtimeNs}`;
			const start = startOf(size, identity, mtime, cursor);
			let { from, reset } = start;
			// One read serves the resume check, the lines and the new cursor's tail: it reaches back up to TAIL_BYTES
			// before `from`, which on a resume are exactly the bytes the cursor kept, so the check and the lines can
			// never describe different bytes when a writer rewrites the file between reads.
			let back = Math.min(from, TAIL_BYTES);
			let buffer = readAt(fd, bom + from - back, physical);
			if (reset === "none" && cursor !== undefined && toBase64(buffer.subarray(0, back)) !== cursor.tail) {
				// The content under the cursor moved: read again from the start.
				from = 0;
				reset = "rewritten";
				back = 0;
				buffer = readAt(fd, bom, physical);
			}
			const bytes = buffer.subarray(back);
			const complete = bytes.lastIndexOf(LF) + 1;
			const lines = complete === 0 ? [] : Line.split(decoder.decode(bytes.subarray(0, complete)), from);
			const end = from + complete;
			const tailEnd = back + complete;
			const tail = toBase64(buffer.subarray(Math.max(0, tailEnd - TAIL_BYTES), tailEnd));
			return { lines, cursor: { end, size, identity, mtime, tail }, reset };
		});
	}

	/**
	 * The last valid envelope in `path`: the journal's current state, read the
	 * way the service's `latest` reads it.
	 *
	 * @remarks
	 * Steps back from the end one window at a time, each window covering only
	 * bytes no earlier one did, growing from `window` by fours up to 1 MiB, and
	 * stops at the first window holding a valid envelope. A line longer than
	 * the window is read whole. So the cost tracks the answer, not the age of
	 * the journal, and `Option.none()` means the whole file holds no valid
	 * envelope.
	 *
	 * @param events - The registry the writer declared.
	 * @param path - The journal file.
	 * @param window - The first window's size in bytes. Defaults to 8 KiB.
	 * @returns The last valid envelope, `Option.none()` if there is none, or
	 *   `JournalNotFound` / the `PlatformError` the filesystem raised.
	 */
	static lastValidResult<const R extends Jsonl.JsonlEvent.Registry>(
		events: R,
		path: string,
		window: number = DEFAULT_WINDOW,
	): Result.Result<Option.Option<Jsonl.EnvelopeUnion<R>>, JournalFileError> {
		return withFile(path, "read", (fd, info) => {
			const physical = Number(info.size);
			const bom = bomBytes(fd, physical);
			let end = physical;
			let size = Number.isFinite(window) ? Math.max(1, Math.floor(window)) : DEFAULT_WINDOW;
			while (end > bom) {
				const tail = tailWindow(fd, end, size, bom);
				const found = Envelope.lastValid(events, tail.text, tail.start);
				if (Option.isSome(found) || tail.atFileStart) return found;
				// Every window ends where the last one began; one that did not move would read it again forever.
				if (tail.start + bom >= end) return Option.none();
				end = tail.start + bom;
				size = Math.min(size * 4, MAX_WINDOW);
			}
			return Option.none();
		});
	}
}
