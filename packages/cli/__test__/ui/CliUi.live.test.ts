import { assert, describe, it } from "@effect/vitest";
import { Effect, Fiber, PubSub, Queue, Stream } from "effect";
import { Text, render } from "ink";
import { createElement } from "react";
import { CliTheme } from "../../src/index.js";
import type { FakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import type { LiveHandle } from "../../src/ui.js";
import { CliUi } from "../../src/ui.js";
import type { Ev, State } from "../helpers/live.js";
import {
	CLEAR_SCREEN,
	CLEAR_SCROLLBACK,
	End,
	SHOW_CURSOR,
	Start,
	capturing,
	chalk,
	frameOf,
	liveOn,
	mountsAndResolves,
	optionsOf,
	queueOf,
	tick,
	until,
	warningsIn,
} from "../helpers/live.js";
import { screenAfter } from "../helpers/terminalModel.js";

describe("CliUi.live: subscription and the fold", () => {
	it.live("a PubSub-backed stream is subscribed when live returns: an event published at once is seen", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const pubsub = yield* PubSub.unbounded<Ev>();
			const events = Stream.fromPubSub(pubsub).pipe(Stream.takeUntil((event) => event._tag === "End"));
			const handle: LiveHandle<State> = yield* liveOn(fake, optionsOf(events), { interactive: false });
			yield* PubSub.publish(pubsub, tick(7));
			yield* PubSub.publish(pubsub, End);
			yield* handle.done.pipe(Effect.timeout("1 second"));
			assert.deepStrictEqual((yield* handle.state).seen, ["tick 7", "End"]);
		}).pipe(Effect.scoped),
	);
});

describe("CliUi.live: when a stream is subscribed (Task 3 review, important 1)", () => {
	it.live("a subscription made first and passed as Stream.fromSubscription sees an event published at once", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams();
			const pubsub = yield* PubSub.unbounded<Ev>();
			const subscription = yield* PubSub.subscribe(pubsub);
			const events = Stream.fromSubscription(subscription).pipe(Stream.takeUntil((event) => event._tag === "End"));
			const handle = yield* liveOn(fake, optionsOf(events), { interactive: false });
			yield* PubSub.publish(pubsub, tick(7));
			yield* PubSub.publish(pubsub, End);
			yield* handle.done.pipe(Effect.timeout("1 second"));
			assert.deepStrictEqual((yield* handle.state).seen, ["tick 7", "End"]);
		}).pipe(Effect.scoped),
	);

	it.live(
		"a stream that forks its upstream (merge) subscribes after live returns: an event published at once is lost",
		() =>
			Effect.gen(function* () {
				const fake = makeFakeStreams();
				const pubsub = yield* PubSub.unbounded<Ev>();
				const events = Stream.merge(Stream.fromPubSub(pubsub), Stream.never).pipe(
					Stream.takeUntil((event) => event._tag === "End"),
				);
				const handle = yield* liveOn(fake, optionsOf(events), { interactive: false });
				yield* PubSub.publish(pubsub, tick(7));
				// By now the forked upstream has subscribed: what is published from here on is seen.
				yield* Effect.sleep("50 millis");
				yield* PubSub.publish(pubsub, tick(8));
				yield* PubSub.publish(pubsub, End);
				yield* handle.done.pipe(Effect.timeout("1 second"));
				assert.deepStrictEqual(
					(yield* handle.state).seen,
					["tick 8", "End"],
					"tick 7 was published before the subscribe",
				);
			}).pipe(Effect.scoped),
	);
});

