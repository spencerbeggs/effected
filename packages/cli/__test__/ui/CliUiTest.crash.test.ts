import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { Text } from "ink";
import type { ReactElement } from "react";
import { createElement } from "react";
import { useScreenCancel } from "../../src/ui/internal/ScreenContext.js";
import type { Screen } from "../../src/ui.js";
import { CliUi, KeyTable, useKeys } from "../../src/ui.js";
import type { CliUiTestScreen } from "../../src/ui-testing.js";
import { CliUiTest } from "../../src/ui-testing.js";

const messageOf = (exit: Exit.Exit<unknown, unknown>): string => {
	if (Exit.isSuccess(exit)) return "<succeeded>";
	const error = Cause.squash(exit.cause);
	return error instanceof Error ? error.message : String(error);
};

const isDie = (exit: Exit.Exit<unknown, unknown>): boolean =>
	Exit.isFailure(exit) && exit.cause.reasons.some(Cause.isDieReason);

const Boom = (): ReactElement => {
	throw new Error("component crashed");
};

/** A thunk that throws before it returns an element. */
const throwingThunk: Screen<never> = () => {
	throw new Error("thunk crashed");
};

/**
 * A thunk compiled with classic JSX where `React` is not in scope: `<Text>x</Text>` became `React.createElement(Text,
 * null, "x")`, and evaluating it throws a `ReferenceError`, as vitest-agent's tsx repro does.
 */
const classicJsx = new Function("Text", 'return React.createElement(Text, null, "x");') as (
	text: unknown,
) => ReactElement;
const classicJsxThunk: Screen<never> = () => classicJsx(Text);

/** Every read and send of a screen, each run to its exit. */
const everyAccess = (screen: CliUiTestScreen) =>
	Effect.all({
		frame: Effect.exit(screen.frame),
		rawFrame: Effect.exit(screen.rawFrame),
		plainFrame: Effect.exit(screen.plainFrame),
		frames: Effect.exit(screen.frames),
		press: Effect.exit(screen.press("enter")),
		type: Effect.exit(screen.type("x")),
		chunk: Effect.exit(screen.chunk("enter")),
		resize: Effect.exit(screen.resize(40, 10)),
	});

const CASES: ReadonlyArray<readonly [string, Screen<never>, string]> = [
	["a throwing screen thunk", throwingThunk, "thunk crashed"],
	["a throwing component", () => createElement(Boom), "component crashed"],
	["a classic-JSX thunk with React not in scope", classicJsxThunk, "React is not defined"],
];

describe("CliUiTest.render surfaces a crash (r5 B2)", () => {
	for (const [name, screen, message] of CASES) {
		it.live(`${name}: result dies, and every read and send dies, with the thrown message within 2 s`, () =>
			Effect.gen(function* () {
				const handle = yield* CliUiTest.render(screen);
				const result = yield* Effect.exit(handle.result);
				assert.isTrue(isDie(result), `result is a die: ${messageOf(result)}`);
				assert.include(messageOf(result), message);
				const accesses = yield* everyAccess(handle);
				for (const [access, exit] of Object.entries(accesses)) {
					assert.include(messageOf(exit), message, access);
				}
			}).pipe(Effect.scoped, Effect.timeout("2 seconds")),
		);
	}

	it.live("control: a screen that draws and resolves reads its frames and never dies", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render<string>(() => createElement(Text, null, "fine"));
			assert.include(yield* handle.plainFrame, "fine");
			assert.isNotEmpty(yield* handle.frames);
		}).pipe(Effect.scoped),
	);
});

