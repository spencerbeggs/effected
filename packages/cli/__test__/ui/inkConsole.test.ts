import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Instance } from "ink";
import { Box, Text, render } from "ink";
import type { ReactElement } from "react";
import { createElement } from "react";
import { loadInk } from "../../src/ui/internal/ink.js";
import type { InkConsole } from "../../src/ui/internal/inkConsole.js";
import { makeInkConsole } from "../../src/ui/internal/inkConsole.js";
import type { FakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import type { UiStreamsShape } from "../../src/ui.js";
import { UiStreams } from "../../src/ui.js";
import { screenAfter } from "../helpers/terminalModel.js";

/** A two-row frame, so a torn repaint shows as a stranded header. */
const frame = (tick: number): ReactElement =>
	createElement(
		Box,
		{ flexDirection: "column" },
		createElement(Text, null, "LIVE HEADER"),
		createElement(Text, null, `tick ${tick}`),
	);

/**
 * One terminal, as a tty is: stdout and stderr are the same fake stream, so the transcript holds both in write order.
 * The production path: interactive, debug off.
 */
const terminal = (): { readonly fake: FakeStreams; readonly streams: UiStreamsShape } => {
	const fake = makeFakeStreams({ columns: 40, rows: 20 });
	return { fake, streams: { stdin: fake.streams.stdin, stdout: fake.streams.stdout, stderr: fake.streams.stdout } };
};

const mount = (streams: UiStreamsShape, bridge: InkConsole, tick: number): Instance =>
	render(createElement(bridge.Bridge, null, frame(tick)), {
		stdin: streams.stdin,
		stdout: streams.stdout,
		stderr: streams.stderr,
		interactive: true,
		patchConsole: false,
		exitOnCtrlC: false,
	});

const LOGS = [1, 2, 3, 4, 5].flatMap((index) => [`out line ${index}`, `err line ${index}`]);
const FINAL = ["LIVE HEADER", "tick 5"];

/** A live frame rerendered five times, with a stdout and a stderr line written after each rerender by `write`. */
const run = (write: (bridge: InkConsole, streams: UiStreamsShape, index: number) => void) =>
	Effect.gen(function* () {
		yield* loadInk;
		const { fake, streams } = terminal();
		const bridge = yield* makeInkConsole.pipe(Effect.provideService(UiStreams, streams));
		const instance = mount(streams, bridge, 0);
		for (let index = 1; index <= 5; index++) {
			instance.rerender(createElement(bridge.Bridge, null, frame(index)));
			yield* Effect.promise(() => instance.waitUntilRenderFlush());
			write(bridge, streams, index);
		}
		bridge.detach();
		instance.unmount();
		yield* Effect.promise(() => instance.waitUntilExit().catch(() => undefined));
		return { fake, bridge };
	});

describe("the console bridge writes above a live Ink frame (probe L4, production path)", () => {
	it.live("five stdout and five stderr lines land above the frame, in order, with one frame left", () =>
		Effect.gen(function* () {
			const { fake } = yield* run((bridge, _streams, index) => {
				bridge.writer.log(`out line ${index}`);
				bridge.writer.error(`err line ${index}`);
			});
			assert.deepStrictEqual(screenAfter(fake.stdout()), [...LOGS, ...FINAL]);
		}),
	);

	it.live("control: the same lines written straight to the stream tear the frame", () =>
		Effect.gen(function* () {
			const { fake } = yield* run((_bridge, streams, index) => {
				streams.stdout.write(`out line ${index}\n`);
				streams.stderr.write(`err line ${index}\n`);
			});
			assert.notDeepEqual(screenAfter(fake.stdout()), [...LOGS, ...FINAL]);
		}),
	);

	it.live("before the bridge mounts and after detach, a line goes straight to its stream and is never dropped", () =>
		Effect.gen(function* () {
			const { fake, bridge } = yield* run(() => undefined);
			bridge.writer.log("after the unmount");
			bridge.writer.error("an error after the unmount");
			const shown = screenAfter(fake.stdout());
			assert.deepStrictEqual(shown.slice(-2), ["after the unmount", "an error after the unmount"]);
		}),
	);

	it.live("while mounted, a stdout line goes through Ink's stdout and a stderr line through its stderr", () =>
		Effect.gen(function* () {
			yield* loadInk;
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const bridge = yield* makeInkConsole.pipe(Effect.provideService(UiStreams, fake.streams));
			const instance = mount(fake.streams, bridge, 1);
			yield* Effect.promise(() => instance.waitUntilRenderFlush());
			bridge.writer.info("an info line");
			bridge.writer.warn("a warning line");
			bridge.detach();
			instance.unmount();
			yield* Effect.promise(() => instance.waitUntilExit().catch(() => undefined));
			assert.deepStrictEqual(screenAfter(fake.stdout()), ["an info line", ...FINAL.slice(0, 1), "tick 1"]);
			assert.strictEqual(fake.stderr(), "a warning line\n");
		}),
	);

	it.live("an unmount without a detach also goes back to the streams, so no line is dropped", () =>
		Effect.gen(function* () {
			yield* loadInk;
			const { fake, streams } = terminal();
			const bridge = yield* makeInkConsole.pipe(Effect.provideService(UiStreams, streams));
			const instance = mount(streams, bridge, 1);
			yield* Effect.promise(() => instance.waitUntilRenderFlush());
			instance.unmount();
			yield* Effect.promise(() => instance.waitUntilExit().catch(() => undefined));
			bridge.writer.log("after an unmount with no detach");
			assert.deepStrictEqual(screenAfter(fake.stdout()).at(-1), "after an unmount with no detach");
		}),
	);

	it.live("detach takes effect at once: a line written after it, before the unmount, goes straight to its stream", () =>
		Effect.gen(function* () {
			yield* loadInk;
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const bridge = yield* makeInkConsole.pipe(Effect.provideService(UiStreams, fake.streams));
			const instance = mount(fake.streams, bridge, 1);
			yield* Effect.promise(() => instance.waitUntilRenderFlush());
			bridge.detach();
			const before = fake.stdout();
			bridge.writer.error("written between detach and unmount");
			// Through Ink's writer the frame would be erased and repainted on stdout around the line.
			assert.strictEqual(fake.stdout(), before, "no repaint: Ink's writer was not used");
			assert.strictEqual(fake.stderr(), "written between detach and unmount\n");
			instance.unmount();
			yield* Effect.promise(() => instance.waitUntilExit().catch(() => undefined));
		}),
	);

	it.live("with no bridge mounted at all, stdout and stderr lines reach their own streams", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const bridge = yield* makeInkConsole.pipe(Effect.provideService(UiStreams, fake.streams));
			bridge.writer.log("to stdout", { n: 1 });
			bridge.writer.error("to stderr");
			assert.strictEqual(fake.stdout(), 'to stdout {"n":1}\n');
			assert.strictEqual(fake.stderr(), "to stderr\n");
		}),
	);
});