describe("CliUi.live: runs on the production path", () => {
	it.live("start, events, terminal: the final frame is committed, and the mount permit is released", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const handle = yield* liveOn(fake, optionsOf(Stream.fromIterable([Start, tick(1), tick(2), End])));
			yield* handle.done.pipe(Effect.timeout("2 seconds"));
			assert.deepStrictEqual(screenAfter(fake.stdout()), ["RUN 1", "ended"]);
			assert.strictEqual(yield* mountsAndResolves(makeFakeStreams()), "mounted", "a screen mounts after the run");
		}).pipe(Effect.scoped),
	);

	it.live("watch mode: three runs commit three frames, a mid-run start re-renders in place, scrollback untouched", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			fake.streams.stdout.write("HISTORY\n");
			let mounts = 0;
			const events = Stream.fromIterable([
				Start,
				tick(1),
				End,
				Start,
				tick(2),
				End,
				Start,
				tick(3),
				Start,
				tick(4),
				End,
			]);
			const handle = yield* liveOn(fake, optionsOf(events), { onMount: () => mounts++ });
			yield* handle.done.pipe(Effect.timeout("2 seconds"));
			const written = fake.stdout();
			assert.notInclude(written, CLEAR_SCROLLBACK);
			assert.notInclude(written, CLEAR_SCREEN);
			assert.deepStrictEqual(screenAfter(written), ["HISTORY", "RUN 1", "ended", "RUN 2", "ended", "RUN 4", "ended"]);
			assert.strictEqual(mounts, 3, "a start while mounted does not remount");
		}).pipe(Effect.scoped),
	);

	it.live("a stream that ends mid-run commits the frame drawn so far, and done completes", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const handle = yield* liveOn(fake, optionsOf(Stream.fromIterable([Start, tick(1), tick(2)])));
			yield* handle.done.pipe(Effect.timeout("2 seconds"));
			assert.deepStrictEqual(screenAfter(fake.stdout()), ["RUN 1", "tick 2"]);
			assert.strictEqual(yield* mountsAndResolves(makeFakeStreams()), "mounted", "the permit was released");
		}).pipe(Effect.scoped),
	);

	it.live("the first non-terminal event while nothing is mounted starts a run", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			let mounts = 0;
			const handle = yield* liveOn(fake, optionsOf(Stream.fromIterable([tick(1), tick(2), End])), {
				onMount: () => mounts++,
			});
			yield* handle.done.pipe(Effect.timeout("2 seconds"));
			assert.strictEqual(mounts, 1);
			assert.deepStrictEqual(screenAfter(fake.stdout()), ["RUN 0", "ended"]);
		}).pipe(Effect.scoped),
	);

	it.live("closing the scope mid-run unmounts: no raw mode, the cursor shown, the colour and the permit restored", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const instance = yield* chalk;
			const before = instance.level;
			const queue = yield* queueOf();
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* liveOn(fake, optionsOf(Stream.fromQueue(queue)), { color: "truecolor" });
					yield* Queue.offerAll(queue, [Start, tick(1)]);
					yield* until(() => screenAfter(fake.stdout()).includes("tick 1"));
					assert.strictEqual(instance.level, 3, "the run holds the stream's colour level");
				}),
			);
			assert.deepStrictEqual(fake.rawModes, [], "raw mode was never entered");
			assert.include(fake.stdout().slice(-64), SHOW_CURSOR, "the cursor is shown");
			assert.strictEqual(instance.level, before, "the colour level is restored");
			const written = fake.stdout();
			yield* Queue.offer(queue, tick(2));
			yield* Effect.sleep("50 millis");
			assert.strictEqual(fake.stdout(), written, "the drain stopped: nothing more is written");
			assert.strictEqual(yield* mountsAndResolves(makeFakeStreams()), "mounted", "the permit was released");
		}),
	);

	it.live("a 200-row frame on a 10-row terminal is clamped, so the scrollback is never cleared", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 10 });
			const tall = Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n");
			const options = optionsOf(Stream.fromIterable([Start, tick(1), End]), {
				render: (state) => createElement(Text, null, `${state.last}\n${tall}`),
			});
			const handle = yield* liveOn(fake, options);
			yield* handle.done.pipe(Effect.timeout("2 seconds"));
			const written = fake.stdout();
			assert.include(written, "line 0", "the frame drew");
			assert.notInclude(written, CLEAR_SCROLLBACK);
			assert.notInclude(written, CLEAR_SCREEN);
			assert.isAtMost(screenAfter(written).length, 9, "rows - 1 at most");
		}).pipe(Effect.scoped),
	);

	it.live("control: the same 200 rows rendered unclamped on a 10-row terminal do clear the scrollback", () =>
		Effect.gen(function* () {
			yield* CliUi.context.pipe(Effect.provide(CliTheme.layerTest()));
			const fake = makeFakeStreams({ columns: 40, rows: 10 });
			const tall = Array.from({ length: 200 }, (_, index) => `line ${index}`).join("\n");
			const instance = render(createElement(Text, null, `ended\n${tall}`), {
				stdin: fake.streams.stdin,
				stdout: fake.streams.stdout,
				stderr: fake.streams.stderr,
				interactive: true,
				patchConsole: false,
				exitOnCtrlC: false,
			});
			instance.unmount();
			yield* Effect.promise(() => instance.waitUntilExit().catch(() => undefined));
			assert.include(fake.stdout(), CLEAR_SCROLLBACK);
		}),
	);

	for (const mode of ["owned", "hosted"] as const) {
		it.live(`${mode}: no input is mounted: no stdin listener, and raw mode never entered`, () =>
			Effect.gen(function* () {
				const fake = makeFakeStreams({ columns: 40, rows: 20 });
				const queue = yield* queueOf();
				yield* liveOn(fake, optionsOf(Stream.fromQueue(queue), { mode }));
				yield* Queue.offerAll(queue, [Start, tick(1)]);
				yield* until(() => screenAfter(fake.stdout()).includes("tick 1"));
				const stdin = fake.streams.stdin;
				assert.deepStrictEqual(
					["readable", "data", "keypress"].map((event) => stdin.listenerCount(event)),
					[0, 0, 0],
				);
				assert.deepStrictEqual(fake.rawModes, []);
			}).pipe(Effect.scoped),
		);
	}
});

