import { Effect, Schedule } from "effect";
import type { FakeStreams } from "../../src/ui/testing/fakeStreams.js";

/** The bytes a terminal in raw mode sends for the keys these scripts press. */
export const KEY = {
	up: "\u001b[A",
	down: "\u001b[B",
	enter: "\r",
	escape: "\u001b",
	ctrlC: "\u0003",
} as const;

/** Wait, in real time, until `ready` holds; die naming `what` after 3 s. */
const until = (what: string, ready: () => boolean): Effect.Effect<void> =>
	Effect.suspend(() => (ready() ? Effect.void : Effect.fail(what))).pipe(
		Effect.retry(Schedule.spaced("5 millis")),
		Effect.timeout("3 seconds"),
		Effect.orDie,
	);

/** One screen's answer: wait until stdout shows `when` with raw mode on, then send each of `send` in turn. */
export interface ScriptStep {
	readonly when: string;
	readonly send: ReadonlyArray<string>;
}

/**
 * Answer screens a program mounts on `fake` itself, as a person would: for each step, wait for its screen, then type.
 * Each write is its own chunk, 20 ms apart (40 ms after a lone Esc, which Ink holds briefly in case a sequence
 * follows). Run it forked beside the program, under `it.live`.
 */
export const answer = (fake: FakeStreams, steps: ReadonlyArray<ScriptStep>): Effect.Effect<void> =>
	Effect.forEach(
		steps,
		(step) =>
			Effect.gen(function* () {
				yield* until(
					`a screen showing ${step.when}`,
					() => fake.stdout().includes(step.when) && fake.rawModes.at(-1) === true,
				);
				for (const bytes of step.send) {
					fake.input(bytes);
					yield* Effect.sleep(bytes === KEY.escape ? "40 millis" : "20 millis");
				}
			}),
		{ discard: true },
	);
