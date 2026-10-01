import { assert, describe, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber } from "effect";
import { Text } from "ink";
import type { ReactElement } from "react";
import { createElement } from "react";
import type { Screen } from "../../src/ui.js";
import { CliUi } from "../../src/ui.js";
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
