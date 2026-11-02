import { assert, describe, it } from "@effect/vitest";
import { Text, render } from "ink";
import { createElement } from "react";
import { vi } from "vitest";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";

// React's development build records user-timing entries only when `console.timeStamp` is a function, checked once as
// the reconciler loads (react-reconciler.development.js, `supportsUserTiming`). Node's console has it; a Vitest
// worker's does not, so without this the leak never happens here and the control below could not fail. Installed
// before Ink, and so React, is imported.
vi.hoisted(() => {
	const target = console as { timeStamp?: (label?: string) => void };
	if (typeof target.timeStamp !== "function") target.timeStamp = () => undefined;
});

const RERENDERS = 200;

/** Mount an Ink frame on fake streams and rerender it `RERENDERS` times: the measures React recorded, and the ones left. */
const measuresAfterRerenders = (): { readonly recorded: number; readonly left: number } => {
	performance.clearMeasures();
	const spy = vi.spyOn(performance, "measure");
	const fake = makeFakeStreams({ columns: 40, rows: 10 });
	const instance = render(createElement(Text, null, "tick 0"), {
		stdin: fake.streams.stdin,
		stdout: fake.streams.stdout,
		stderr: fake.streams.stderr,
		interactive: true,
		patchConsole: false,
		exitOnCtrlC: false,
	});
	for (let tick = 1; tick <= RERENDERS; tick++) instance.rerender(createElement(Text, null, `tick ${tick}`));
	instance.unmount();
	const recorded = spy.mock.calls.length;
	spy.mockRestore();
	return { recorded, left: performance.getEntriesByType("measure").length };
};

describe("React's development build records user-timing measures, and Ink's reconciler clears each one", () => {
	// Ink 7's reconciler (react-reconciler 0.33) left about 15 measures per rerender, which the kit once drained with a
	// process-wide clear; 0.34, which the ink ^8 peer requires, clears each measure right after recording it. This pins
	// that: if a reconciler the peer admits leaks again, a drain is needed again.
	it("React records a measure per rerender and none are left", () => {
		const { recorded, left } = measuresAfterRerenders();
		assert.isAbove(recorded, RERENDERS, "control: React recorded measures");
		assert.strictEqual(left, 0);
	});
});
