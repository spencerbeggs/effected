import { PassThrough, Writable } from "node:stream";
import type { UiStreamsShape } from "../UiStreams.js";

/**
 * Options for {@link makeFakeStreams}.
 *
 * @internal
 */
export interface FakeStreamsOptions {
	/** The terminal width; 80 by default. */
	readonly columns?: number;
	/** The terminal height; 24 by default. */
	readonly rows?: number;
	/** Called with each chunk written to stdout, as it is written. */
	readonly onStdoutWrite?: (chunk: string) => void;
}

/**
 * In-memory terminal streams a screen mounts on.
 *
 * @internal
 */
export interface FakeStreams {
	/** The streams, to provide as `UiStreams`. */
	readonly streams: UiStreamsShape;
	/** Every `setRawMode` call, in order. */
	readonly rawModes: ReadonlyArray<boolean>;
	/** Everything written to stdout so far. */
	readonly stdout: () => string;
	/** Everything written to stderr so far. */
	readonly stderr: () => string;
	/** Everything written to stdout and stderr so far, in the order it was written: what one terminal shows. */
	readonly written: () => string;
	/** Feed raw bytes to stdin, as a terminal in raw mode would deliver a key. */
	readonly input: (data: string) => void;
	/** Resize the terminal: set both outputs' size and emit `resize` on stdout, as a terminal does. */
	readonly resize: (columns: number, rows: number) => void;
}

/** The listener list of `signal-exit` 3's process-wide emitter, which is all of it this reads. */
interface SignalExitEmitter {
	readonly listeners: (event: string) => ReadonlyArray<(...args: ReadonlyArray<unknown>) => void>;
	readonly removeListener: (event: string, listener: (...args: ReadonlyArray<unknown>) => void) => unknown;
}

/** The hide-cursor escape `cli-cursor` writes to a TTY stream as it arms the restore. */
const HIDE_CURSOR = `${String.fromCharCode(0x1b)}[?25l`;

/** A cursor-show escape in a listener's source, as `restore-cursor` writes it (`'\u001B[?25h'`) or as the raw byte. */
const CURSOR_SHOW = /\[\?25h/;

/**
 * Disarm the real terminal's cursor restore that a fake TTY arms, so no byte of a run on the fakes reaches the
 * process's own streams (#983). The fake streams call it as the hide escape is written to them.
 *
 * @remarks
 * Ink's frame writer hides the cursor through `cli-cursor` on its first render, and `cli-cursor` does it only for a
 * stream that says it is a TTY, which the fakes do. Hiding it also arms `restore-cursor`, once per loaded copy of it
 * (once per test file where the runner isolates modules): a `signal-exit` hook (`alwaysLast`, so on the `afterexit`
 * event) that writes the cursor-show escape to the REAL `process.stderr` when the process exits or is signalled,
 * whatever stream Ink was given and whether or not stderr is a terminal. Nothing on the fakes hid the real cursor, so
 * that restore is only ever a stray byte in the test runner's output: this removes every `afterexit` listener that
 * writes a cursor-show escape, right after the copy that armed it wrote its hide escape. The emitter is `signal-exit` 3's process-wide one, the version `restore-cursor` 4
 * (the one Ink 8's `cli-cursor` takes) loads; without one there is nothing to disarm.
 *
 * The one read of `process` in the testing fakes, under the process-streams licence: it touches no stream.
 */
const disarmCursorRestore = (): void => {
	const emitter = (process as unknown as { readonly __signal_exit_emitter__?: SignalExitEmitter })
		.__signal_exit_emitter__;
	if (emitter === undefined) return;
	for (const listener of emitter.listeners("afterexit")) {
		if (CURSOR_SHOW.test(String(listener))) emitter.removeListener("afterexit", listener);
	}
};

const capture = (
	columns: number,
	rows: number,
	both: Array<string>,
	onWrite?: (chunk: string) => void,
): { readonly stream: Writable; readonly text: () => string } => {
	const chunks: Array<string> = [];
	const stream = new Writable({
		write(chunk: Buffer | string, _encoding, callback) {
			const text = chunk.toString();
			// `cli-cursor` arms the real terminal's cursor restore just before it writes the hide escape here.
			if (text.includes(HIDE_CURSOR)) disarmCursorRestore();
			chunks.push(text);
			both.push(text);
			onWrite?.(text);
			callback();
		},
	});
	Object.assign(stream, { isTTY: true, columns, rows });
	return { stream, text: () => chunks.join("") };
};

/**
 * Make in-memory stdin, stdout and stderr that satisfy Ink's stream contract: TTYs with a size, a recorded
 * `setRawMode`, `ref` and `unref`, and captured writes.
 *
 * @remarks
 * The third file licensed to touch Node, testing only: Ink's stream
 * contract is Node's, so the fakes are `node:stream` streams rather than a hand-rolled emitter that would have to
 * reproduce `readable`, `read()`, `setEncoding` and the write-callback barrier Ink waits on at unmount.
 *
 * @internal
 */
export const makeFakeStreams = (options: FakeStreamsOptions = {}): FakeStreams => {
	const columns = options.columns ?? 80;
	const rows = options.rows ?? 24;
	const rawModes: Array<boolean> = [];
	const stdin = new PassThrough();
	Object.assign(stdin, {
		isTTY: true,
		setRawMode: (mode: boolean) => {
			rawModes.push(mode);
			return stdin;
		},
		ref: () => stdin,
		unref: () => stdin,
	});
	const both: Array<string> = [];
	const stdout = capture(columns, rows, both, options.onStdoutWrite);
	const stderr = capture(columns, rows, both);
	return {
		// The fakes carry every member Ink reads; Node's tty stream types also demand a file descriptor they cannot have.
		streams: {
			stdin: stdin as unknown as NodeJS.ReadStream,
			stdout: stdout.stream as unknown as NodeJS.WriteStream,
			stderr: stderr.stream as unknown as NodeJS.WriteStream,
		},
		rawModes,
		stdout: stdout.text,
		stderr: stderr.text,
		written: () => both.join(""),
		input: (data) => {
			stdin.write(data);
		},
		resize: (nextColumns, nextRows) => {
			Object.assign(stdout.stream, { columns: nextColumns, rows: nextRows });
			Object.assign(stderr.stream, { columns: nextColumns, rows: nextRows });
			stdout.stream.emit("resize");
		},
	};
};