describe("CliUiTest.session surfaces a crash (r5 B2)", () => {
	for (const [name, screen, message] of CASES) {
		it.live(`${name}: next, or the next read or send, dies with the thrown message within 2 s`, () =>
			Effect.gen(function* () {
				const session = yield* CliUiTest.session();
				const fiber = yield* Effect.forkScoped(CliUi.run(screen).pipe(Effect.provide(session.layer)));
				const taken = yield* Effect.exit(session.next());
				if (Exit.isFailure(taken)) {
					assert.include(messageOf(taken), message, "next");
				} else {
					const accesses = yield* everyAccess(taken.value);
					for (const [access, exit] of Object.entries(accesses)) {
						assert.include(messageOf(exit), message, access);
					}
				}
				const program = yield* Fiber.await(fiber);
				assert.include(messageOf(program), message, "control: the program itself died with it");
			}).pipe(Effect.scoped, Effect.timeout("2 seconds")),
		);
	}

	it.live("a crash under next({ contains }) dies with the crash, not with what it waited for", () =>
		Effect.gen(function* () {
			const session = yield* CliUiTest.session();
			yield* Effect.forkScoped(CliUi.run(() => createElement(Boom)).pipe(Effect.provide(session.layer)));
			const taken = yield* Effect.exit(session.next({ contains: "never shown" }));
			assert.include(messageOf(taken), "component crashed");
		}).pipe(Effect.scoped, Effect.timeout("2 seconds")),
	);
});

/**
 * Cancels and then throws in the same key handler: the cancel settles the screen's result first, and the crash comes
 * in the same tick, before anything has unmounted. `useScreenCancel` is the hook widgets cancel through.
 */
const CancelThenCrash = (): ReactElement => {
	const cancel = useScreenCancel();
	useKeys(KeyTable.make([{ keys: ["enter"], action: "go", help: "go" }]), () => {
		cancel("escape");
		throw new Error("crashed with the cancel");
	});
	return createElement(Text, null, "armed");
};

describe("a crash in the same tick as a cancel wins (r4 re-review nit)", () => {
	it.live("render: result dies with the crash, never Cancelled", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(() => createElement(CancelThenCrash));
			assert.include(yield* handle.plainFrame, "armed", "control: it drew first");
			yield* handle.press("enter");
			const result = yield* Effect.exit(handle.result);
			assert.isTrue(isDie(result), `result is a die: ${messageOf(result)}`);
			assert.include(messageOf(result), "crashed with the cancel");
			assert.include(messageOf(yield* Effect.exit(handle.frame)), "crashed with the cancel");
		}).pipe(Effect.scoped, Effect.timeout("2 seconds")),
	);

	it.live("view: the next read dies with the crash, not a readable cancelled frame", () =>
		Effect.gen(function* () {
			const view = yield* CliUiTest.view(createElement(CancelThenCrash));
			yield* view.press("enter");
			assert.include(messageOf(yield* Effect.exit(view.frame)), "crashed with the cancel");
		}).pipe(Effect.scoped, Effect.timeout("2 seconds")),
	);

	it.live("session: the screen's next read and the program both die with the crash", () =>
		Effect.gen(function* () {
			const session = yield* CliUiTest.session();
			const fiber = yield* Effect.forkScoped(
				CliUi.run(() => createElement(CancelThenCrash)).pipe(Effect.provide(session.layer)),
			);
			const screen = yield* session.next({ contains: "armed" });
			yield* screen.press("enter");
			assert.include(messageOf(yield* Effect.exit(screen.frame)), "crashed with the cancel");
			const program = yield* Fiber.await(fiber);
			assert.isTrue(isDie(program), messageOf(program));
			assert.include(messageOf(program), "crashed with the cancel");
		}).pipe(Effect.scoped, Effect.timeout("2 seconds")),
	);

	it.live("control: Esc alone still cancels with escape, and the frames stay readable", () =>
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(() => createElement(Text, null, "calm"));
			yield* handle.press("escape");
			const result = yield* Effect.exit(handle.result);
			assert.isTrue(Option.isSome(CliUiTest.cancelReason(result)), messageOf(result));
			assert.include(yield* handle.plainFrame, "calm");
		}).pipe(Effect.scoped, Effect.timeout("2 seconds")),
	);
});
