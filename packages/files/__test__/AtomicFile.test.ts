// AtomicFile.write over a real in-memory volume, with faults injected on the
// steps a crash can interrupt.

import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemFaultsFactory, MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Exit, Fiber, FileSystem, Latch, PlatformError } from "effect";
import { AtomicFile } from "../src/index.js";

const DIR = "/work";
const TARGET = "/work/config.json";

const failure = (method: string, path: string, tag: "NotFound" | "PermissionDenied" | "Unknown" = "Unknown") =>
	PlatformError.systemError({ _tag: tag, module: "FileSystem", method, pathOrDescriptor: path });

/** The `.effected-*` entries in the target's directory: the temp files left behind. */
const temps = Effect.gen(function* () {
	const volume = yield* MemoryFileSystem.Volume;
	return (volume.readDirectory(DIR) ?? []).filter((name) => name.startsWith(".effected-"));
});

/** A chain `/work/l0 -> l1 -> ... -> l<count-1> -> missing`, relative like a real link. */
const linkChain = (count: number): MemoryFileSystemSeed => {
	const seed: Record<string, ReturnType<typeof MemoryFileSystem.symlink>> = {};
	for (let index = 0; index < count; index++) {
		seed[`/work/l${index}`] = MemoryFileSystem.symlink(index === count - 1 ? "missing" : `l${index + 1}`);
	}
	return seed;
};

/**
 * A volume whose `realPath` answers `NotFound` for everything, so the hop budget
 * is the only thing that stops the walk. A real `realPath` reports `ELOOP` first.
 */
const realPathAlwaysAbsent = (seed: MemoryFileSystemSeed) =>
	MemoryFileSystem.layerWithPath(seed, {
		faults: { realPath: (path) => Effect.fail(failure("realPath", path, "NotFound")) },
	});

/** Replaces `writeAll` on every file opened, leaving the rest of the file real. */
const withWriteAll =
	(writeAll: () => Effect.Effect<void, PlatformError.PlatformError>): MemoryFileSystemFaultsFactory =>
	(base) => ({
		open: (path, options) =>
			Effect.map(base.open(path, options), (file) => MemoryFileSystem.wrapFile(file, { writeAll })),
	});

