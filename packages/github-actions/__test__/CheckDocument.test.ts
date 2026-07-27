import { assert, describe, it } from "@effect/vitest";
import type { Duration } from "effect";
import { Effect, Fiber, Option, Ref, Result } from "effect";
import { TestClock } from "effect/testing";
import { CheckDocument, CheckDocumentError, CheckReport } from "../src/CheckDocument.js";
import { ManagedDocument } from "../src/ManagedDocument.js";

const NS = "savvy-web";
const KEY = "release-validation";

/** One region per check — the layout the reconciler is designed around. */
const perCheck = (checks: ReadonlyMap<string, CheckReport>): ReadonlyArray<readonly [string, string]> =>
	[...checks].map(([check, entry]) => [
		`check-${check}`,
		`${entry.state}${entry.outcome === undefined ? "" : ` — ${entry.outcome}`}`,
	]);

interface HarnessOptions {
	readonly render?: (checks: ReadonlyMap<string, CheckReport>) => ReadonlyArray<readonly [string, string]>;
	readonly sink?: (rendered: string) => Effect.Effect<unknown, unknown>;
	readonly initial?: string;
	readonly quiet?: Duration.Input;
	readonly maxWait?: Duration.Input;
	readonly sinkTimeout?: Duration.Input;
}

/** A recording sink plus the layer wired to it. */
const harness = (options: HarnessOptions = {}) =>
	Effect.gen(function* () {
		const writes = yield* Ref.make<ReadonlyArray<string>>([]);
		const layer = CheckDocument.layer({
			namespace: NS,
			key: KEY,
			...(options.initial === undefined ? {} : { initial: options.initial }),
			render: options.render ?? perCheck,
			sink: options.sink ?? ((rendered) => Ref.update(writes, (all) => [...all, rendered])),
			debounce: { quiet: options.quiet ?? "500 millis", maxWait: options.maxWait ?? "3 seconds" },
			...(options.sinkTimeout === undefined ? {} : { sinkTimeout: options.sinkTimeout }),
		});
		return { writes, layer };
	});