describe("CliUi.live: closing and failing (Task 3 review, minors 4 and 5a)", () => {
	it.live("closing the scope stops the fold first: events queued just before the close are never folded or drawn", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const queue = yield* queueOf();
			let mounts = 0;
			const handle = yield* Effect.scoped(
				Effect.gen(function* () {
					const handle = yield* liveOn(fake, optionsOf(Stream.fromQueue(queue)), { onMount: () => mounts++ });
					yield* Queue.offerAll(queue, [Start, tick(1)]);
					yield* until(() => screenAfter(fake.stdout()).includes("tick 1"));
					yield* Queue.offerAll(queue, [End, Start, tick(2)]);
					return handle;
				}),
			);
			const written = fake.stdout();
			yield* Effect.sleep("100 millis");
			assert.deepStrictEqual((yield* handle.state).seen, ["Start", "tick 1"], "nothing folded after the close began");
			assert.strictEqual(mounts, 1, "no run mounted during the close");
			assert.strictEqual(fake.stdout(), written, "nothing written after the close");
		}),
	);

	it.live("a mount that fails partway releases its run: the mount permit is free for a CliUi.run", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const log = capturing();
			const handle = yield* liveOn(fake, optionsOf(Stream.fromIterable([Start, tick(1)])), {
				console: log.console,
				onMount: () => {
					throw new Error("the mount failed");
				},
			});
			yield* Effect.exit(handle.done.pipe(Effect.timeout("1 second")));
			assert.strictEqual(warningsIn(log.lines).length, 1, "the failure is said once, as a warning");
			assert.strictEqual(yield* mountsAndResolves(makeFakeStreams()), "mounted", "the permit was released");
		}).pipe(Effect.scoped),
	);
});

describe("CliUi.live: around a mounted run", () => {
	it.live("logConsole lines land above the mounted frame, and go straight to the stream once the run has ended", () =>
		Effect.gen(function* () {
			// One terminal, as a tty is: stderr is the same stream as stdout, so the transcript holds both in order.
			const tty = makeFakeStreams({ columns: 40, rows: 20 });
			const fake: FakeStreams = { ...tty, streams: { ...tty.streams, stderr: tty.streams.stdout } };
			const queue = yield* queueOf();
			const handle = yield* liveOn(fake, optionsOf(Stream.fromQueue(queue)));
			yield* Queue.offerAll(queue, [Start, tick(1)]);
			yield* until(() => screenAfter(fake.stdout()).includes("tick 1"));
			handle.logConsole.log("a log line");
			handle.logConsole.error("an error line");
			yield* Queue.offer(queue, End);
			yield* until(() => screenAfter(fake.stdout()).includes("ended"));
			yield* Effect.sleep("20 millis");
			handle.logConsole.log("after the run");
			yield* Queue.end(queue);
			yield* handle.done.pipe(Effect.timeout("2 seconds"));
			assert.deepStrictEqual(screenAfter(fake.stdout()), [
				"a log line",
				"an error line",
				"RUN 1",
				"ended",
				"after the run",
			]);
		}).pipe(Effect.scoped),
	);

	it.live("a CliUi.run during a mounted run waits for the run to end, then mounts", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const queue = yield* queueOf();
			yield* liveOn(fake, optionsOf(Stream.fromQueue(queue)));
			yield* Queue.offerAll(queue, [Start, tick(1)]);
			yield* until(() => screenAfter(fake.stdout()).includes("tick 1"));
			const screen = yield* Effect.forkChild(mountsAndResolves(makeFakeStreams()));
			yield* Effect.sleep("100 millis");
			assert.isUndefined(screen.pollUnsafe(), "the screen waits while the run holds the permit");
			yield* Queue.offer(queue, End);
			assert.strictEqual(yield* Fiber.join(screen), "mounted");
		}).pipe(Effect.scoped),
	);

	it.live("a render that throws mid-run never hangs the drain: the fold goes on and done completes", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const options = optionsOf(Stream.fromIterable([Start, tick(1), tick(2), tick(3), End]), {
				render: (state) => {
					if (state.last === "tick 2") throw new Error("render threw");
					return frameOf(state);
				},
			});
			const handle = yield* liveOn(fake, options);
			yield* handle.done.pipe(Effect.timeout("2 seconds"));
			assert.strictEqual((yield* handle.state).last, "ended");
			assert.strictEqual(yield* mountsAndResolves(makeFakeStreams()), "mounted", "the run unmounted");
		}).pipe(Effect.scoped),
	);
});
