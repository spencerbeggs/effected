import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Text } from "ink";
import type { ReactElement } from "react";
import { createElement, useState } from "react";
import { CliUi, KeyTable, useKeys } from "../../src/ui.js";
import { CliUiTest } from "../../src/ui-testing.js";

const RIGHT = KeyTable.make<"step">([{ keys: ["right"], action: "step", help: "step" }]);

/** The bug class: the handler steps from the count its render captured. */
const ClosureStepper = (): ReactElement => {
	const [count, setCount] = useState(0);
	useKeys(RIGHT, () => setCount(count + 1));
	return createElement(Text, null, `count=${count}`);
};

/** The fix: a functional update steps from the current count. */
const FunctionalStepper = (): ReactElement => {
	const [count, setCount] = useState(0);
	useKeys(RIGHT, () => setCount((current) => current + 1));
	return createElement(Text, null, `count=${count}`);
};

const counted = (
	component: () => ReactElement,
	drive: (handle: {
		readonly press: (...keys: ReadonlyArray<"right">) => Effect.Effect<void>;
		readonly chunk: (...keys: ReadonlyArray<"right">) => Effect.Effect<void>;
	}) => Effect.Effect<void>,
) =>
	Effect.scoped(
		Effect.gen(function* () {
			const handle = yield* CliUiTest.render(() => createElement(component));
			yield* drive(handle);
			return (yield* handle.plainFrame).trim();
		}),
	);

describe("chunk: several keys in one stdin write", () => {
	it.effect("a render-closure handler steps once for two keys in one chunk, but twice when pressed one by one", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* counted(ClosureStepper, (handle) => handle.chunk("right", "right")), "count=1");
			assert.strictEqual(yield* counted(ClosureStepper, (handle) => handle.press("right", "right")), "count=2");
		}),
	);

	it.effect("a functional update steps twice either way", () =>
		Effect.gen(function* () {
			assert.strictEqual(yield* counted(FunctionalStepper, (handle) => handle.chunk("right", "right")), "count=2");
			assert.strictEqual(yield* counted(FunctionalStepper, (handle) => handle.press("right", "right")), "count=2");
		}),
	);

	it.effect("a session's screens chunk too", () =>
		Effect.gen(function* () {
			const session = yield* CliUiTest.session();
			yield* Effect.forkScoped(CliUi.run(() => createElement(ClosureStepper)).pipe(Effect.provide(session.layer)));
			const screen = yield* session.next({ contains: "count=0" });
			yield* screen.chunk("right", "right");
			assert.strictEqual((yield* screen.plainFrame).trim(), "count=1");
		}).pipe(Effect.scoped),
	);
});
