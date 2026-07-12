import { assert, describe, it } from "@effect/vitest";
import { Cause, Duration, Effect } from "effect";
import type { RegistryEvent } from "../src/index.js";
import { RegistryObserver } from "../src/index.js";
import { emit } from "../src/RegistryEvent.js";

describe("RegistryEvent", () => {
	it.effect("emit is a no-op when no observer layer is provided", () =>
		Effect.gen(function* () {
			// Nothing to assert beyond "it does not fail and requires nothing".
			yield* emit({ _tag: "CacheMiss", package: "zod", version: "3.23.8" });
		}),
	);

	it.effect("layerCallback receives every emitted event in order", () =>
		Effect.gen(function* () {
			const events: Array<RegistryEvent> = [];
			yield* Effect.gen(function* () {
				yield* emit({ _tag: "CacheMiss", package: "zod", version: "3.23.8" });
				yield* emit({ _tag: "FetchStart", package: "zod", version: "3.23.8" });
				yield* emit({
					_tag: "PackageLoaded",
					package: "zod",
					version: "3.23.8",
					files: 2,
					source: "network",
					duration: Duration.millis(5),
				});
			}).pipe(Effect.provide(RegistryObserver.layerCallback((event) => events.push(event))));
			assert.deepStrictEqual(
				events.map((event) => event._tag),
				["CacheMiss", "FetchStart", "PackageLoaded"],
			);
			const loaded = events[2];
			if (loaded?._tag === "PackageLoaded") {
				assert.strictEqual(loaded.source, "network");
				assert.isTrue(Duration.equals(loaded.duration, Duration.millis(5)));
			}
		}),
	);

	it.effect("layerNoop drops events without failing", () =>
		emit({ _tag: "CacheMiss", package: "zod", version: "1.0.0" }).pipe(Effect.provide(RegistryObserver.layerNoop)),
	);

	it.effect("a throwing callback stays a defect, not a typed failure", () =>
		Effect.gen(function* () {
			const exit = yield* Effect.exit(
				emit({ _tag: "CacheMiss", package: "zod", version: "1.0.0" }).pipe(
					Effect.provide(
						RegistryObserver.layerCallback(() => {
							throw new Error("host bug");
						}),
					),
				),
			);
			assert.isTrue(exit._tag === "Failure");
			// A typed failure would also satisfy the tag check — assert the
			// cause actually carries a die.
			if (exit._tag === "Failure") {
				assert.isTrue(Cause.hasDies(exit.cause));
			}
		}),
	);
});