describe("CheckDocument", () => {
	describe("the debounced reconcile", () => {
		it.effect("a pass-then-fail burst inside the debounce window leaves the document showing fail", () =>
			Effect.gen(function* () {
				const { writes, layer } = yield* harness();
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("build", CheckReport.make({ state: "pass" }));
					yield* doc.report("build", CheckReport.make({ state: "fail" }));
					yield* TestClock.adjust("500 millis");
					const all = yield* Ref.get(writes);
					// ONE write for the burst, carrying its FINAL state. A
					// leading-edge debounce would have published `pass` and left it.
					assert.strictEqual(all.length, 1);
					const text = all[0] ?? "";
					assert.include(text, "fail");
					assert.notInclude(text, "pass");
				}).pipe(Effect.provide(layer));
			}),
		);

		it.effect("nothing is written before the quiet window elapses", () =>
			Effect.gen(function* () {
				const { writes, layer } = yield* harness();
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("build", CheckReport.make({ state: "running" }));
					yield* TestClock.adjust("499 millis");
					assert.deepStrictEqual(yield* Ref.get(writes), []);
					yield* TestClock.adjust("1 millis");
					assert.strictEqual((yield* Ref.get(writes)).length, 1);
				}).pipe(Effect.provide(layer));
			}),
		);

		it.effect("reconciling unchanged state issues no write", () =>
			Effect.gen(function* () {
				const { writes, layer } = yield* harness();
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("build", CheckReport.make({ state: "pass", outcome: "clean" }));
					yield* TestClock.adjust("500 millis");
					assert.strictEqual((yield* Ref.get(writes)).length, 1);
					// The same state again: same render, byte-identical document —
					// neither the debounced pass nor an explicit flush may write.
					yield* doc.report("build", CheckReport.make({ state: "pass", outcome: "clean" }));
					yield* TestClock.adjust("500 millis");
					yield* doc.flush;
					assert.strictEqual((yield* Ref.get(writes)).length, 1);
				}).pipe(Effect.provide(layer));
			}),
		);

		it.effect("a steady stream of reports still writes by maxWait — the staleness bound", () =>
			Effect.gen(function* () {
				const { writes, layer } = yield* harness({ quiet: "500 millis", maxWait: "2 seconds" });
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					// Reports every 400ms: the quiet window NEVER elapses.
					for (let step = 0; step < 5; step += 1) {
						yield* doc.report("build", CheckReport.make({ state: "running", outcome: `step ${step}` }));
						yield* TestClock.adjust("400 millis");
					}
					const all = yield* Ref.get(writes);
					assert.strictEqual(all.length, 1, "exactly one write, at the staleness bound");
					assert.include(all[0] ?? "", "step 4", "and it carries the latest state, not the first");
				}).pipe(Effect.provide(layer));
			}),
		);
	});

	describe("replacement, never appending", () => {
		it.effect("a second resolution updates its region in place rather than appending", () =>
			Effect.gen(function* () {
				const { writes, layer } = yield* harness();
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("build", CheckReport.make({ state: "pass" }));
					yield* doc.flush;
					// Resolution is NOT terminal: the check resolves again.
					yield* doc.report("build", CheckReport.make({ state: "fail" }));
					yield* doc.flush;
					const all = yield* Ref.get(writes);
					assert.strictEqual(all.length, 2);
					const final = all[1] ?? "";
					assert.strictEqual(
						final.split(`BEGIN ${NS}.${KEY}.check-build`).length - 1,
						1,
						"one region for the check, not one per resolution",
					);
					const parsed = Result.getOrThrow(ManagedDocument.parseResult({ namespace: NS, key: KEY, text: final }));
					assert.deepStrictEqual(parsed.region("check-build"), Option.some("fail"));
				}).pipe(Effect.provide(layer));
			}),
		);

		it.effect("human content seeded through `initial` survives every reconcile", () =>
			Effect.gen(function* () {
				const human = "A human wrote this PR description.";
				const { writes, layer } = yield* harness({ initial: human });
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("build", CheckReport.make({ state: "running" }));
					yield* doc.flush;
					yield* doc.report("build", CheckReport.make({ state: "pass" }));
					yield* doc.flush;
					const all = yield* Ref.get(writes);
					for (const text of all) {
						assert.include(text, human);
					}
				}).pipe(Effect.provide(layer));
			}),
		);
	});

	describe("lifecycle", () => {
		it.effect("the scope closing inside the quiet window still lands the final state", () =>
			Effect.gen(function* () {
				const { writes, layer } = yield* harness();
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("build", CheckReport.make({ state: "pass" }));
					// No adjust, no flush: the scope closes mid-window.
				}).pipe(Effect.provide(layer));
				const all = yield* Ref.get(writes);
				assert.strictEqual(all.length, 1, "the finalizer flushed the last burst");
				assert.include(all[0] ?? "", "pass");
			}),
		);

		it.effect("a failing background pass is retried, not fatal", () =>
			Effect.gen(function* () {
				const broken = yield* Ref.make(true);
				const writes = yield* Ref.make<ReadonlyArray<string>>([]);
				const layer = CheckDocument.layer({
					namespace: NS,
					key: KEY,
					render: perCheck,
					sink: (rendered) =>
						Effect.gen(function* () {
							if (yield* Ref.get(broken)) {
								return yield* Effect.fail("the API said no");
							}
							yield* Ref.update(writes, (all) => [...all, rendered]);
						}),
					debounce: { quiet: "500 millis", maxWait: "3 seconds" },
				});
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("build", CheckReport.make({ state: "running" }));
					yield* TestClock.adjust("500 millis");
					assert.deepStrictEqual(yield* Ref.get(writes), [], "the write failed and was logged");
					yield* Ref.set(broken, false);
					yield* doc.report("build", CheckReport.make({ state: "pass" }));
					yield* TestClock.adjust("500 millis");
					const all = yield* Ref.get(writes);
					assert.strictEqual(all.length, 1, "the daemon survived the failure and wrote the next state");
					assert.include(all[0] ?? "", "pass");
				}).pipe(Effect.provide(layer));
			}),
		);

		it.effect("checks reads back the registry in first-report order, last write winning", () =>
			Effect.gen(function* () {
				const { layer } = yield* harness();
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("alpha", CheckReport.make({ state: "running" }));
					yield* doc.report("beta", CheckReport.make({ state: "running" }));
					yield* doc.report("alpha", CheckReport.make({ state: "fail", outcome: "boom" }));
					const checks = yield* doc.checks;
					assert.deepStrictEqual([...checks.keys()], ["alpha", "beta"]);
					assert.strictEqual(checks.get("alpha")?.state, "fail");
					assert.strictEqual(checks.get("alpha")?.outcome, "boom");
				}).pipe(Effect.provide(layer));
			}),
		);
	});

	describe("typed failures — every kind fires", () => {
		it.effect("kind render: a reported detail carrying a region marker is refused", () =>
			Effect.gen(function* () {
				const { layer } = yield* harness({
					render: () => [["body", `<!-- --- END ${NS}.${KEY}.body MANAGED REGION --- -->`]],
				});
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("build", CheckReport.make({ state: "pass" }));
					const failure = yield* Effect.flip(doc.flush);
					assert.instanceOf(failure, CheckDocumentError);
					assert.strictEqual(failure.kind, "render");
				}).pipe(Effect.provide(layer));
			}),
		);

		it.effect("kind sink: the write path's failure surfaces from flush", () =>
			Effect.gen(function* () {
				const { layer } = yield* harness({ sink: () => Effect.fail("403: resource not accessible") });
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("build", CheckReport.make({ state: "pass" }));
					const failure = yield* Effect.flip(doc.flush);
					assert.strictEqual(failure.kind, "sink");
				}).pipe(Effect.provide(layer));
			}),
		);

		it.effect("kind sink: a HUNG sink fails at the timeout bound instead of stalling the reconciler", () =>
			Effect.gen(function* () {
				// The pass holds the single permit and the finalizer's last flush
				// waits on it — unbounded, a sink that never resolves would stall
				// every later pass AND scope teardown. Hang only the FIRST call so
				// the finalizer's own flush can complete the teardown cleanly.
				const calls = yield* Ref.make(0);
				const { layer } = yield* harness({
					sink: () =>
						Effect.flatMap(
							Ref.updateAndGet(calls, (n) => n + 1),
							(n) => (n === 1 ? Effect.never : Effect.void),
						),
					sinkTimeout: "1 second",
				});
				yield* Effect.gen(function* () {
					const doc = yield* CheckDocument;
					yield* doc.report("build", CheckReport.make({ state: "pass" }));
					const flipped = yield* Effect.forkChild(Effect.flip(doc.flush));
					yield* TestClock.adjust("1 second");
					const failure = yield* Fiber.join(flipped);
					assert.instanceOf(failure, CheckDocumentError);
					assert.strictEqual(failure.kind, "sink");
				}).pipe(Effect.provide(layer));
			}),
		);
	});

	describe("test double", () => {
		it.effect("an unstubbed member dies loudly, naming itself", () =>
			Effect.gen(function* () {
				const doc = yield* CheckDocument;
				const exit = yield* Effect.exit(doc.report("build", CheckReport.make({ state: "pass" })));
				assert.isTrue(exit._tag === "Failure");
			}).pipe(Effect.provide(CheckDocument.layerTest())),
		);

		it.effect("layerTest serves a stubbed member", () =>
			Effect.gen(function* () {
				const doc = yield* CheckDocument;
				yield* doc.report("build", CheckReport.make({ state: "pass" }));
			}).pipe(Effect.provide(CheckDocument.layerTest({ report: () => Effect.void }))),
		);
	});
});
