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
	// Make subscription registration deterministic before mutating: under v4's
	// cooperative FIFO scheduler this parks the parent behind the child, which
	// runs to its first real suspension — past `volume.watchers.add` — so no
	// event can be published before the watcher exists.
	yield* Effect.yieldNow;
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

describe("tagged seed entries — directories, symlinks and modes", () => {
	it.effect("one seed literal describes a whole tree — files, empty dirs, symlinks, modes", () =>
		Effect.gen(function* () {
			// The downstream lockdown fixture, expressed as a single literal.
			const fs = yield* MemoryFileSystem.makeWith({
				"/root/.repos/blocked/src/a.ts": "export {}\n",
				"/root/.git/modules/.repos/blocked": MemoryFileSystem.directory(),
				"/root/tools/lock.sh": MemoryFileSystem.file("#!/bin/sh\n", { mode: 0o755 }),
				"/root/current": MemoryFileSystem.symlink("/root/.repos/blocked"),
			});

			assert.strictEqual(yield* fs.readFileString("/root/.repos/blocked/src/a.ts"), "export {}\n");
			assert.strictEqual((yield* fs.stat("/root/.git/modules/.repos/blocked")).type, "Directory");
			assert.strictEqual((yield* fs.stat("/root/tools/lock.sh")).mode & 0o7777, 0o755);
			assert.strictEqual(yield* fs.readLink("/root/current"), "/root/.repos/blocked");
		}),
	);

	it.effect("directory() seeds an empty directory — exists, is a directory, lists nothing", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({ "/empty": MemoryFileSystem.directory() });
			assert.isTrue(yield* fs.exists("/empty"));
			assert.strictEqual((yield* fs.stat("/empty")).type, "Directory");
			assert.deepStrictEqual(yield* fs.readDirectory("/empty"), []);
		}),
	);

	it.effect("symlink(target) answers readLink and reads through to the target", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({
				"/target.txt": "pointed-at",
				"/link.txt": MemoryFileSystem.symlink("/target.txt"),
			});
			assert.strictEqual(yield* fs.readLink("/link.txt"), "/target.txt");
			assert.strictEqual(yield* fs.readFileString("/link.txt"), "pointed-at");
			// stat follows the link; the entry itself is a SymbolicLink to readLink.
			assert.strictEqual((yield* fs.stat("/link.txt")).type, "File");
		}),
	);

	it.effect("a dangling symlink is legal — readLink answers, reading through fails NotFound", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({ "/dangling": MemoryFileSystem.symlink("/absent.txt") });
			assert.strictEqual(yield* fs.readLink("/dangling"), "/absent.txt");
			const error = yield* Effect.flip(fs.readFileString("/dangling"));
			assert.strictEqual(error.reason._tag, "NotFound");
		}),
	);

	it.effect("file and directory modes land in stat; untagged and unoptioned entries keep the defaults", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({
				"/locked.txt": MemoryFileSystem.file("read-only", { mode: 0o444 }),
				"/bin/run": MemoryFileSystem.file(new Uint8Array([0x7f, 0x45]), { mode: 0o755 }),
				"/plain.txt": MemoryFileSystem.file("plain"),
				"/legacy.txt": "legacy",
				"/locked-dir": MemoryFileSystem.directory({ mode: 0o555 }),
			});

			assert.strictEqual((yield* fs.stat("/locked.txt")).mode & 0o7777, 0o444);
			assert.strictEqual(yield* fs.readFileString("/locked.txt"), "read-only");
			assert.strictEqual((yield* fs.stat("/bin/run")).mode & 0o7777, 0o755);
			assert.deepStrictEqual(yield* fs.readFile("/bin/run"), new Uint8Array([0x7f, 0x45]));
			assert.strictEqual((yield* fs.stat("/plain.txt")).mode & 0o7777, 0o644);
			assert.strictEqual((yield* fs.stat("/legacy.txt")).mode & 0o7777, 0o644);
			assert.strictEqual((yield* fs.stat("/locked-dir")).mode & 0o7777, 0o555);
			assert.strictEqual((yield* fs.stat("/locked-dir")).type, "Directory");
		}),
	);

	it.effect("a directory mode applies even when the directory pre-exists as an earlier entry's parent", () =>
		Effect.gen(function* () {
			const fs = yield* MemoryFileSystem.makeWith({
				"/repo/src/index.ts": "export {}\n",
				"/repo/src": MemoryFileSystem.directory({ mode: 0o555 }),
			});
			assert.strictEqual((yield* fs.stat("/repo/src")).mode & 0o7777, 0o555);
			// The earlier child is untouched.
			assert.strictEqual(yield* fs.readFileString("/repo/src/index.ts"), "export {}\n");
		}),
	);

	it.effect("an invalid seed mode fails typed through makeWith, never a defect", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				MemoryFileSystem.makeWith({ "/bad.txt": MemoryFileSystem.file("x", { mode: -1 }) }),
			);
			assert.strictEqual(error._tag, "PlatformError");
			assert.strictEqual(error.reason._tag, "BadArgument");
		}),
	);

	it.effect("layerWith accepts tagged entries", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual((yield* fs.stat("/srv")).type, "Directory");
			assert.strictEqual(yield* fs.readLink("/etc/alias"), "/srv");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWith({
					"/srv": MemoryFileSystem.directory(),
					"/etc/alias": MemoryFileSystem.symlink("/srv"),
				}),
			),
		),
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
