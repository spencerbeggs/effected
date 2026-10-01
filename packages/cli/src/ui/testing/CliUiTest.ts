// Root and ./ui types are named through the package's own name, so the emitted ui-testing.d.ts imports them rather
// than carrying copies a consumer's own layers and screens could not satisfy.
import type * as Cli from "@effected/cli";
import type { KeyName, Screen, ScreenControl } from "@effected/cli/ui";
import type { ColorLevel } from "@effected/env";
import { TerminalEnv } from "@effected/env";
import type { Scope } from "effect";
import { Effect, Fiber, Layer, Option } from "effect";
import type { ReactElement } from "react";
import { CliInteractive } from "../../CliInteractive.js";
import { CliTheme } from "../../CliTheme.js";
import type { Style, TokenName } from "../../Token.js";
import { CliUi } from "../CliUi.js";
import { holder } from "../internal/Holder.js";
import { inkModules } from "../internal/ink.js";
import { UiRenderOptions } from "../internal/renderOptions.js";
import { UiStreams } from "../UiStreams.js";
import { makeFakeStreams } from "./fakeStreams.js";

/**
 * Options for {@link CliUiTest.render}.
 *
 * @public
 */
export interface CliUiTestOptions {
	/** The terminal width the screen lays out at; 80 by default. */
	readonly columns?: number;
	/** The terminal height; 24 by default. */
	readonly rows?: number;
	/**
	 * The colour level of both streams; `"truecolor"` by default, so frames carry the marker palette that
	 * {@link CliUiTest.styled} decodes to token markup. `"none"` gives escape-free frames.
	 *
	 * @remarks
	 * Only truecolor keeps tokens apart. Below it, chalk maps every marker `#0000NN` to the same colour
	 * (`ansi256(16)` at `"256"`, black at `"basic"`), so token identity is lost; do not snapshot tokens from such a run.
	 */
	readonly color?: ColorLevel;
	/** The glyph set; Unicode by default. */
	readonly glyphs?: "unicode" | "ascii";
	/** Whether the run is interactive; `true` by default. `false` makes the screen fail with `NotInteractive`. */
	readonly interactive?: boolean;
}

/**
 * A mounted screen under test: drive it with keys and read its frames.
 *
 * @public
 */
export interface CliUiTestHandle<A> {
	/**
	 * Press named keys, one after another. Each waits until the screen draws its next frame or 50 ms pass with
	 * nothing written; `"escape"` first waits a real 30 ms, because Ink holds a lone ESC for 20 ms before reporting
	 * it.
	 */
	readonly press: (...keys: ReadonlyArray<KeyName>) => Effect.Effect<void>;
	/** Type text, one character at a time, each settling like a key. */
	readonly type: (text: string) => Effect.Effect<void>;
	/** Resize the terminal and emit `resize`, as a real one does, settling like a key. */
	readonly resize: (columns: number, rows: number) => Effect.Effect<void>;
	/**
	 * Show another screen in place of the current one, settling like a key.
	 *
	 * @remarks
	 * `screen` is called with the same `ScreenControl` the first screen got, so `result` still resolves through it,
	 * and only the screen's own subtree is swapped: the error boundary, root keys and colour hold stay mounted. Ink's
	 * own `rerender` is never used. A rerender after the screen has ended is a defect, not a no-op, because a test
	 * that does it has lost track of the screen; so is one on a screen that has not mounted within 2 s, such as a
	 * handle queued behind another mounted screen.
	 */
	readonly rerender: (screen: Screen<A>) => Effect.Effect<void>;
	/** The latest frame as token markup ({@link CliUiTest.styled}), each line's trailing spaces trimmed. */
	readonly frame: Effect.Effect<string>;
	/** The latest frame as Ink wrote it, escapes included. */
	readonly rawFrame: Effect.Effect<string>;
	/** The latest frame as plain text: no escapes and no markup, each line's trailing spaces trimmed. */
	readonly plainFrame: Effect.Effect<string>;
	/** Every frame so far, oldest first, as token markup like {@link CliUiTestHandle.frame}. */
	readonly frames: Effect.Effect<ReadonlyArray<string>>;
	/** How the screen ended: its value, or `Cancelled` or `NotInteractive`. Waits for it to end. */
	readonly result: Effect.Effect<A, Cli.Cancelled | Cli.NotInteractive>;
}

