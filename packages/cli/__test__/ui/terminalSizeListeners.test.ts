import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { Box, Text, render, useStdout } from "ink";
import type { ReactElement, ReactNode } from "react";
import { createElement, useEffect, useReducer } from "react";
import { CliTheme, Doc } from "../../src/index.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import type { UiContextValue, ViewportRow } from "../../src/ui.js";
import { CliUi, DocView, UiProvider, Viewport, useTerminalSize } from "../../src/ui.js";

/** Rows past Node's default `maxListeners` of 10, twice over. */
const MANY = 25;

/** Let pending timers and effects run. */
const settle = (millis: number) => Effect.promise(() => new Promise((resolve) => setTimeout(resolve, millis)));

/**
 * Collect every process `warning` while `use` runs. The listener is removed by a finalizer, so a failure part way
 * through cannot leave it attached for a later test.
 */
const collectingWarnings = <A, E, R>(use: (warnings: ReadonlyArray<Error>) => Effect.Effect<A, E, R>) =>
	Effect.acquireUseRelease(
		Effect.sync(() => {
			const warnings: Array<Error> = [];
			const onWarning = (warning: Error): void => {
				warnings.push(warning);
			};
			process.on("warning", onWarning);
			return { warnings, onWarning };
		}),
		({ warnings }) => use(warnings),
		({ onWarning }) => Effect.sync(() => process.off("warning", onWarning)),
	);

/**
 * Mount `tree` with Ink's own `render` on fake streams, read stdout's `resize` listener count while it is mounted,
 * resize, unmount, and collect any process `warning` raised along the way. The instance is unmounted by a finalizer
 * too, so a failure part way through cannot leave it mounted.
 */
const mount = (tree: ReactNode) =>
	collectingWarnings((warnings) =>
		Effect.gen(function* () {
			const fake = makeFakeStreams({ columns: 80, rows: 40 });
			const stdout = fake.streams.stdout;
			const { mounted, resized } = yield* Effect.acquireUseRelease(
				Effect.sync(() =>
					render(tree, {
						stdin: fake.streams.stdin,
						stdout,
						stderr: fake.streams.stderr,
						debug: true,
						patchConsole: false,
						exitOnCtrlC: false,
						interactive: true,
					}),
				),
				() =>
					Effect.gen(function* () {
						// Effects run after the commit; let them subscribe before counting.
						yield* settle(20);
						const mounted = stdout.listenerCount("resize");
						fake.resize(60, 40);
						yield* settle(20);
						return { mounted, resized: fake.stdout() };
					}),
				(instance) =>
					Effect.promise(() => {
						instance.unmount();
						return instance.waitUntilExit().catch(() => undefined);
					}),
			);
			const unmounted = stdout.listenerCount("resize");
			// Node emits the warning on the next tick after the listener that crossed the limit.
			yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)));
			return { mounted, unmounted, resized, warnings: [...warnings] };
		}),
	);

const column = (...children: ReadonlyArray<ReactElement>): ReactElement =>
	createElement(Box, { flexDirection: "column" }, ...children);

const provided = (value: UiContextValue, child: ReactElement): ReactElement =>
	createElement(UiProvider, { value }, child);

const docViews = (n: number): ReactElement =>
	column(...Array.from({ length: n }, (_, i) => createElement(DocView, { key: i, doc: Doc.line(`row ${i}`) })));

const viewport = (n: number): ReactElement => {
	const rows: ReadonlyArray<ViewportRow> = Array.from({ length: n }, (_, i) => ({ _tag: "Item", key: `k${i}` }));
	return createElement(Viewport.View, {
		rows,
		state: Viewport.init(n, n),
		renderRow: (row: ViewportRow) => createElement(DocView, { doc: Doc.line(row._tag === "Item" ? row.key : "") }),
	});
};

/** The width a row reads, so a resize is visible in the frame. */
const Width = (props: { readonly label: string }): ReactElement =>
	createElement(Text, null, `${props.label}=${useTerminalSize().columns}`);

/** The per-instance shape `useTerminalSize` had: one `resize` listener per mounted component. */
const PerInstance = (): ReactElement => {
	const { stdout } = useStdout();
	const [, redraw] = useReducer((count: number) => count + 1, 0);
	useEffect(() => {
		stdout.on("resize", redraw);
		return () => {
			stdout.off("resize", redraw);
		};
	}, [stdout]);
	return createElement(Text, null, "x");
};

describe("useTerminalSize holds one resize listener per stdout, however many components follow it", () => {
	it.live(`${MANY} DocViews hold as many resize listeners as one, and raise no warning`, () =>
		Effect.gen(function* () {
			const value = yield* CliUi.context.pipe(Effect.provide(CliTheme.layerTest()));
			const one = yield* mount(provided(value, docViews(1)));
			const many = yield* mount(provided(value, docViews(MANY)));
			assert.strictEqual(many.mounted, one.mounted);
			assert.deepStrictEqual(many.warnings, []);
			// Every listener the rows added is gone with them.
			assert.strictEqual(many.unmounted, 0);
		}),
	);

	it.live(`a Viewport of ${MANY} DocView rows holds as many resize listeners as one of 1`, () =>
		Effect.gen(function* () {
			const value = yield* CliUi.context.pipe(Effect.provide(CliTheme.layerTest()));
			const one = yield* mount(provided(value, viewport(1)));
			const many = yield* mount(provided(value, viewport(MANY)));
			assert.strictEqual(many.mounted, one.mounted);
			assert.deepStrictEqual(many.warnings, []);
			assert.strictEqual(many.unmounted, 0);
		}),
	);

	it.live("every component sharing the listener still follows a resize", () =>
		Effect.gen(function* () {
			const value = yield* CliUi.context.pipe(Effect.provide(CliTheme.layerTest()));
			const labels = Array.from({ length: MANY }, (_, i) => `w${i}`);
			const { resized } = yield* mount(
				provided(value, column(...labels.map((label) => createElement(Width, { key: label, label })))),
			);
			for (const label of labels) assert.include(resized, `${label}=59`);
		}),
	);

	it.live("control: the per-instance shape scales with the rows and raises MaxListenersExceededWarning", () =>
		Effect.gen(function* () {
			const one = yield* mount(column(createElement(PerInstance)));
			const many = yield* mount(
				column(...Array.from({ length: MANY }, (_, i) => createElement(PerInstance, { key: i }))),
			);
			assert.strictEqual(many.mounted - one.mounted, MANY - 1);
			assert.isTrue(
				many.warnings.some((warning) => warning.name === "MaxListenersExceededWarning"),
				String(many.warnings),
			);
		}),
	);
});
