// The kit's own extensions and contracts, beyond the vendored upstream suites:
// the makeWith/layerWith seeding API, the honest-absence contract (effected
// #249 — the reason this package exists), per-provide isolation, and the
// watch-recursive adaptation (the port honors core's WatchOptions where
// upstream ignored them).

import { assert, describe, it } from "@effect/vitest";
import type { PlatformError } from "effect";
import { Cause, Effect, Exit, Fiber, FileSystem, Stream } from "effect";
import { MemoryFileSystem } from "../src/index.js";

const collectWatch = Effect.fnUntraced(function* (
	fs: FileSystem.FileSystem,
	path: string,
	options: FileSystem.WatchOptions | undefined,
	count: number,
	mutation: Effect.Effect<void, PlatformError.PlatformError>,
) {
	const events = yield* fs
		.watch(path, options)
		.pipe(Stream.take(count), Stream.runCollect, Effect.forkChild({ startImmediately: true }));
	yield* mutation;
	return Array.from(yield* Fiber.join(events));
});

describe("MemoryFileSystem.makeWith", () => {
	it.effect("seeds files and creates their parent directories recursively", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({
				"/repo/package.json": `{ "name": "fixture" }`,
				"/repo/packages/a/index.ts": "export {}",
				"/bytes.bin": new Uint8Array([0, 42, 255]),
			});

			assert.strictEqual(yield* fs.readFileString("/repo/package.json"), `{ "name": "fixture" }`);
			assert.strictEqual(yield* fs.readFileString("/repo/packages/a/index.ts"), "export {}");
			assert.deepStrictEqual(yield* fs.readFile("/bytes.bin"), new Uint8Array([0, 42, 255]));
			assert.strictEqual((yield* fs.stat("/repo/packages/a")).type, "Directory");
		}),
	);

	it.effect("encodes string seeds as UTF-8", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({ "/utf8.txt": "héllo 👋" });
			assert.strictEqual(yield* fs.readFileString("/utf8.txt"), "héllo 👋");
			assert.strictEqual(Number((yield* fs.stat("/utf8.txt")).size), new TextEncoder().encode("héllo 👋").length);
		}),
	);

	it.effect("fails typed — never a defect — when the seed contradicts itself", () =>
		Effect.gen(function* () {
			// "/a" is seeded as a FILE, then "/a/b" needs it as a directory.
			const error = yield* Effect.flip(MemoryFileSystem.makeWith({ "/a": "file content", "/a/b": "child" }));
			assert.strictEqual(error._tag, "PlatformError");
			assert.strictEqual(error.reason._tag, "AlreadyExists");
		}),
	);
});

describe("honest absence — the effected#249 contract", () => {
	// THE FOUNDING CONTRACT. This package exists because a hand-stubbed
	// FileSystem.layerNoop that answered an unarranged read with "" caused a
	// real silent-changeset-drop bug downstream. An unseeded path must fail
	// typed NotFound, loudly naming the path — never fabricate content.
	it.effect("reading an unseeded path fails typed NotFound, never ''", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({ "/present.txt": "here" });

			const readError = yield* Effect.flip(fs.readFileString("/absent/changesets/config.json"));
			assert.strictEqual(readError._tag, "PlatformError");
			// Assert helpers are not type predicates, so narrow with a real `if`.
			if (readError.reason._tag === "BadArgument") {
				assert.fail("expected a SystemError NotFound, got BadArgument");
				return;
			}
			assert.strictEqual(readError.reason._tag, "NotFound");
			assert.strictEqual(readError.reason.method, "readFile");
			assert.strictEqual(readError.reason.pathOrDescriptor, "/absent/changesets/config.json");

			const statError = yield* Effect.flip(fs.stat("/absent.txt"));
			assert.strictEqual(statError.reason._tag, "NotFound");

			const openError = yield* Effect.flip(Effect.scoped(fs.open("/absent.txt", { flag: "r" })));
			assert.strictEqual(openError.reason._tag, "NotFound");

			// The seeded path still answers — absence is per-path, not global.
			assert.strictEqual(yield* fs.readFileString("/present.txt"), "here");
		}),
	);

	it.effect("an empty volume answers exists with false and reads with NotFound", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.make;
			assert.isFalse(yield* fs.exists("/anything"));
			const error = yield* Effect.flip(fs.readFile("/anything"));
			assert.strictEqual(error.reason._tag, "NotFound");
		}),
	);
});

describe("MemoryFileSystem.layerWith", () => {
	const Seeded = MemoryFileSystem.layerWith({ "/seed.txt": "seeded" });

	it.effect("provides FileSystem backed by the seeded volume", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString("/seed.txt"), "seeded");
		}).pipe(Effect.provide(Seeded)),
	);

	it.effect("each provide of the layer builds an isolated volume", () =>
		Effect.gen(function* () {
			// Effect.provide does not memoize: two provides of ONE layer const are
			// two volumes. (Sharing happens through layer-graph memoization — the
			// suite-boundary `layer(...)` block — and is documented on the facade.)
			yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				yield* fs.writeFileString("/scratch.txt", "first volume");
			}).pipe(Effect.provide(Seeded));

			const seen = yield* Effect.gen(function* () {
				const fs = yield* FileSystem.FileSystem;
				return yield* fs.exists("/scratch.txt");
			}).pipe(Effect.provide(Seeded));

			assert.isFalse(seen);
		}),
	);

	it.effect("a contradictory seed dies — a wiring bug, not a live failure", () =>
		Effect.gen(function* () {
			const Broken = MemoryFileSystem.layerWith({ "/a": "file", "/a/b": "child" });
			const exit = yield* Effect.exit(
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					return yield* fs.exists("/a");
				}).pipe(Effect.provide(Broken)),
			);
			if (!Exit.isFailure(exit)) {
				assert.fail("expected the contradictory seed to die");
				return;
			}
			assert.isTrue(Cause.hasDies(exit.cause));
			assert.isFalse(Cause.hasFails(exit.cause));
		}),
	);
});

describe("watch honors WatchOptions.recursive — the port adaptation", () => {
	it.effect("a non-recursive directory watch reports direct children only", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({ "/root/sub/existing.txt": "x" });

			// The nested write happens FIRST: if non-recursive delivered nested
			// events, it would be the collected one. Collecting the later direct
			// event proves the nested write was skipped.
			const events = yield* collectWatch(
				fs,
				"/root",
				undefined,
				1,
				Effect.gen(function* () {
					yield* fs.writeFileString("/root/sub/nested.txt", "nested");
					yield* fs.writeFileString("/root/direct.txt", "direct");
				}),
			);

			assert.deepStrictEqual(events, [{ _tag: "Create", path: "/root/direct.txt" }]);
		}),
	);

	it.effect("recursive: true reports nested descendants", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({ "/root/sub/existing.txt": "x" });

			const events = yield* collectWatch(
				fs,
				"/root",
				{ recursive: true },
				2,
				Effect.gen(function* () {
					yield* fs.writeFileString("/root/sub/nested.txt", "nested");
					yield* fs.writeFileString("/root/direct.txt", "direct");
				}),
			);

			assert.deepStrictEqual(events, [
				{ _tag: "Create", path: "/root/sub/nested.txt" },
				{ _tag: "Create", path: "/root/direct.txt" },
			]);
		}),
	);

	it.effect("a file watch still reports its own updates", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({ "/file.txt": "original" });

			const events = yield* collectWatch(fs, "/file.txt", undefined, 1, fs.writeFileString("/file.txt", "updated"));

			assert.deepStrictEqual(events, [{ _tag: "Update", path: "/file.txt" }]);
		}),
	);
});