describe("AtomicFile.write", () => {
	it.effect("creates an absent file", () =>
		Effect.gen(function* () {
			yield* AtomicFile.write(TARGET, "new é");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(TARGET), "new é");
			assert.deepStrictEqual(volume.readDirectory(DIR), ["config.json"]);
		}).pipe(Effect.provide(MemoryFileSystem.layerWithPath({ [DIR]: MemoryFileSystem.directory() }))),
	);

	it.effect("replaces an existing file with text", () =>
		Effect.gen(function* () {
			yield* AtomicFile.write(TARGET, "new");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(TARGET), "new");
			assert.deepStrictEqual(volume.readDirectory(DIR), ["config.json"]);
		}).pipe(Effect.provide(MemoryFileSystem.layerWithPath({ [TARGET]: "a much longer old content" }))),
	);

	it.effect("replaces an existing file with bytes, verbatim", () =>
		Effect.gen(function* () {
			const bytes = new Uint8Array([0, 255, 1, 254]);
			yield* AtomicFile.write(TARGET, bytes);
			const volume = yield* MemoryFileSystem.Volume;
			assert.deepStrictEqual(volume.bytes(TARGET), bytes);
		}).pipe(Effect.provide(MemoryFileSystem.layerWithPath({ [TARGET]: "old" }))),
	);

	it.effect("an empty string writes an empty file", () =>
		Effect.gen(function* () {
			yield* AtomicFile.write(TARGET, "");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(TARGET), "");
			assert.deepStrictEqual(yield* temps, []);
		}).pipe(Effect.provide(MemoryFileSystem.layerWithPath({ [TARGET]: "old" }))),
	);

	it.effect("a failed rename leaves the old file intact and removes the temp", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(AtomicFile.write(TARGET, "new"));
			assert.strictEqual(error.reason._tag, "PermissionDenied");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(TARGET), "old");
			assert.deepStrictEqual(yield* temps, []);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ [TARGET]: "old" },
					{ faults: { rename: (from) => Effect.fail(failure("rename", from, "PermissionDenied")) } },
				),
			),
		),
	);

	it.effect("a failed write leaves the old file intact and removes the temp", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(AtomicFile.write(TARGET, "new"));
			assert.strictEqual(error.reason._tag, "PermissionDenied");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(TARGET), "old");
			assert.deepStrictEqual(yield* temps, []);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ [TARGET]: "old" },
					{ faults: withWriteAll(() => Effect.fail(failure("writeAll", TARGET, "PermissionDenied"))) },
				),
			),
		),
	);

	it.effect("the temp is written and synced before the rename", () => {
		const calls: Array<string> = [];
		return Effect.gen(function* () {
			yield* AtomicFile.write(TARGET, "new");
			assert.deepStrictEqual(calls, ["writeAll", "sync", "rename"]);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ [TARGET]: "old" },
					{
						faults: (base) => ({
							open: (path, options) =>
								Effect.map(base.open(path, options), (file) =>
									MemoryFileSystem.wrapFile(file, {
										writeAll: () => {
											calls.push("writeAll");
											return undefined;
										},
										sync: () => {
											calls.push("sync");
											return undefined;
										},
									}),
								),
							rename: () => {
								calls.push("rename");
								return undefined;
							},
						}),
					},
				),
			),
		);
	});

	it.effect("a symlinked target keeps the link and changes the file it points to", () =>
		Effect.gen(function* () {
			yield* AtomicFile.write(TARGET, "new");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.readLink(TARGET), "/elsewhere/real.json");
			assert.strictEqual(volume.text("/elsewhere/real.json"), "new");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath({
					"/elsewhere/real.json": "old",
					[TARGET]: MemoryFileSystem.symlink("/elsewhere/real.json"),
				}),
			),
		),
	);

	it.effect("a dangling symlink creates the file it points to and keeps the link", () =>
		Effect.gen(function* () {
			yield* AtomicFile.write(TARGET, "new");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.readLink(TARGET), "../elsewhere/real.json");
			assert.strictEqual(volume.text("/elsewhere/real.json"), "new");
			assert.deepStrictEqual(volume.readDirectory("/elsewhere"), ["real.json"]);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath({
					"/elsewhere": MemoryFileSystem.directory(),
					[TARGET]: MemoryFileSystem.symlink("../elsewhere/real.json"),
				}),
			),
		),
	);

	it.effect("a dangling chain of links is followed to its end", () =>
		Effect.gen(function* () {
			yield* AtomicFile.write("/work/l0", "new");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text("/work/missing"), "new");
			assert.strictEqual(volume.readLink("/work/l0"), "l1");
		}).pipe(Effect.provide(MemoryFileSystem.layerWithPath(linkChain(3)))),
	);

	it.effect("exactly 40 hops is within the budget", () =>
		Effect.gen(function* () {
			yield* AtomicFile.write("/work/l0", "new");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text("/work/missing"), "new");
		}).pipe(Effect.provide(realPathAlwaysAbsent(linkChain(40)))),
	);

	it.effect("a chain of links over 40 hops fails rather than looping", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(AtomicFile.write("/work/l0", "new"));
			assert.strictEqual(error.reason._tag, "NotFound");
			assert.strictEqual(error.reason.method, "realPath");
			const volume = yield* MemoryFileSystem.Volume;
			assert.isFalse(volume.has("/work/missing"));
			assert.deepStrictEqual(yield* temps, []);
		}).pipe(Effect.provide(realPathAlwaysAbsent(linkChain(41)))),
	);

	it.effect("a cycle of links fails with what realPath reports", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(AtomicFile.write("/work/a", "new"));
			assert.notStrictEqual(error.reason._tag, "NotFound");
			assert.deepStrictEqual(yield* temps, []);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath({
					"/work/a": MemoryFileSystem.symlink("b"),
					"/work/b": MemoryFileSystem.symlink("a"),
				}),
			),
		),
	);

	it.effect("a realPath failure other than NotFound propagates", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(AtomicFile.write(TARGET, "new"));
			assert.strictEqual(error.reason._tag, "PermissionDenied");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(TARGET), "old");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ [TARGET]: "old" },
					{ faults: { realPath: (path) => Effect.fail(failure("realPath", path, "PermissionDenied")) } },
				),
			),
		),
	);

	it.effect("a stat failure other than NotFound propagates and nothing is written", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(AtomicFile.write(TARGET, "new"));
			assert.strictEqual(error.reason._tag, "PermissionDenied");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(TARGET), "old");
			assert.deepStrictEqual(yield* temps, []);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ [TARGET]: "old" },
					{ faults: { stat: (path) => Effect.fail(failure("stat", path, "PermissionDenied")) } },
				),
			),
		),
	);

	for (const [label, mode] of [
		["0600", 0o600],
		["0755", 0o755],
	] as const) {
		it.effect(`an existing ${label} file stays ${label}`, () =>
			Effect.gen(function* () {
				yield* AtomicFile.write(TARGET, "new");
				const fs = yield* FileSystem.FileSystem;
				assert.strictEqual((yield* fs.stat(TARGET)).mode & 0o7777, mode);
			}).pipe(Effect.provide(MemoryFileSystem.layerWithPath({ [TARGET]: MemoryFileSystem.file("old", { mode }) }))),
		);
	}

	it.effect("the existing mode survives a umask that narrows open's mode", () =>
		Effect.gen(function* () {
			yield* AtomicFile.write(TARGET, "new");
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual((yield* fs.stat(TARGET)).mode & 0o7777, 0o664);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ [TARGET]: MemoryFileSystem.file("old", { mode: 0o664 }) },
					{
						faults: (base) => ({
							open: (path, options) =>
								base.open(path, {
									...options,
									...(options?.mode === undefined ? {} : { mode: options.mode & ~0o022 }),
								}),
						}),
					},
				),
			),
		),
	);

	it.effect("the temp is opened with the existing mode", () => {
		const opened: Array<{ readonly path: string; readonly flag: unknown; readonly mode: unknown }> = [];
		return Effect.gen(function* () {
			yield* AtomicFile.write(TARGET, "new");
			assert.strictEqual(opened.length, 1);
			assert.match(opened[0]?.path ?? "", /^\/work\/\.effected-[0-9a-z]+\.tmp$/);
			assert.strictEqual(opened[0]?.flag, "wx");
			assert.strictEqual(opened[0]?.mode, 0o600);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ [TARGET]: MemoryFileSystem.file("old", { mode: 0o600 }) },
					{
						faults: {
							open: (path, options) => {
								opened.push({ path, flag: options?.flag, mode: options?.mode });
								return undefined;
							},
						},
					},
				),
			),
		);
	});

	it.effect("the temp of an absent file names no mode", () => {
		const options: Array<object | undefined> = [];
		return Effect.gen(function* () {
			yield* AtomicFile.write(TARGET, "new");
			assert.deepStrictEqual(options, [{ flag: "wx" }]);
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ [DIR]: MemoryFileSystem.directory() },
					{
						faults: {
							open: (_path, given) => {
								options.push(given);
								return undefined;
							},
						},
					},
				),
			),
		);
	});

	it.effect("a 255-byte basename succeeds", () => {
		const name = "a".repeat(255);
		const long = `${DIR}/${name}`;
		return Effect.gen(function* () {
			yield* AtomicFile.write(long, "new");
			const volume = yield* MemoryFileSystem.Volume;
			assert.strictEqual(volume.text(long), "new");
		}).pipe(
			Effect.provide(
				MemoryFileSystem.layerWithPath(
					{ [long]: "old" },
					{
						// memfs has no name limit of its own, so this stands in for the host's ENAMETOOLONG.
						faults: {
							open: (path) =>
								(path.split("/").pop() ?? "").length > 255 ? Effect.fail(failure("open", path)) : undefined,
						},
					},
				),
			),
		);
	});

	it.effect("interruption during the write leaves the old file and no temp", () =>
		Effect.gen(function* () {
			const entered = yield* Latch.make();
			const held = yield* Latch.make();
			const layer = MemoryFileSystem.layerWithPath(
				{ [TARGET]: "old" },
				{ faults: withWriteAll(() => Effect.andThen(entered.open, held.await)) },
			);
			yield* Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(AtomicFile.write(TARGET, "new"));
				yield* entered.await;
				assert.strictEqual((yield* temps).length, 1, "the temp exists while the write is held");
				yield* Fiber.interrupt(fiber);
				const exit = yield* Fiber.await(fiber);
				assert.isTrue(Exit.hasInterrupts(exit));
				const volume = yield* MemoryFileSystem.Volume;
				assert.strictEqual(volume.text(TARGET), "old");
				assert.deepStrictEqual(yield* temps, []);
			}).pipe(Effect.provide(layer));
		}),
	);

	it.effect("a target that is a directory fails and removes the temp", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(AtomicFile.write("/work/dir", "new"));
			assert.strictEqual(error._tag, "PlatformError");
			const volume = yield* MemoryFileSystem.Volume;
			assert.isTrue(volume.isDirectory("/work/dir"));
			assert.strictEqual(volume.text("/work/dir/inner.txt"), "keep");
			assert.deepStrictEqual(yield* temps, []);
		}).pipe(Effect.provide(MemoryFileSystem.layerWithPath({ "/work/dir/inner.txt": "keep" }))),
	);

	it.effect("an absent parent directory fails and is not created", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(AtomicFile.write("/work/absent/config.json", "new"));
			assert.strictEqual(error.reason._tag, "NotFound");
			const volume = yield* MemoryFileSystem.Volume;
			assert.isFalse(volume.has("/work/absent"));
		}).pipe(Effect.provide(MemoryFileSystem.layerWithPath({ [DIR]: MemoryFileSystem.directory() }))),
	);
});
