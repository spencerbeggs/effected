import type { MemoryFileSystemFaultHandler, MemoryFileSystemFaults } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { Cause, Option, PlatformError } from "effect";
import { Effect, FileSystem, Layer, Queue, Stream } from "effect";
import { JournalWatcher } from "../../src/index.js";

/**
 * The journal's test filesystem: a real `@effected/memfs` volume, with the
 * deterministic seams these suites need layered on as FAULTS rather than
 * reimplemented.
 *
 * Storage, `stat` (size, `dev`/`ino` identity), `exists`, `remove`, and `open`
 * with its positional reads and `O_APPEND` `writeAll` are memfs's own, so an
 * unseeded path fails typed `NotFound` exactly as a real filesystem does — a
 * missing parent directory included. Two members are decorated through the
 * faults factory, delegate-by-default:
 *
 * - `open` wraps the returned handle so a write gate and a read gate can hold a
 *   `writeAll` / `readAlloc` open;
 * - `exists` counts calls, then delegates.
 *
 * The layer also provides the journal's `JournalWatcher` as a manually driven
 * double. memfs's own watch emits events on every write, which would race the
 * explicit {@link MemFs.poke} / {@link MemFs.pokeParent} design these tests are
 * built on — offset bookkeeping, resync and activation stay timer-free only
 * while the test alone decides when an event arrives. The double honours the
 * service's contract exactly as the node backend does: it `stat`s the target
 * through the real volume (so a missing path fails typed), then registers its
 * listener before the watch effect succeeds.
 *
 * Real-filesystem behavior (concurrent appends across processes, the node
 * watcher's event shapes) belongs in `__test__/integration/`.
 */
