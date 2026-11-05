// The live per-schema progress view. This is the ONE module in the package that imports Ink and React, and `execute`
// reaches it by dynamic import only for a person on a terminal, so an agent, CI or piped run loads neither.

import type { LiveOptions } from "@effected/cli-kit/ui";
import { CliUi, useGlyphs, useStyle } from "@effected/cli-kit/ui";
import type { SchemaProgress, SchemaReport } from "@effected/engine/schema";
import { Console, Effect, PubSub } from "effect";
import { Box, Text } from "ink";
import type { ReactElement } from "react";
import { createElement } from "react";

/** What the view folds: the engine's progress, and the end of the walk, whether it finished or failed. */
export type LiveEvent = SchemaProgress | { readonly _tag: "Ended" };

type RowToken = "muted" | "success" | "warning" | "error";

interface Row {
	readonly name: string;
	/** Whether the row still spins. */
	readonly pending: boolean;
	readonly label: string;
	readonly token: RowToken;
}

/** One row per schema. @internal */
export interface LiveState {
	readonly rows: ReadonlyArray<Row>;
}

const SETTLED: Readonly<Record<SchemaReport["outcome"], { readonly label: string; readonly token: RowToken }>> = {
	written: { label: "written", token: "success" },
	unchanged: { label: "unchanged", token: "muted" },
	"would-write": { label: "would write", token: "warning" },
	drift: { label: "drift", token: "error" },
	held: { label: "held", token: "muted" },
	"gate-failed": { label: "gate failed", token: "error" },
};

const reduce = (state: LiveState, event: LiveEvent): LiveState => {
	const update = (name: string, row: Omit<Row, "name">): LiveState => ({
		rows: state.rows.map((current) => (current.name === name ? { name, ...row } : current)),
	});
	switch (event._tag) {
		case "Started":
			return {
				rows: event.names.map((name) => ({ name, pending: true, label: "checking", token: "muted" })),
			};
		case "SchemaChecked":
			// What the check alone established; a sibling can still hold it, which `SchemaDone` settles.
			return update(
				event.name,
				event.blocked
					? { pending: true, label: "gate failed", token: "error" }
					: event.verdict === "drift"
						? { pending: true, label: "drift", token: "error" }
						: event.change === "none"
							? { pending: true, label: "clean", token: "muted" }
							: { pending: true, label: event.change, token: "warning" },
			);
		case "SchemaDone":
			return update(event.report.name, { pending: false, ...SETTLED[event.report.outcome] });
		case "Ended":
			return state;
	}
};

const RowView = ({ row, frame }: { readonly row: Row; readonly frame: number }): ReactElement => {
	const glyphs = useGlyphs();
	const name = useStyle("emphasis");
	const label = useStyle(row.token);
	const mark = row.pending ? (glyphs.spinner[frame % glyphs.spinner.length] ?? "") : glyphs.bullet;
	return createElement(
		Text,
		null,
		createElement(Text, label, `${mark} `),
		createElement(Text, name, row.name),
		createElement(Text, label, ` ${row.label}`),
	);
};

/**
 * The view's options, less the events: one value, so the test drives what the command runs.
 *
 * @internal
 */
export const liveProgress: Omit<LiveOptions<LiveEvent, LiveState>, "events"> = {
	initial: { rows: [] },
	reduce,
	render: (state, frame) =>
		createElement(
			Box,
			{ flexDirection: "column" },
			...state.rows.map((row) => createElement(RowView, { key: row.name, row, frame })),
		),
	isStart: (event) => event._tag === "Started",
	isTerminal: (event) => event._tag === "Ended",
};

/**
 * Run the walk under the view: its progress feeds the rows, and its log lines write above the frame.
 *
 * @remarks
 * The frame is committed before the walk's answer is handed back, whichever way it ended, so what follows prints
 * below it and a walk that failed keeps the rows it reached.
 *
 * @internal
 */
export const withLiveProgress = <A, E, R>(
	walk: (onProgress: (event: SchemaProgress) => Effect.Effect<void>) => Effect.Effect<A, E, R>,
) =>
	Effect.gen(function* () {
		const pubsub = yield* PubSub.unbounded<LiveEvent>();
		// Subscribed before anything publishes, and handed over directly, so no event is missed.
		const events = yield* PubSub.subscribe(pubsub);
		const view = yield* CliUi.live({ ...liveProgress, events });
		const exit = yield* Effect.exit(
			walk((event) => Effect.asVoid(PubSub.publish(pubsub, event))).pipe(
				Effect.provideService(Console.Console, view.logConsole),
			),
		);
		yield* PubSub.publish(pubsub, { _tag: "Ended" });
		yield* view.close;
		return yield* exit;
	}).pipe(Effect.scoped);