/** The tokens, in the order their marker colours are numbered. */
const TOKENS: ReadonlyArray<TokenName> = [
	"success",
	"failure",
	"warning",
	"info",
	"error",
	"muted",
	"accent",
	"emphasis",
];

/** The marker palette: token N (1-based) paints in `#0000NN`, so a frame decodes back to the token. */
const MARKER_STYLES: Record<TokenName, Style> = Object.fromEntries(
	TOKENS.map((token, index) => [token, { fg: `#0000${(index + 1).toString(16).padStart(2, "0")}` }]),
) as Record<TokenName, Style>;

const TOKEN_BY_BLUE = new Map(TOKENS.map((token, index) => [index + 1, token] as const));

const NAMED = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;

/** The bytes a terminal in raw mode sends for each named key, as Ink's keypress parser reads them. */
const KEY_BYTES: Record<KeyName, string> = {
	up: "\u001b[A",
	down: "\u001b[B",
	right: "\u001b[C",
	left: "\u001b[D",
	enter: "\r",
	space: " ",
	tab: "\t",
	"shift+tab": "\u001b[Z",
	backspace: "\u007f",
	delete: "\u001b[3~",
	escape: "\u001b",
	"ctrl+c": "\u0003",
	home: "\u001b[H",
	end: "\u001b[F",
	pageup: "\u001b[5~",
	pagedown: "\u001b[6~",
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR, other CSI and OSC sequences all start with ESC
const ESCAPES = /\u001b\[([0-9;]*)m|\u001b\[[0-9;?]*[A-Za-z]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

const hex = (r: number, g: number, b: number): string =>
	`#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

type Kind = "fg" | "bg" | "b" | "dim" | "i" | "u" | "inverse" | "s";

/** Decode one run of SGR parameters into markup, against the stack of open styles. */
const decodeSgr = (params: string, open: Array<{ readonly kind: Kind; readonly close: string }>): string => {
	let out = "";
	const close = (kind: Kind): void => {
		for (let index = open.length - 1; index >= 0; index--) {
			const entry = open[index];
			if (entry?.kind === kind) {
				out += entry.close;
				open.splice(index, 1);
				return;
			}
		}
	};
	const push = (kind: Kind, tag: string, closeTag: string): void => {
		if (kind === "fg" || kind === "bg") close(kind);
		out += tag;
		open.push({ kind, close: closeTag });
	};
	const colour = (kind: "fg" | "bg", codes: ReadonlyArray<number>, at: number): number => {
		if (codes[at + 1] === 2) {
			const [r, g, b] = [codes[at + 2] ?? 0, codes[at + 3] ?? 0, codes[at + 4] ?? 0];
			const token = kind === "fg" && r === 0 && g === 0 ? TOKEN_BY_BLUE.get(b) : undefined;
			if (token !== undefined) push(kind, `[${token}]`, `[/${token}]`);
			else push(kind, `[${kind}:${hex(r, g, b)}]`, `[/${kind}]`);
			return at + 4;
		}
		if (codes[at + 1] === 5) {
			push(kind, `[${kind}:ansi256(${codes[at + 2] ?? 0})]`, `[/${kind}]`);
			return at + 2;
		}
		return at;
	};
	const codes = params === "" ? [0] : params.split(";").map(Number);
	for (let at = 0; at < codes.length; at++) {
		const code = codes[at] ?? 0;
		if (code === 0) while (open.length > 0) close(open[open.length - 1]?.kind ?? "fg");
		else if (code === 1) push("b", "[b]", "[/b]");
		else if (code === 2) push("dim", "[dim]", "[/dim]");
		else if (code === 22) {
			close("dim");
			close("b");
		} else if (code === 3) push("i", "[i]", "[/i]");
		else if (code === 23) close("i");
		else if (code === 4) push("u", "[u]", "[/u]");
		else if (code === 24) close("u");
		else if (code === 7) push("inverse", "[inverse]", "[/inverse]");
		else if (code === 27) close("inverse");
		else if (code === 9) push("s", "[s]", "[/s]");
		else if (code === 29) close("s");
		else if (code >= 30 && code <= 37) push("fg", `[fg:${NAMED[code - 30]}]`, "[/fg]");
		else if (code >= 90 && code <= 97) push("fg", `[fg:${NAMED[code - 90]}Bright]`, "[/fg]");
		else if (code === 38) at = colour("fg", codes, at);
		else if (code === 39) close("fg");
		else if (code >= 40 && code <= 47) push("bg", `[bg:${NAMED[code - 40]}]`, "[/bg]");
		else if (code >= 100 && code <= 107) push("bg", `[bg:${NAMED[code - 100]}Bright]`, "[/bg]");
		else if (code === 48) at = colour("bg", codes, at);
		else if (code === 49) close("bg");
	}
	return out;
};

const styled = (ansi: string): string => {
	const open: Array<{ readonly kind: Kind; readonly close: string }> = [];
	let out = "";
	let last = 0;
	for (const match of ansi.matchAll(ESCAPES)) {
		out += ansi.slice(last, match.index);
		last = match.index + match[0].length;
		if (match[1] !== undefined) out += decodeSgr(match[1], open);
	}
	out += ansi.slice(last);
	for (let index = open.length - 1; index >= 0; index--) out += open[index]?.close ?? "";
	return out;
};

const trimLines = (text: string): string =>
	text
		.split("\n")
		.map((line) => line.trimEnd())
		.join("\n");

/**
 * Markup only this harness writes: a token tag opened and closed (`[info]…[/info]`), or a colour tag. A lone
 * `[info]` is a log prefix, and style-only tags (`[b]`, `[i]`) are too common in unrelated data, so neither is claimed.
 */
const MARKUP = new RegExp(`\\[(${TOKENS.join("|")})\\][\\s\\S]*?\\[/\\1\\]|\\[(?:fg|bg):[^\\]\\s]+\\]`);

/** Run `register`'s check on native timers, which a `TestClock` cannot hold, until it says done. */
const realTime = (poll: () => boolean): Effect.Effect<void> =>
	Effect.callback<void>((resume) => {
		if (poll()) return resume(Effect.void);
		const timer = setInterval(() => {
			if (poll()) {
				clearInterval(timer);
				resume(Effect.void);
			}
		}, 2);
		return Effect.sync(() => clearInterval(timer));
	});

const QUIET_MS = 50;
const TRAILING_QUIET_MS = 8;
const ESCAPE_FLUSH_MS = 30;
const MOUNT_LIMIT_MS = 2_000;
const RERENDER_AFTER_END = "@effected/cli/ui/testing: rerender after the screen ended";
const RERENDER_BEFORE_MOUNT =
	"@effected/cli/ui/testing: rerender before the screen mounted (waited 2 s; is another screen still mounted?)";

/**
 * Drive and read Ink screens in tests: mount a screen on in-memory streams, press keys, and read its frames as token
 * markup.
 *
 * @public
 */
export class CliUiTest {
	private constructor() {}

	/**
	 * Mount `screen` on in-memory terminal streams for the enclosing scope.
	 *
	 * @remarks
	 * The screen runs under a fixed environment: a `TerminalEnv` test layer with the given columns and colour, a
	 * `CliTheme` whose every token paints in its own marker colour (so frames do not depend on the real palette), and
	 * `CliInteractive` set from `interactive`. Ink renders in debug mode, writing every frame in full; the frames
	 * are taken from those writes. Closing the scope unmounts the screen. The returned handle is ready once the first
	 * frame is drawn or the screen has ended.
	 *
	 * Waiting is on real time, through native timers a `TestClock` cannot hold, so it works under `it.effect` and
	 * `it.live` alike, and never sleeps longer than 50 ms past the last write (30 ms first, for Esc).
	 *
	 * The first frame is awaited for at most 2 s: a screen that draws nothing for longer gives a handle whose `frames`
	 * is `[]`. Screens run one at a time process-wide (`CliUi.run`), so a second handle opened while another is
	 * still mounted waits for that mount: it returns at the 2 s cap with no frames, and its keys queue in its input until
	 * it mounts.
	 *
	 * Debug frames bypass Ink's erase-and-redraw path, so a harness frame says nothing about what Ink writes between
	 * frames on a real terminal (a screen clear, for instance); a test of that needs the production render path.
	 * Unmounting is the scope's close; to draw a different screen, render it in a new scope.
	 *
	 * @param screen - the screen to mount
	 * @param options - the terminal's size, colour and glyphs, and whether the run is interactive
	 */
	static readonly render = <A>(
		screen: Screen<A>,
		options: CliUiTestOptions = {},
	): Effect.Effect<CliUiTestHandle<A>, never, Scope.Scope> =>
		Effect.gen(function* () {
			const columns = options.columns ?? 80;
			const rows = options.rows ?? 24;
			const color = options.color ?? "truecolor";
			const raws: Array<string> = [];
			let lastWrite = 0;
			let frameDue = false;
			let ended = false;
			const fake = makeFakeStreams({
				columns,
				rows,
				onStdoutWrite: (chunk) => {
					lastWrite = Date.now();
					if (frameDue) {
						frameDue = false;
						raws.push(chunk);
					}
				},
			});
			const stream = { isTerminal: true, color, hyperlinks: false, columns: Option.some(columns) };
			const terminal = TerminalEnv.layerTest({ stdinIsTerminal: true, stdout: stream, stderr: stream });
			const environment = Layer.mergeAll(
				CliTheme.layer({ tokens: MARKER_STYLES, glyphs: options.glyphs ?? "unicode" }).pipe(Layer.provide(terminal)),
				CliInteractive.layerTest(options.interactive ?? true),
			);
			let swap: ((next: ReactElement) => void) | undefined;
			let control: ScreenControl<A> | undefined;
			// The screen is held in a swappable holder, so rerender changes only its subtree, under the same control.
			const held: Screen<A> = async (given) => {
				control = given;
				const initial = await screen(given);
				return inkModules().react.createElement(holder(), {
					initial,
					bind: (next) => {
						swap = next;
					},
				});
			};
			const fiber = yield* Effect.forkScoped(
				CliUi.run(held).pipe(
					Effect.provideService(UiStreams, fake.streams),
					Effect.provideService(UiRenderOptions, {
						debug: true,
						onRender: () => {
							frameDue = true;
						},
					}),
					Effect.provide(environment),
					Effect.onExit(() =>
						Effect.sync(() => {
							ended = true;
						}),
					),
				),
			);
			/**
			 * Wait until a frame after `before` has been followed by a short quiet, so a reaction that renders twice
			 * is read whole; or, with no new frame, until quiet since the later of `since` and the last write. Never
			 * longer than `limitMs` from `since` once a frame has come.
			 */
			const settle = (before: number, since: number, limitMs = QUIET_MS): Effect.Effect<void> =>
				realTime(() => {
					if (ended) return true;
					const now = Date.now();
					if (raws.length > before) return now - lastWrite >= TRAILING_QUIET_MS || now - since >= limitMs;
					return now - Math.max(since, lastWrite) >= QUIET_MS && now - since >= QUIET_MS;
				});

			const mountedBy = Date.now() + MOUNT_LIMIT_MS;
			yield* realTime(() => raws.length > 0 || ended || Date.now() >= mountedBy);
			yield* settle(0, Date.now());

			const send = (bytes: string, flushMs = 0): Effect.Effect<void> =>
				Effect.suspend(() => {
					const before = raws.length;
					fake.input(bytes);
					const sent = Date.now();
					const flushed = flushMs === 0 ? Effect.void : realTime(() => Date.now() - sent >= flushMs);
					return Effect.andThen(flushed, settle(before, Date.now()));
				});

			const handle: CliUiTestHandle<A> = {
				press: (...keys) =>
					Effect.forEach(keys, (key) => send(KEY_BYTES[key], key === "escape" ? ESCAPE_FLUSH_MS : 0), {
						discard: true,
					}),
				type: (text) => Effect.forEach([...text], (character) => send(character), { discard: true }),
				resize: (nextColumns, nextRows) =>
					Effect.suspend(() => {
						const before = raws.length;
						const since = Date.now();
						fake.resize(nextColumns, nextRows);
						return settle(before, since);
					}),
				rerender: (next) =>
					Effect.gen(function* () {
						// Bounded like render's first frame: a handle queued behind another screen may never mount here.
						const mountedBy = Date.now() + MOUNT_LIMIT_MS;
						yield* realTime(() => swap !== undefined || ended || Date.now() >= mountedBy);
						if (ended) return yield* Effect.die(new Error(RERENDER_AFTER_END));
						if (swap === undefined || control === undefined) {
							return yield* Effect.die(new Error(RERENDER_BEFORE_MOUNT));
						}
						const given = control;
						const element = yield* Effect.promise(async () => next(given));
						if (ended) return yield* Effect.die(new Error(RERENDER_AFTER_END));
						const before = raws.length;
						const since = Date.now();
						swap(element);
						yield* settle(before, since);
					}),
				frame: Effect.sync(() => trimLines(styled(raws.at(-1) ?? ""))),
				rawFrame: Effect.sync(() => raws.at(-1) ?? ""),
				plainFrame: Effect.sync(() => trimLines((raws.at(-1) ?? "").replace(ESCAPES, ""))),
				frames: Effect.sync(() => raws.map((raw) => trimLines(styled(raw)))),
				result: Fiber.join(fiber),
			};
			return handle;
		});

	/**
	 * Decode ANSI back to markup: a marker colour to its token (`[success]…[/success]`), any other foreground to
	 * `[fg:red]` or `[fg:#ff0000]` (backgrounds likewise as `[bg:…]`), bold to `[b]`, dim to `[dim]`, italic, underline,
	 * inverse and strikethrough to `[i]`, `[u]`, `[inverse]` and `[s]`. A reset closes everything open; every other
	 * escape (cursor, erase, hyperlinks) is dropped.
	 *
	 * @param ansi - text with escapes
	 */
	static readonly styled: (ansi: string) => string = styled;

	/**
	 * A Vitest snapshot serializer. It claims a string carrying escapes, a token tag opened and closed, or a colour
	 * tag (a raw or styled frame, or a `Render.ansi` string), but not a log line's lone `[info]` prefix, nor one whose
	 * only brackets are style tags like `[b]`, which unrelated data uses too. It prints the string as token markup with each line's trailing spaces trimmed, so a snapshot reads
	 * without escapes and does not churn with the palette. Register it with `expect.addSnapshotSerializer`.
	 */
	static readonly serializer: {
		readonly test: (value: unknown) => boolean;
		readonly serialize: (value: unknown) => string;
	} = {
		test: (value) => typeof value === "string" && (value.includes("\u001b") || MARKUP.test(value)),
		serialize: (value) => trimLines(styled(String(value))),
	};
}
