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
} from "effect";
import { Envelope, Journal, JsonlEvent, Line } from "../../src/index.js";
import { NodeJournalWatcher } from "../../src/node.js";

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

/** The temp file's path, known only at run time — what the config `Effect` reads. */
class TmpPath extends Context.Service<TmpPath, string>()("test/TmpPath") {}

class TmpJournal extends Journal.Service<TmpJournal>()("test/TmpJournal", {
	events,
	config: Effect.gen(function* () {
		return { path: yield* TmpPath };
	}),
}) {}

/** The journal at `file`. Each BUILD of it is its own journal, as a separate process's would be. */
const journalAt = (file: string) => TmpJournal.layer.pipe(Layer.provide(Layer.succeed(TmpPath, file)));

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer, NodeJournalWatcher.layer);

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
		const layer = journalAt(file);
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

	it.effect("a FOREIGN writer's line between two appends leaves offsets that tile the file", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const dir = yield* fs.makeTempDirectoryScoped();
			const file = path.join(dir, "two-writers.jsonl");
			const layer = journalAt(file);
			const scope = yield* Scope.make();
			const context = yield* Layer.build(layer).pipe(Effect.provideService(Scope.Scope, scope));
			const journal = Context.get(context, TmpJournal);
			yield* journal.create;

			const first = yield* journal.append("started", { round: 1, phase: "ours" });

			// A cooperating foreign writer, honouring the contract exactly: ONE
			// `writeAll` of a complete line to a handle opened `O_APPEND`. Whether
			// our watcher has ingested it yet is a race we must not depend on — and
			// the point of the case: our next append lands after these bytes on
			// disk, wherever our own cursor happened to be.
			const foreign = `${JSON.stringify({
				at: "2026-01-01T00:00:00.000Z",
				event: "started",
				data: { round: 2, phase: "theirs" },
			})}\n`;
			yield* Effect.scoped(
				Effect.gen(function* () {
					const handle = yield* fs.open(file, { flag: "a" });
					yield* handle.writeAll(new TextEncoder().encode(foreign));
				}),
			);

			const third = yield* journal.append("started", { round: 3, phase: "ours" });

			const text = yield* fs.readFileString(file);
			const lines = Line.split(text);
			assert.strictEqual(lines.length, 3, "three lines, one per writer's write");
			assert.strictEqual(first.position.offset, lines[0]?.offset, "our first append is where the file says");
			assert.strictEqual(first.position.end, lines[0]?.end);
			assert.strictEqual(third.position.offset, lines[2]?.offset, "and so is the one that followed the foreign line");
			assert.strictEqual(third.position.end, lines[2]?.end);

			const all = yield* Stream.runCollect(journal.query());
			assert.deepStrictEqual(
				all.map((envelope) => envelope.data.round),
				[1, 2, 3],
				"every line reads back, in file order",
			);
			for (let index = 0; index < all.length - 1; index++) {
				assert.strictEqual(all[index]?.position.end, all[index + 1]?.position.offset, "no gap and no overlap");
			}
			yield* Scope.close(scope, Exit.void);
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	it.effect("latest survives a process-style reopen — a second layer reads the first's writes", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			const dir = yield* fs.makeTempDirectoryScoped();
			const file = path.join(dir, "journal.jsonl");

			const first = journalAt(file);
			yield* Effect.gen(function* () {
				const journal = yield* TmpJournal;
				yield* journal.create;
				yield* journal.append("started", { round: 11, phase: "written-by-first" });
			}).pipe(Effect.provide(first));

			// A separate layer — a stand-in for a second process — seeds `latest`
			// from disk at construction and sees the first's append.
			const second = journalAt(file);
			const seen = yield* Effect.gen(function* () {
				const journal = yield* TmpJournal;
				return yield* journal.latest;
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
			yield* fs.writeFile(file, new TextEncoder().encode(`\uFEFF${line}`));

			const layer = journalAt(file);
			const seen = yield* Effect.gen(function* () {
				const journal = yield* TmpJournal;
				return yield* journal.latest;
			}).pipe(Effect.provide(layer));

			const envelope = Option.getOrThrow(seen);
			assert.strictEqual(envelope.position.offset, 0, "offsets are post-BOM relative");
			assert.deepStrictEqual(envelope.data, { round: 1, phase: "p" });
		}).pipe(Effect.scoped, Effect.provide(platform)),
	);

	// `it.live` for the same reason as the flagship below: it waits on real
	// filesystem events, which a TestClock-bound timeout could never bound.
	it.live(
		"a journal REPLACED by a rename-over is followed onto the new file",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const dir = yield* fs.makeTempDirectoryScoped();
				const file = path.join(dir, "replaced.jsonl");
				const lineFor = (round: number) =>
					`${JSON.stringify({ at: "2026-01-01T00:00:00.000Z", event: "started", data: { round, phase: "theirs" } })}\n`;
				yield* fs.writeFileString(file, lineFor(1));

				const scope = yield* Scope.make();
				const context = yield* Layer.build(journalAt(file)).pipe(Effect.provideService(Scope.Scope, scope));
				const reader = Context.get(context, TmpJournal);

				const reaches = (round: number) =>
					reader.latestChanges.pipe(
						Stream.filter((latest) => Option.isSome(latest) && latest.value.data.round === round),
						Stream.take(1),
						Stream.runDrain,
					);

				// Atomic replacement, as an editor or a `mv tmp journal` does it: a new
				// inode takes the path. A node watch stays on the old inode and reports
				// nothing more, so unless the watch ENDS here and re-arms, the journal
				// is blind to everything appended from now on.
				const temporary = path.join(dir, "replaced.jsonl.tmp");
				yield* fs.writeFileString(temporary, lineFor(5));
				yield* fs.rename(temporary, file);
				yield* reaches(5);

				// A cooperating foreign writer appends to the replacement.
				yield* Effect.scoped(
					Effect.gen(function* () {
						const handle = yield* fs.open(file, { flag: "a" });
						yield* handle.writeAll(new TextEncoder().encode(lineFor(7)));
					}),
				);
				yield* reaches(7);

				yield* Scope.close(scope, Exit.void);
			}).pipe(Effect.scoped, Effect.provide(platform), Effect.timeout(Duration.seconds(20))),
		30_000,
	);

	// THE FLAGSHIP — acceptance criterion 3.
	//
	// `it.live` rather than `it.effect`: this one waits on a REAL filesystem
	// event, and under the TestClock a timeout could never fire, so a failure
	// would present as a hang instead of a failure.
	//
	// The per-test timeout is raised ABOVE the effect's own 20s bound on purpose.
	// At vitest's 5s default the guard below is unreachable — the runner kills
	// the test first, and the careful "fails rather than hangs" wiring never
	// runs.
	it.live(
		"TWO journal layers over ONE file observe each other's appends",
		() =>
			Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const dir = yield* fs.makeTempDirectoryScoped();
				const file = path.join(dir, "shared.jsonl");

				// Two independently-built layers over the same path — the stand-in for
				// two processes, or two MCP servers in sibling repos.
				const writerLayer = journalAt(file);
				const readerLayer = journalAt(file);

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
		30_000,
	);
});
