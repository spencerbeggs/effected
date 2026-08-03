import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import {
	Context,
	Duration,
	Effect,
	Exit,
	Fiber,
	FileSystem,
	Layer,
	Option,
	Path,
	Result,
	Schema,
	Scope,
	Stream,
	SubscriptionRef,
} from "effect";
import { Envelope, Journal, JsonlEvent, Line } from "../../src/index.js";

/**
 * The only tests that provide a platform layer — the boundary discipline made
 * visible. Everything provable against a double lives in `Journal.test.ts`;
 * what is here needs a real filesystem, principally `O_APPEND` behavior under
 * concurrency, which a double would only pretend to model.
 */

const Started = JsonlEvent.make("started", {
	data: Schema.Struct({ round: Schema.Number, phase: Schema.String }),
});
const events = [Started] as const;

class TmpJournal extends Journal.Service<TmpJournal>()("test/TmpJournal", { events }) {}

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

/** Run `body` against a real journal file in a scoped temp directory. */
const withJournal = <A, E>(
	body: (journal: TmpJournal["Service"], path: string, fs: FileSystem.FileSystem) => Effect.Effect<A, E>,
) =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const dir = yield* fs.makeTempDirectoryScoped();
		const file = path.join(dir, "journal.jsonl");
		// Bound ONCE, as the const-binding rule requires.
		const layer = TmpJournal.layer({ path: file });
		return yield* Effect.gen(function* () {
			const journal = yield* TmpJournal;
			yield* journal.create;
			return yield* body(journal, file, fs);
		}).pipe(Effect.provide(layer));
	}).pipe(Effect.scoped, Effect.provide(platform));

describe("Journal integration", () => {
	it.effect("appends land on a real file and read back", () =>
		withJournal((journal, path, fs) =>
			Effect.gen(function* () {
				yield* journal.append("started", { round: 1, phase: "a" });
				yield* journal.append("started", { round: 2, phase: "b" });
				const text = yield* fs.readFileString(path);
				const decoded = Envelope.decodeAllResult(events, text);
				assert.deepStrictEqual(decoded.map(Result.isSuccess), [true, true]);
			}),
		),
	);

	it.effect("concurrent appends through one journal interleave no bytes", () =>
		withJournal((journal, path, fs) =>
			Effect.gen(function* () {
				// Payloads large enough that an unserialized writer would visibly
				// interleave, and distinct enough that a torn line is unmistakable.
				const rounds = Array.from({ length: 40 }, (_, index) => index);
				yield* Effect.forEach(rounds, (round) => journal.append("started", { round, phase: "x".repeat(200) }), {
					concurrency: "unbounded",
				});

				const text = yield* fs.readFileString(path);
				const lines = Line.split(text);
				assert.strictEqual(lines.length, rounds.length, "one line per append, none merged or split");
				assert.isTrue(
					lines.every((line) => line.terminated),
					"every line is terminated",
				);

				// The real assertion: every line decodes as a complete envelope, and
				// the set of rounds is exactly what was written. A torn interleave
				// would corrupt at least one line's JSON.
				const decoded = Envelope.decodeAllResult(events, text);
				assert.isTrue(decoded.every(Result.isSuccess), "no line was torn by interleaving");
				const seen = decoded
					.filter(Result.isSuccess)
					.map((result) => (result.success.data as { readonly round: number }).round)
					.sort((a, b) => a - b);
				assert.deepStrictEqual(seen, rounds);
			}),
		),
	);

	it.effect("latest survives a process-style reopen — a second layer reads the first's writes", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const dir = yield* fs.makeTempDirectoryScoped();
			const file = path.join(dir, "journal.jsonl");

			const first = TmpJournal.layer({ path: file });
			yield* Effect.gen(function* () {
				const journal = yield* TmpJournal;
				yield* journal.create;
				yield* journal.append("started", { round: 11, phase: "written-by-first" });
			}).pipe(Effect.provide(first));

			// A separate layer — a stand-in for a second process — seeds `latest`
			// from disk at construction and sees the first's append.
			const second = TmpJournal.layer({ path: file });
			const seen = yield* Effect.gen(function* () {
				const journal = yield* TmpJournal;
				return yield* SubscriptionRef.get(journal.latest);
			}).pipe(Effect.provide(second));

			const envelope = Option.getOrThrow(seen);
			assert.strictEqual(envelope.event, "started");
			assert.deepStrictEqual(envelope.data, { round: 11, phase: "written-by-first" });
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("a real BOM'd journal reads cleanly with post-BOM offsets", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const dir = yield* fs.makeTempDirectoryScoped();
			const file = path.join(dir, "bom.jsonl");
			const line = `${JSON.stringify({
				at: "2026-01-01T00:00:00.000Z",
				event: "started",
				data: { round: 1, phase: "p" },
			})}\n`;
			yield* fs.writeFile(file, new TextEncoder().encode(`﻿${line}`));

			const layer = TmpJournal.layer({ path: file });
			const seen = yield* Effect.gen(function* () {
				const journal = yield* TmpJournal;
				return yield* SubscriptionRef.get(journal.latest);
			}).pipe(Effect.provide(layer));

			const envelope = Option.getOrThrow(seen);
			assert.strictEqual(envelope.line.offset, 0, "offsets are post-BOM relative");
			assert.deepStrictEqual(envelope.data, { round: 1, phase: "p" });
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	// THE FLAGSHIP — acceptance criterion 3.
	//
	// `it.live` rather than `it.effect`: this one waits on a REAL filesystem
	// event, and under the TestClock a timeout could never fire, so a failure
	// would present as a hang instead of a failure.
	it.live("TWO journal layers over ONE file observe each other's appends", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const dir = yield* fs.makeTempDirectoryScoped();
			const file = path.join(dir, "shared.jsonl");

			// Two independently-built layers over the same path — the stand-in for
			// two processes, or two MCP servers in sibling repos.
			const writerLayer = TmpJournal.layer({ path: file });
			const readerLayer = TmpJournal.layer({ path: file });

			const writerScope = yield* Scope.make();
			const readerScope = yield* Scope.make();
			const writerContext = yield* Layer.build(writerLayer).pipe(Effect.provideService(Scope.Scope, writerScope));
			const writer = Context.get(writerContext, TmpJournal);
			yield* writer.create;

			const readerContext = yield* Layer.build(readerLayer).pipe(Effect.provideService(Scope.Scope, readerScope));
			const reader = Context.get(readerContext, TmpJournal);

			// The reader waits on its own subscription. No polling loop, no sleep —
			// the fiber simply blocks until the watcher publishes.
			const observing = yield* Effect.forkChild(Stream.runCollect(reader.changes().pipe(Stream.take(1))));

			yield* writer.append("started", { round: 1, phase: "from-the-writer" });

			const seen = yield* Fiber.join(observing);
			assert.strictEqual(seen.length, 1, "the reader observed the writer's append");
			assert.deepStrictEqual(seen[0]?.data, { round: 1, phase: "from-the-writer" });

			yield* Scope.close(readerScope, Exit.void);
			yield* Scope.close(writerScope, Exit.void);
		}).pipe(Effect.scoped, Effect.provide(platform), Effect.timeout(Duration.seconds(20))),
	);
});
