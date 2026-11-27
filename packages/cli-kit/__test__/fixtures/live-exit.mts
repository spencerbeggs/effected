// A real process for CliUi.live.exit.test.ts: an interactive live view on in-memory streams, its tick running, inside a
// scope that closes after 200 ms. It reports how many frames were drawn when the scope closed and when the process
// exited: a tick left running (okf/decisions/live-tick-is-a-scoped-schedule.md) would draw more and hold the process open.
import { writeSync } from "node:fs";
import { Effect, Queue, Stream } from "effect";
import { Text } from "ink";
import { createElement } from "react";
import { CliInteractive, CliTheme } from "../../src/index.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
// The live module and the streams reference, not the ./ui barrel: the live view needs nothing more.
import { live } from "../../src/ui/CliUiLive.js";
import { UiStreams } from "../../src/ui/UiStreams.js";

const fake = makeFakeStreams({ columns: 40, rows: 10 });
const frames = new Set<number>();

const program = Effect.scoped(
	Effect.gen(function* () {
		const queue = yield* Queue.unbounded<string>();
		yield* live({
			events: Stream.fromQueue(queue),
			initial: 0,
			reduce: (count) => count + 1,
			render: (count, frame) => {
				frames.add(frame);
				return createElement(Text, null, `events ${count}`);
			},
			isStart: () => true,
			isTerminal: () => false,
			tickMillis: 20,
		});
		yield* Queue.offer(queue, "go");
		yield* Effect.sleep("200 millis");
	}),
).pipe(
	Effect.provideService(UiStreams, fake.streams),
	Effect.provideService(CliInteractive, true),
	Effect.provide(CliTheme.layerTest()),
);

await Effect.runPromise(program);
// The scope has closed. A tick still running would keep drawing (and keep the process alive), so the frame count at
// exit must equal the count now. Written with writeSync from the exit handler: a pipe write there is asynchronous on
// macOS and would be lost.
const atClose = frames.size;
process.on("exit", () => {
	writeSync(1, `closed frames ${atClose} exited frames ${frames.size}\n`);
});
