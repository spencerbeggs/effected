// CliUi.liveDetached: a live view run from outside Effect. The host's side is promises; the test drives it from
// it.live with Effect.promise, as a reporter would from its own callbacks.
import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Layer, PubSub } from "effect";
import { CliInteractive } from "../../src/CliInteractive.js";
import { CliTheme } from "../../src/CliTheme.js";
import type { FakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { screenAfter } from "../../src/ui/testing/terminalModel.js";
import type { DetachedLiveOptions } from "../../src/ui.js";
import { CliUi, UiStreams } from "../../src/ui.js";
import type { Ev, State } from "../helpers/live.js";
import { End, Start, frameOf, reduce, tick, until } from "../helpers/live.js";

const envOf = (fake: FakeStreams, interactive = true): Layer.Layer<CliTheme> =>
	Layer.mergeAll(
		CliTheme.layerTest({ color: "none" }),
		Layer.succeed(UiStreams, fake.streams),
		Layer.succeed(CliInteractive, interactive),
	);

const detachedOptions = (
	pubsub: PubSub.PubSub<Ev>,
	extra: Partial<DetachedLiveOptions<Ev, State>> = {},
): DetachedLiveOptions<Ev, State> => ({
	events: pubsub,
	initial: { run: 0, last: "idle", seen: [] },
	reduce,
	render: frameOf,
	isStart: (event) => event._tag === "Start",
	isTerminal: (event) => event._tag === "End",
	...extra,
});

describe("CliUi.liveDetached", () => {
	it.live("an event published right after the call is seen, and close folds the queued tail", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const view = CliUi.liveDetached<Ev, State>(detachedOptions(pubsub), envOf(fake));
			// Published synchronously after the call, before the view's fiber has run: subscribed already, so not lost.
			PubSub.publishUnsafe(pubsub, Start);
			for (let n = 1; n <= 7; n++) PubSub.publishUnsafe(pubsub, tick(n));
			yield* Effect.promise(() => view.close());
			const handle = yield* Effect.promise(() => view.handle);
			assert.deepStrictEqual((yield* handle.state).seen.slice(-1), ["tick 7"]);
			assert.deepStrictEqual((yield* handle.state).seen.length, 8);
			assert.deepStrictEqual(screenAfter(fake.stdout()), ["RUN 1", "tick 7"]);
			// The host shuts its PubSub down only now; nothing is left to drop.
			yield* PubSub.shutdown(pubsub);
			const exit = yield* Effect.promise(() => view.exit);
			assert.isTrue(Exit.isSuccess(exit) || Exit.hasInterrupts(exit), String(exit));
		}),
	);

	it.live("close is idempotent: one promise, and a second close writes nothing more", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const view = CliUi.liveDetached<Ev, State>(detachedOptions(pubsub), envOf(fake));
			PubSub.publishUnsafe(pubsub, Start);
			PubSub.publishUnsafe(pubsub, End);
			const first = view.close();
			assert.strictEqual(view.close(), first);
			yield* Effect.promise(() => first);
			const after = fake.stdout();
			yield* Effect.promise(() => view.close());
			assert.strictEqual(fake.stdout(), after);
		}),
	);

	it.live("printAbove is false before a frame is mounted, prints above one while it is, and is false after close", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const view = CliUi.liveDetached<Ev, State>(detachedOptions(pubsub), envOf(fake));
			assert.isFalse(view.printAbove("stdout", "too early"), "no handle yet");
			yield* Effect.promise(() => view.handle);
			assert.isFalse(view.printAbove("stdout", "no run"), "set up, but no run is mounted");
			PubSub.publishUnsafe(pubsub, Start);
			yield* until(() => view.printAbove("stdout", "forwarded line"));
			PubSub.publishUnsafe(pubsub, End);
			yield* Effect.promise(() => view.close());
			assert.isFalse(view.printAbove("stdout", "too late"));
			const text = fake.stdout();
			assert.include(text, "forwarded line");
			assert.notInclude(text, "too early");
			assert.notInclude(text, "too late");
		}),
	);

	it.live("a view that dies settles close, which still resolves, and exit carries the failure", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const view = CliUi.liveDetached<Ev, State>(
				detachedOptions(pubsub, {
					reduce: (state, event) => {
						if (event._tag === "Tick") throw new Error("reduce broke");
						return reduce(state, event);
					},
				}),
				envOf(fake),
			);
			PubSub.publishUnsafe(pubsub, Start);
			PubSub.publishUnsafe(pubsub, tick(1));
			const exit = yield* Effect.promise(() => view.exit);
			assert.isTrue(Exit.hasDies(exit), String(exit));
			yield* Effect.promise(() => view.close()).pipe(Effect.timeout("2 seconds"));
		}),
	);

	it.live("an env layer that dies settles everything: handle rejects, close resolves, exit is the die", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const broken = Layer.mergeAll(envOf(fake), Layer.effectDiscard(Effect.die(new Error("env broke"))));
			const view = CliUi.liveDetached<Ev, State>(detachedOptions(pubsub), broken);
			const exit = yield* Effect.promise(() => view.exit).pipe(Effect.timeout("2 seconds"));
			assert.isTrue(Exit.hasDies(exit), String(exit));
			const handle = yield* Effect.promise(() =>
				view.handle.then(
					() => "resolved",
					(error: unknown) => `rejected: ${String(error)}`,
				),
			).pipe(Effect.timeout("2 seconds"));
			assert.match(handle, /^rejected: .*env broke/);
			yield* Effect.promise(() => view.close()).pipe(Effect.timeout("2 seconds"));
			assert.isFalse(view.printAbove("stdout", "x"));
		}),
	);

	it.live("a setup that dies inside live (a bad tickMillis) settles handle and close the same way", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const view = CliUi.liveDetached<Ev, State>(detachedOptions(pubsub, { tickMillis: -1 }), envOf(fake));
			const handle = yield* Effect.promise(() =>
				view.handle.then(
					() => "resolved",
					() => "rejected",
				),
			).pipe(Effect.timeout("2 seconds"));
			assert.strictEqual(handle, "rejected");
			yield* Effect.promise(() => view.close()).pipe(Effect.timeout("2 seconds"));
		}),
	);

	it.live("printAbove declines from the moment close is called, while the frame is still mounted", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const view = CliUi.liveDetached<Ev, State>(detachedOptions(pubsub), envOf(fake));
			PubSub.publishUnsafe(pubsub, Start);
			yield* until(() => view.printAbove("stdout", "while mounted"));
			const handle = yield* Effect.promise(() => view.handle);
			const closing = view.close();
			// The run is still mounted: the handle itself would print. The detached view must not.
			assert.isFalse(view.printAbove("stdout", "after close was called"));
			assert.isTrue(handle.printAbove("stdout", "control: the frame is still mounted"));
			yield* Effect.promise(() => closing);
			assert.notInclude(fake.stdout(), "after close was called");
			assert.include(fake.stdout(), "control: the frame is still mounted");
		}),
	);

	it.live("close releases the view's scope: the subscription is gone, so a later publish is held for nobody", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const view = CliUi.liveDetached<Ev, State>(detachedOptions(pubsub), envOf(fake));
			yield* Effect.promise(() => view.handle);
			yield* PubSub.publish(pubsub, tick(1));
			yield* Effect.promise(() => view.close());
			yield* PubSub.publish(pubsub, tick(2));
			assert.strictEqual(yield* PubSub.size(pubsub), 0, "no subscriber is left to hold it");
		}),
	);

	it.live("not interactive: nothing mounts, printAbove declines, close resolves", () =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 40, rows: 20 });
			const pubsub = yield* PubSub.unbounded<Ev>();
			const view = CliUi.liveDetached<Ev, State>(detachedOptions(pubsub, { mode: "hosted" }), envOf(fake, false));
			PubSub.publishUnsafe(pubsub, Start);
			yield* Effect.promise(() => view.handle);
			assert.isFalse(view.printAbove("stdout", "x"));
			yield* Effect.promise(() => view.close()).pipe(Effect.timeout("2 seconds"));
			assert.strictEqual(fake.stdout(), "");
		}),
	);
});
