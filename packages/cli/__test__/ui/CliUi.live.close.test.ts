// LiveHandle.close and a PubSub subscription as `events`: the kit ends a view cleanly, folding the tail of a run that
// was published but not yet pulled (round 7, P5-1).
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Fiber, PubSub, Stream } from "effect";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { screenAfter } from "../../src/ui/testing/terminalModel.js";
import type { LiveHandle } from "../../src/ui.js";
import type { Ev, State } from "../helpers/live.js";
import { End, Start, liveOn, mountsAndResolves, optionsOf, reduce, tick, until } from "../helpers/live.js";

const runOf = (n: number): ReadonlyArray<Ev> => [Start, ...Array.from({ length: n }, (_, i) => tick(i + 1))];
const seenOf = (n: number): ReadonlyArray<string> => ["Start", ...Array.from({ length: n }, (_, i) => `tick ${i + 1}`)];
const count = (text: string, part: string): number => text.split(part).length - 1;

describe("PubSub.shutdown drops what a subscriber has not pulled (the truth P5-1 rests on)", () => {
	it.effect("published, then shut down: Stream.fromSubscription collects nothing, and remaining interrupts", () =>
		Effect.gen(function* () {
			const pubsub = yield* PubSub.unbounded<number>();
			const subscription = yield* PubSub.subscribe(pubsub);
			yield* PubSub.publishAll(pubsub, [1, 2, 3, 4, 5, 6, 7]);
			assert.strictEqual(yield* PubSub.remaining(subscription), 7, "control: all seven are queued before the shutdown");
			yield* PubSub.shutdown(pubsub);
			const collected = yield* Stream.runCollect(Stream.fromSubscription(subscription));
			assert.deepStrictEqual(collected, []);
			const remaining = yield* Effect.exit(PubSub.remaining(subscription));
			assert.isTrue(Exit.hasInterrupts(remaining), "remaining interrupts once the PubSub is shut down");
		}).pipe(Effect.scoped),
	);
});