export interface MemFs {
	readonly layer: Layer.Layer<FileSystem.FileSystem | JournalWatcher>;
	/**
	 * Block every `writeAll` until {@link MemFs.openGate} is called.
	 *
	 * Exists so ordering can be asserted without wall-clock timing: with a write
	 * held open, an operation that must NOT queue behind it can be observed
	 * completing while the gate is still shut.
	 */
	readonly closeGate: () => void;
	readonly openGate: () => void;
	/**
	 * Whether any write actually reached the closed gate.
	 *
	 * Without this a gate-based ordering test passes vacuously when nothing ever
	 * blocks — the scenario it claims to set up never happened.
	 */
	readonly gateWasEntered: () => boolean;
	/** Read the raw bytes currently stored at a path. */
	readonly bytes: (path: string) => Uint8Array | undefined;
	/**
	 * Write a path's whole contents, bypassing the journal. An existing file is
	 * overwritten IN PLACE and keeps its identity, as `writeFileSync` does; a
	 * missing parent directory is created.
	 */
	readonly write: (path: string, bytes: Uint8Array | string) => void;
	/**
	 * Delete a path behind the journal's back, synchronously.
	 *
	 * The counterpart to {@link MemFs.write}, and the only way to make a file
	 * vanish inside {@link MemFs.beforeWatch}'s window — where a hook is
	 * synchronous and cannot run the layer's own `remove`.
	 */
	readonly unlink: (path: string) => void;
	/** Whether a regular file exists at a path. */
	readonly has: (path: string) => boolean;
	/** Every regular file currently present. */
	readonly paths: () => ReadonlyArray<string>;
	/**
	 * Deliver a **content** watch event for `path` to the watchers of that path.
	 *
	 * The deterministic seam: watcher behaviour is driven explicitly instead of
	 * racing a real filesystem, so offset bookkeeping, resync and activation are
	 * timer-free unit tests.
	 *
	 * Routing is deliberately honest: a content append reaches the watchers of
	 * the **file**, never those of its parent directory. A double that notified
	 * both would keep a journal that never handed off from its activation
	 * directory watch to its file watch looking healthy — the exact defect the
	 * handoff exists to prevent.
	 */
	readonly poke: (path: string) => void;
	/**
	 * Deliver a **structural** watch event for `path` to the watchers of its
	 * parent directory, carrying a bare basename as the node backend does.
	 *
	 * This is creation/removal — the only thing a non-recursive directory watch
	 * reports reliably. Content appends are {@link MemFs.poke}'s.
	 */
	readonly pokeParent: (path: string) => void;
	/**
	 * Suspend the next `readAlloc` so a concurrent append can be landed inside a
	 * read.
	 *
	 * The only deterministic way to place a write in the window a read straddles.
	 * `sampleFirst` (the default) takes the bytes before the suspension; pass
	 * `false` to suspend first, so the read samples after the write.
	 *
	 * For the journal's reads the two orders are INVISIBLE through the Journal:
	 * every `readAlloc` in `src` is sized by a `stat` taken before the file is
	 * opened, so a write landing inside the gate is past the requested size
	 * either way. `false` is the order that catches an UNBOUNDED read — one that
	 * ignores that size would pick the write up — so a test pinning the stat
	 * bound must pass it; sampling first would hide the defect. The order itself
	 * is pinned in `MemFsHelper.test.ts`.
	 *
	 * @returns `entered`, which resolves once the gated read is suspended, and
	 *   `release`, which lets it finish.
	 */
	readonly gateNextRead: (options?: { readonly sampleFirst?: boolean }) => {
		readonly entered: Promise<void>;
		readonly release: () => void;
	};
	/**
	 * How many watchers are registered for a path.
	 *
	 * Lets a test WAIT for the watcher to arm instead of yielding a hopeful
	 * number of times — and lets it assert the precondition, so a poke into an
	 * empty registry cannot pass as a working watcher.
	 */
	readonly watcherCount: (target: string) => number;
	/**
	 * The size of every `readAlloc` requested so far, in order.
	 *
	 * What makes a bounded-read claim testable: an output assertion cannot tell
	 * a paged read from one whole-file allocation, but the requested sizes can.
	 */
	readonly readRequests: () => ReadonlyArray<number>;
	readonly existsCalls: () => number;
	/**
	 * Give the path a NEW identity, as a rename-over or recreate would: the old
	 * file is unlinked and a fresh one written, so memfs mints a new inode. Every
	 * watch of the old file ends, as a real backend's does.
	 */
	readonly replace: (path: string, bytes: Uint8Array | string) => void;
	/**
	 * Create a directory (and any missing parents).
	 *
	 * A real parent directory exists before the journal inside it does — which is
	 * the entire premise of watching it to detect creation.
	 */
	readonly mkdir: (path: string) => void;
	/**
	 * Run `hook` when `watch(target)` is run, BEFORE it registers.
	 *
	 * The only way to land a write inside the arming window deterministically:
	 * after the engine has seeded `consumed`, but before the watch is live. A
	 * write placed anywhere else is covered by seeding or by a later event, and
	 * the test passes whatever the ordering is.
	 */
	readonly beforeWatch: (hook: (target: string) => void) => void;
	/**
	 * Suspend the next watch of `target` AFTER its `stat` and BEFORE it
	 * registers — where the node backend's watch is requested but not yet live.
	 *
	 * The only deterministic way to land a write in that window: an engine that
	 * catches up before the watch is registered reads the file while it is held,
	 * so a write landed in the hold is neither read nor reported. An engine that
	 * waits for the watch to arm cannot catch up until it is released.
	 *
	 * @returns `entered`, which resolves once the watch is held, and `release`,
	 *   which lets it register.
	 */
	readonly holdNextWatch: (target: string) => {
		readonly entered: Promise<void>;
		readonly release: () => void;
	};
	/**
	 * Run `hook` ONCE, inside the first handle `stat` that follows a `writeAll`
	 * on that same handle, BEFORE the stat samples the file.
	 *
	 * The only way to land a foreign append between an append's write and its
	 * `fstat` deterministically — the window in which a reported size
	 * overstates where the write landed. Consumed by the first stat it fires on.
	 */
	readonly afterNextWriteStat: (hook: () => void) => void;
}

/**
 * Index of the last separator, on either convention.
 *
 * memfs is POSIX: a backslash is an ordinary filename byte there, so
 * `C:\journal\watch.jsonl` is one opaque name at the volume root — and every
 * operation the journal performs on it (and on its derived parent
 * `C:\journal`) resolves to the same entry, which is all the backslash test
 * needs. Only the synthetic directory event below has to split the path the
 * way the code under test does.
 */
const lastSeparator = (path: string): number => Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));

/**
 * Extra faults for one {@link makeMemFs} volume, composed AHEAD of the
 * helper's own decorations: a handler that returns `undefined` falls through
 * to them, so a faulted `open` still hands back a gated handle when it
 * declines, and `exists` is still counted.
 *
 * `base` is the unfaulted filesystem, so a handler can delegate and then act —
 * `stat: (path) => base.stat(path).pipe(Effect.tap(...))` — without re-entering
 * itself. `open` takes a handler only (no `failTimes`), because the helper
 * always intercepts it to install the gates.
 */
export interface MemFsOptions {
	readonly faults?: (
		base: FileSystem.FileSystem,
	) => Omit<MemoryFileSystemFaults, "open"> & { readonly open?: MemoryFileSystemFaultHandler<"open"> };
}

