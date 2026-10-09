/**
 * `CliUiTest.live`'s `write` (#964) and `LiveHandle.printAbove` (#963): a raw line written under a mounted frame strands
 * the frame's top row at its next redraw, and the same line printed through the handle lands once, above the frame.
 */
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { createElement } from "react";
import { CliUiTest } from "../../src/ui-testing.js";
import type { Ev, State } from "../helpers/live.js";
import { End, Start, reduce } from "../helpers/live.js";

const withFrame = (state: State, frame: number): ReactElement =>
	createElement(
		Box,
		{ flexDirection: "column" },
		createElement(Text, null, `RUN ${state.run}`),
		createElement(Text, null, `${state.last} frame ${frame}`),
	);

const viewOptions = {
	initial: { run: 0, last: "idle", seen: [] } as State,
	reduce,
	render: withFrame,
	isStart: (event: Ev) => event._tag === "Start",
	isTerminal: (event: Ev) => event._tag === "End",
	columns: 40,
	rows: 10,
};

const occurrences = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

describe("CliUiTest.live: a raw write under the frame", () => {
	for (const stream of ["stdout", "stderr"] as const) {
		it.effect(`control: a raw ${stream} line under the frame strands its top row at the next redraw`, () =>
			Effect.gen(function* () {
				const view = yield* CliUiTest.live(viewOptions);
				yield* view.publish(Start);
				yield* view.write(stream, "FOREIGN\n");
				assert.include(yield* view.written, "FOREIGN\n", "the bytes reached the terminal as written");
				assert.strictEqual(
					yield* view.transcript,
					"RUN 1\nstarted frame 0\nFOREIGN",
					"before the redraw the line sits under the frame",
				);
				// The frame index moves, so Ink redraws: it erases the frame's two lines counted from the cursor the raw line
				// moved down, taking the line and the frame's second row, and leaves its first.
				yield* view.advance("80 millis");
				yield* view.publish(End);
				const transcript = yield* view.transcript;
				assert.strictEqual(transcript, "RUN 1\nRUN 1\nended frame 1");
				assert.strictEqual(occurrences(transcript, "RUN 1"), 2, "the top row is stranded above the frame");
				assert.notInclude(transcript, "FOREIGN", "and the foreign line itself is erased");
			}).pipe(Effect.scoped),
		);
	}

	it.effect("the same line through logConsole lands once, above the committed frame", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.live(viewOptions);
			yield* view.publish(Start);
			view.handle.logConsole.error("FOREIGN");
			yield* view.advance("80 millis");
			yield* view.publish(End);
			const transcript = yield* view.transcript;
			assert.strictEqual(transcript, "FOREIGN\nRUN 1\nended frame 1");
			assert.strictEqual(occurrences(transcript, "RUN 1"), 1, "nothing stranded");
		}).pipe(Effect.scoped),
	);
});

describe("LiveHandle.printAbove", () => {
	it.effect("prints above a mounted frame and says so, on either stream", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.live(viewOptions);
			yield* view.publish(Start);
			assert.isTrue(view.handle.printAbove("stderr", "FROM STDERR"));
			assert.isTrue(view.handle.printAbove("stdout", "FROM STDOUT"));
			yield* view.advance("80 millis");
			yield* view.publish(End);
			const transcript = yield* view.transcript;
			assert.strictEqual(transcript, "FROM STDERR\nFROM STDOUT\nRUN 1\nended frame 1");
		}).pipe(Effect.scoped),
	);

	it.effect(
		"writes nothing and answers false with no frame mounted: before the first run, between runs, after close",
		() =>
			Effect.gen(function* () {
				const view = yield* CliUiTest.live(viewOptions);
				assert.isFalse(view.handle.printAbove("stdout", "BEFORE"), "before the first run");
				yield* view.publish(Start);
				yield* view.publish(End);
				assert.isFalse(view.handle.printAbove("stderr", "BETWEEN"), "after the run committed its frame");
				yield* view.publish(Start);
				assert.isTrue(view.handle.printAbove("stdout", "DURING"), "control: the second run's frame is mounted");
				yield* view.handle.close;
				assert.isFalse(view.handle.printAbove("stdout", "AFTER"), "after close");
				const written = yield* view.written;
				for (const line of ["BEFORE", "BETWEEN", "AFTER"]) assert.notInclude(written, line);
				assert.include(written, "DURING");
			}).pipe(Effect.scoped),
	);

	it.effect("answers false, writing nothing, when the view is not interactive and so never mounts", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.live({ ...viewOptions, interactive: false });
			yield* view.publish(Start);
			assert.isFalse(view.handle.printAbove("stdout", "NEVER"));
			yield* view.publish(End);
			assert.notInclude(yield* view.written, "NEVER");
		}).pipe(Effect.scoped),
	);
});