describe("LiveHandle.close with a subscription", () => {
	it.live("published, then closed at once: every event is folded and the final frame shows the last", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const subscription = yield* PubSub.subscribe(pubsub);
			const handle = yield* liveOn(fake, optionsOf(subscription));
			yield* PubSub.publishAll(pubsub, runOf(7));
			yield* handle.close.pipe(Effect.timeout("2 seconds"));
			assert.deepStrictEqual((yield* handle.state).seen, seenOf(7));
			assert.deepStrictEqual(screenAfter(fake.stdout()), ["RUN 1", "tick 7"]);
		}).pipe(Effect.scoped),
	);

	it.live("messages still queued in the subscription when close is called are folded, not dropped", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const subscription = yield* PubSub.subscribe(pubsub);
			let handle: LiveHandle<State> | undefined;
			let closing: Fiber.Fiber<void> | undefined;
			// The start is folded while the view is still taking it: what the reducer publishes then waits in the
			// subscription, and the close lands before the view takes it. Only the close's own drain can fold it.
			const options = optionsOf(subscription, {
				reduce: (state, event) => {
					if (event._tag === "Start" && handle !== undefined) {
						for (const next of runOf(7).slice(1)) PubSub.publishUnsafe(pubsub, next);
						closing = Effect.runFork(handle.close);
					}
					return reduce(state, event);
				},
			});
			handle = yield* liveOn(fake, options);
			yield* PubSub.publish(pubsub, Start);
			yield* until(() => closing !== undefined);
			yield* Fiber.join(closing as unknown as Fiber.Fiber<void>).pipe(Effect.timeout("2 seconds"));
			assert.deepStrictEqual((yield* handle.state).seen, seenOf(7));
			assert.deepStrictEqual(screenAfter(fake.stdout()), ["RUN 1", "tick 7"]);
		}).pipe(Effect.scoped),
	);

	it.live("a run with no terminal event is committed as drawn, done completes, and the mount permit is released", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const subscription = yield* PubSub.subscribe(pubsub);
			const handle = yield* liveOn(fake, optionsOf(subscription));
			yield* PubSub.publishAll(pubsub, runOf(2));
			yield* handle.close.pipe(Effect.timeout("2 seconds"));
			yield* handle.done.pipe(Effect.timeout("1 second"));
			assert.deepStrictEqual(screenAfter(fake.stdout()), ["RUN 1", "tick 2"]);
			assert.strictEqual(yield* mountsAndResolves(makeFakeStreams()), "mounted", "the permit was released");
		}).pipe(Effect.scoped),
	);

	it.live("a run that ended before the close keeps its one committed frame", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const subscription = yield* PubSub.subscribe(pubsub);
			const handle = yield* liveOn(fake, optionsOf(subscription));
			yield* PubSub.publishAll(pubsub, [...runOf(3), End]);
			yield* handle.close.pipe(Effect.timeout("2 seconds"));
			assert.deepStrictEqual(screenAfter(fake.stdout()), ["RUN 1", "ended"]);
		}).pipe(Effect.scoped),
	);

	it.live("close twice: the second returns at once and writes nothing", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const subscription = yield* PubSub.subscribe(pubsub);
			const handle = yield* liveOn(fake, optionsOf(subscription));
			yield* PubSub.publishAll(pubsub, runOf(3));
			const [first, second] = yield* Effect.all([handle.close, handle.close], { concurrency: "unbounded" }).pipe(
				Effect.timeout("2 seconds"),
				Effect.as([true, true] as const),
			);
			assert.isTrue(first && second);
			const after = fake.stdout();
			yield* handle.close.pipe(Effect.timeout("1 second"));
			assert.strictEqual(fake.stdout(), after, "a later close writes nothing");
			assert.deepStrictEqual(screenAfter(after), ["RUN 1", "tick 3"]);
		}).pipe(Effect.scoped),
	);

	it.live("a subscription whose PubSub was shut down ends the view; a close after that is safe", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const subscription = yield* PubSub.subscribe(pubsub);
			const handle = yield* liveOn(fake, optionsOf(subscription), { interactive: false });
			yield* PubSub.shutdown(pubsub);
			yield* handle.done.pipe(Effect.timeout("1 second"));
			const exit = yield* Effect.exit(handle.close.pipe(Effect.timeout("1 second")));
			assert.isTrue(Exit.isSuccess(exit), "close is not interrupted by the shut-down subscription");
		}).pipe(Effect.scoped),
	);

	it.live("owned and not interactive: the run's tail is printed once", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const subscription = yield* PubSub.subscribe(pubsub);
			const handle = yield* liveOn(fake, optionsOf(subscription), { interactive: false });
			yield* PubSub.publishAll(pubsub, runOf(5));
			yield* handle.close.pipe(Effect.timeout("2 seconds"));
			yield* handle.close;
			const written = fake.stdout();
			assert.strictEqual(count(written, "RUN 1"), 1, written);
			assert.strictEqual(count(written, "tick 5"), 1, written);
		}).pipe(Effect.scoped),
	);
});

describe("LiveHandle.close with a plain stream", () => {
	it.live("what the view pulled is folded and committed; the stream, never ending, is stopped", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			// `live` pulls the first chunk before it returns: by the close, the run is in the view, not in the source.
			const events = Stream.concat(Stream.fromIterable(runOf(4)), Stream.never);
			const handle = yield* liveOn(fake, optionsOf(events));
			yield* handle.close.pipe(Effect.timeout("2 seconds"));
			assert.deepStrictEqual((yield* handle.state).seen, seenOf(4));
			assert.deepStrictEqual(screenAfter(fake.stdout()), ["RUN 1", "tick 4"]);
		}).pipe(Effect.scoped),
	);

	it.live("close after the stream ended: done is already complete, and nothing more is written", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const handle = yield* liveOn(fake, optionsOf(Stream.fromIterable([...runOf(2), End])));
			yield* handle.done.pipe(Effect.timeout("2 seconds"));
			const before = fake.stdout();
			yield* handle.close.pipe(Effect.timeout("1 second"));
			assert.strictEqual(fake.stdout(), before);
			assert.deepStrictEqual(screenAfter(before), ["RUN 1", "ended"]);
		}).pipe(Effect.scoped),
	);

	it.live("the caller's scope closing mid-close still releases everything", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const events = Stream.concat(Stream.fromIterable(runOf(1)), Stream.never);
			const fiber = yield* Effect.forkChild(
				Effect.scoped(Effect.flatMap(liveOn(fake, optionsOf(events)), (handle) => handle.close)),
			);
			yield* Fiber.join(fiber).pipe(Effect.timeout("2 seconds"));
			assert.strictEqual(yield* mountsAndResolves(makeFakeStreams()), "mounted", "the permit was released");
		}),
	);
});
