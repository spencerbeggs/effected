// A DocView in a live frame shows a path as the run's `displayPath` says, as the same run's `final` and Doc.print do.
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, PubSub } from "effect";
import { createElement } from "react";
import { CliTheme, Doc } from "../../src/index.js";
import { displayPathLayer } from "../../src/internal/displayPath.js";
import { makeFakeStreams } from "../../src/ui/testing/fakeStreams.js";
import { screenAfter } from "../../src/ui/testing/terminalModel.js";
import { CliUi, DocView } from "../../src/ui.js";
import type { Ev, State } from "../helpers/live.js";
import { End, Start, liveOn, optionsOf } from "../helpers/live.js";

const frame = (_state: State) => createElement(DocView, { doc: [Doc.paragraph(Doc.file("/repo/src/a.ts"))] });

const drawn = (relative: boolean) =>
	Effect.gen(function* () {
		const fake = makeFakeStreams({ columns: 60, rows: 20 });
		const pubsub = yield* PubSub.unbounded<Ev>();
		const subscription = yield* PubSub.subscribe(pubsub);
		const handle = yield* liveOn(fake, optionsOf(subscription, { render: frame }));
		yield* PubSub.publishAll(pubsub, [Start, End]);
		yield* handle.close.pipe(Effect.timeout("2 seconds"));
		return screenAfter(fake.stdout()).join("\n");
	}).pipe(Effect.scoped, relative ? Effect.provide(displayPathLayer({ relativeTo: "/repo" })) : (self) => self);

describe("DocView follows the run's displayPath", () => {
	it.live("a live frame shows the path relative to the root the run set", () =>
		Effect.gen(function* () {
			const text = yield* drawn(true);
			assert.include(text, "src/a.ts");
			assert.notInclude(text, "/repo/src/a.ts");
		}),
	);

	it.live("control: with no displayPath the frame shows the absolute path", () =>
		Effect.gen(function* () {
			assert.include(yield* drawn(false), "/repo/src/a.ts");
		}),
	);

	it.effect("CliUi.context carries the run's displayPath to a tree the kit did not mount", () =>
		Effect.gen(function* () {
			const value = yield* CliUi.context.pipe(
				Effect.provide(Layer.mergeAll(CliTheme.layerTest(), displayPathLayer({ relativeTo: "/repo" }))),
			);
			assert.strictEqual(
				Option.fromNullishOr(value.displayPath).pipe(
					Option.map((f) => f("/repo/x.ts")),
					Option.getOrUndefined,
				),
				"x.ts",
			);
		}),
	);
});
