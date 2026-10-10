// A real process for ui/CliUiTest.quiet.test.ts (#983): a CliUiTest.live view mounted on the harness's in-memory
// streams, then the process exits. Every byte the harness draws must stay in its own streams, so the parent reads
// this process's REAL stdout and stderr, through to exit (an exit hook writes after the program is done), and finds
// them empty. The view's own bytes must carry Ink's hide-cursor escape, or the run never took the path that arms a
// real-terminal cursor restore, and the fixture exits 2 rather than pass vacuously. With the argument `control`, it
// writes one byte to the real stdout on purpose: the parent's positive control that its detector sees a write.
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { Text } from "ink";
import { createElement } from "react";
import { CliUiTest } from "../../src/ui-testing.js";

const HIDE_CURSOR = `${String.fromCharCode(0x1b)}[?25l`;

type Ev = "start" | "end";

const program = Effect.scoped(
	Effect.gen(function* () {
		const view = yield* CliUiTest.live({
			initial: 0,
			reduce: (count: number) => count + 1,
			render: (count: number) => createElement(Text, null, `events ${count}`),
			isStart: (event: Ev) => event === "start",
			isTerminal: (event: Ev) => event === "end",
			columns: 40,
			rows: 10,
		});
		yield* view.publish("start");
		yield* view.publish("end");
		return yield* view.written;
	}),
).pipe(Effect.provide(TestClock.layer()));

const written = await Effect.runPromise(program);
if (!written.includes(HIDE_CURSOR)) process.exit(2);
if (process.argv.includes("control")) process.stdout.write("x");