export const makeMemFs = (options?: MemFsOptions): MemFs => {
	let gate: Promise<void> | undefined;
	let releaseGate: (() => void) | undefined;
	let gateEntered = false;
	let existsCallCount = 0;
	const readSizes: Array<number> = [];
	let beforeWatchHook: ((target: string) => void) | undefined;
	let watchHold: { readonly target: string; readonly promise: Promise<void>; readonly enter: () => void } | undefined;
	/** The volume without the helper's decorations or a test's faults — what the watch double stats through. */
	let unfaulted: FileSystem.FileSystem | undefined;
	let afterWriteStatHook: (() => void) | undefined;
	/** The read gate: set by {@link MemFs.gateNextRead}, consumed by one `readAlloc`. */
	let readGate:
		| { readonly promise: Promise<void>; readonly enter: () => void; readonly sampleFirst: boolean }
		| undefined;

	const watchers = new Map<string, Set<(event: FileSystem.WatchEvent) => void>>();
	/**
	 * How to end each FILE watch, by path. A platform watch follows the inode it
	 * was armed on, so removing or replacing the file ends it — and a double whose
	 * watch outlived its file would keep delivering pokes no real backend sends,
	 * hiding a journal that never re-arms on the replacement.
	 */
	const fileWatchEnds = new Map<string, Set<() => void>>();
	const endFileWatches = (path: string): void => {
		for (const end of fileWatchEnds.get(path) ?? []) end();
		fileWatchEnds.delete(path);
	};
	const notify = (target: string, event: FileSystem.WatchEvent): void => {
		for (const listener of watchers.get(target) ?? []) {
			listener(event);
		}
	};

	/**
	 * Decorate a real memfs handle with the two gates. memfs's `File` is a class
	 * instance with prototype members, so every member is forwarded explicitly —
	 * a spread would drop them.
	 */
	const gated = (file: FileSystem.File): FileSystem.File => {
		/** Whether this handle has completed a `writeAll` — what arms {@link MemFs.afterNextWriteStat}. */
		let wrote = false;
		return {
			[FileSystem.FileTypeId]: FileSystem.FileTypeId,
			get stat() {
				return Effect.suspend(() => {
					const hook = afterWriteStatHook;
					if (wrote && hook !== undefined) {
						afterWriteStatHook = undefined;
						hook();
					}
					return file.stat;
				});
			},
			get sync() {
				return file.sync;
			},
			seek: (offset, from) => file.seek(offset, from),
			read: (buffer) => file.read(buffer),
			truncate: (length) => file.truncate(length),
			write: (buffer) => file.write(buffer),
			readAlloc: (size): Effect.Effect<Option.Option<Uint8Array>, PlatformError.PlatformError> =>
				Effect.suspend(() => {
					readSizes.push(size);
					const held = readGate;
					if (held === undefined) return file.readAlloc(size);
					readGate = undefined;
					const suspend = Effect.promise(() => {
						held.enter();
						return held.promise;
					});
					// `sampleFirst` suspends AFTER the real read; otherwise the read is
					// taken after the suspension and sees whatever landed inside it, up to
					// the size requested.
					return held.sampleFirst
						? Effect.tap(file.readAlloc(size), () => suspend)
						: Effect.andThen(suspend, file.readAlloc(size));
				}),
			// memfs's own `writeAll` on a `{ flag: "a" }` handle appends at the end
			// regardless of position — real O_APPEND. The gate only delays it.
			writeAll: (buffer) =>
				Effect.suspend(() => {
					const written = Effect.tap(file.writeAll(buffer), () =>
						Effect.sync(() => {
							wrote = true;
						}),
					);
					const held = gate;
					if (held === undefined) return written;
					gateEntered = true;
					return Effect.andThen(
						Effect.promise(() => held),
						written,
					);
				}),
		};
	};

	const handle = MemoryFileSystem.makeSync(
		{},
		{
			faults: (base) => {
				unfaulted = base;
				const extra = options?.faults?.(base) ?? {};
				const extraExists = extra.exists;
				return {
					...extra,
					open: (path, openOptions) =>
						extra.open?.(path, openOptions) ?? Effect.map(base.open(path, openOptions), gated),
					exists: (path) => {
						existsCallCount += 1;
						return typeof extraExists === "function" ? extraExists(path) : undefined;
					},
				};
			},
		},
	);

	const isFile = (path: string): boolean => handle.volume.bytes(path) !== undefined;

	const watcher = Layer.succeed(JournalWatcher, {
		watch: (target) =>
			Effect.gen(function* () {
				beforeWatchHook?.(target);
				if (unfaulted === undefined) return yield* Effect.die("the memfs faults factory never ran");
				const info = yield* unfaulted.stat(target);
				const held = watchHold?.target === target ? watchHold : undefined;
				if (held !== undefined) {
					watchHold = undefined;
					yield* Effect.promise(() => {
						held.enter();
						return held.promise;
					});
				}
				const queue = yield* Queue.unbounded<string | undefined, PlatformError.PlatformError | Cause.Done>();
				yield* Effect.acquireRelease(
					Effect.sync(() => {
						const listener = (event: FileSystem.WatchEvent): void => {
							Queue.offerUnsafe(queue, event.path);
						};
						// The way the node backend ends: the event that names the change is
						// delivered first, then the stream ends.
						const end = (): void => {
							watchers.get(target)?.delete(listener);
							Queue.offerUnsafe(queue, target);
							Queue.endUnsafe(queue);
						};
						const set = watchers.get(target) ?? new Set();
						set.add(listener);
						watchers.set(target, set);
						if (info.type !== "Directory") {
							const ends = fileWatchEnds.get(target) ?? new Set();
							ends.add(end);
							fileWatchEnds.set(target, ends);
						}
						return { listener, end };
					}),
					({ listener, end }) =>
						Effect.sync(() => {
							watchers.get(target)?.delete(listener);
							fileWatchEnds.get(target)?.delete(end);
						}),
				);
				return Stream.fromQueue(queue);
			}),
	});

	return {
		layer: Layer.merge(handle.layer, watcher),
		closeGate: () => {
			gateEntered = false;
			gate = new Promise<void>((resolve) => {
				releaseGate = resolve;
			});
		},
		gateWasEntered: () => gateEntered,
		openGate: () => {
			releaseGate?.();
			gate = undefined;
			releaseGate = undefined;
		},
		poke: (path) => {
			// CONTENT events go to the file's own watchers and nowhere else.
			notify(path, { _tag: "Update", path });
		},
		pokeParent: (path) => {
			const directory = path.slice(0, Math.max(0, lastSeparator(path))) || ".";
			// A directory watcher receives the BARE BASENAME, as the node backend
			// does — which is why the activation path must never use event.path to
			// open anything. The tag is `Remove` for a creation, which is what the
			// probe measured the node backend reporting.
			notify(directory, { _tag: "Remove", path: path.slice(lastSeparator(path) + 1) });
		},
		gateNextRead: (options) => {
			let enter: () => void = () => {};
			const entered = new Promise<void>((resolve) => {
				enter = resolve;
			});
			let release: () => void = () => {};
			const promise = new Promise<void>((resolve) => {
				release = resolve;
			});
			readGate = { promise, enter, sampleFirst: options?.sampleFirst ?? true };
			return { entered, release };
		},
		watcherCount: (target) => watchers.get(target)?.size ?? 0,
		readRequests: () => [...readSizes],
		existsCalls: () => existsCallCount,
		mkdir: (path) => handle.mkdir(path),
		beforeWatch: (hook) => {
			beforeWatchHook = hook;
		},
		holdNextWatch: (target) => {
			let enter: () => void = () => {};
			const entered = new Promise<void>((resolve) => {
				enter = resolve;
			});
			let release: () => void = () => {};
			const promise = new Promise<void>((resolve) => {
				release = resolve;
			});
			watchHold = { target, promise, enter };
			return { entered, release };
		},
		afterNextWriteStat: (hook) => {
			afterWriteStatHook = hook;
		},
		replace: (path, bytes) => {
			if (isFile(path)) handle.remove(path);
			endFileWatches(path);
			handle.write(path, bytes);
		},
		bytes: (path) => handle.volume.bytes(path),
		write: (path, bytes) => handle.write(path, bytes),
		unlink: (path) => {
			handle.remove(path);
			endFileWatches(path);
		},
		has: isFile,
		paths: () => handle.volume.paths(),
	};
};

/**
 * A `JournalWatcher` whose watches arm and never report, for a test that
 * brings its own filesystem layer and never drives the watcher.
 */
export const idleWatcher: Layer.Layer<JournalWatcher> = Layer.succeed(JournalWatcher, {
	watch: () => Effect.succeed(Stream.never),
});

/** Decode a stored file back to text, for assertions. */
export const textOf = (memfs: MemFs, path: string): string => {
	const bytes = memfs.bytes(path);
	return bytes === undefined ? "" : new TextDecoder().decode(bytes);
};
