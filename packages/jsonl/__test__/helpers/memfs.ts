import { MemoryFileSystem } from "@effected/memfs";
import type { Layer, Option, PlatformError } from "effect";
import { Effect, FileSystem, Queue, Stream } from "effect";

/**
 * The journal's test filesystem: a real `@effected/memfs` volume, with the
 * deterministic seams these suites need layered on as FAULTS rather than
 * reimplemented.
 *
 * Storage, `stat` (size, `dev`/`ino` identity), `exists`, `remove`, and `open`
 * with its positional reads and `O_APPEND` `writeAll` are memfs's own, so an
 * unseeded path fails typed `NotFound` exactly as a real filesystem does — a
 * missing parent directory included. Three members are decorated through the
 * faults factory, delegate-by-default:
 *
 * - `open` wraps the returned handle so a write gate and a read gate can hold a
 *   `writeAll` / `readAlloc` open;
 * - `exists` counts calls, then delegates;
 * - `watch` is REPLACED by a manually driven stream. memfs's real watch emits
 *   its own events on every write, which would race the explicit
 *   {@link MemFs.poke} / {@link MemFs.pokeParent} design these tests are built
 *   on — offset bookkeeping, resync and activation stay timer-free only while
 *   the test alone decides when an event arrives. The replacement still
 *   `stat`s the target first through the real volume, so a missing path fails
 *   the watch typed, as the node backend does.
 *
 * Real-filesystem behavior (concurrent appends across processes, the node
 * watcher's event shapes) belongs in `__test__/integration/`.
 */
export interface MemFs {
	readonly layer: Layer.Layer<FileSystem.FileSystem>;
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
	readonly existsCalls: () => number;
	/**
	 * Give the path a NEW identity, as a rename-over or recreate would: the old
	 * file is unlinked and a fresh one written, so memfs mints a new inode.
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

export const makeMemFs = (): MemFs => {
	let gate: Promise<void> | undefined;
	let releaseGate: (() => void) | undefined;
	let gateEntered = false;
	let existsCallCount = 0;
	let beforeWatchHook: ((target: string) => void) | undefined;
	/** The read gate: set by {@link MemFs.gateNextRead}, consumed by one `readAlloc`. */
	let readGate:
		| { readonly promise: Promise<void>; readonly enter: () => void; readonly sampleFirst: boolean }
		| undefined;

	const watchers = new Map<string, Set<(event: FileSystem.WatchEvent) => void>>();
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
	const gated = (file: FileSystem.File): FileSystem.File => ({
		[FileSystem.FileTypeId]: FileSystem.FileTypeId,
		get stat() {
			return file.stat;
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
				const held = gate;
				if (held === undefined) return file.writeAll(buffer);
				gateEntered = true;
				return Effect.andThen(
					Effect.promise(() => held),
					file.writeAll(buffer),
				);
			}),
	});

	const handle = MemoryFileSystem.makeSync(
		{},
		{
			faults: (base) => ({
				open: (path, options) => Effect.map(base.open(path, options), gated),
				exists: () => {
					existsCallCount += 1;
					return undefined;
				},
				// Stat through the REAL volume OUTSIDE the callback, as the node
				// backend does: a missing path fails the STREAM typed. Failing inside
				// `Stream.callback` would not do — that effect is forked, so its
				// failure never reaches the stream and the watch would hang instead of
				// ending.
				watch: (target) =>
					Stream.unwrap(
						Effect.gen(function* () {
							beforeWatchHook?.(target);
							yield* base.stat(target);
							return Stream.callback<FileSystem.WatchEvent, PlatformError.PlatformError>((queue) =>
								Effect.acquireRelease(
									Effect.sync(() => {
										const listener = (event: FileSystem.WatchEvent): void => {
											Queue.offerUnsafe(queue, event);
										};
										const set = watchers.get(target) ?? new Set();
										set.add(listener);
										watchers.set(target, set);
										return listener;
									}),
									(listener) => Effect.sync(() => watchers.get(target)?.delete(listener)),
								).pipe(
									// The callback effect COMPLETING ends the stream, so it must stay
									// alive for as long as the watch should.
									Effect.andThen(Effect.never),
								),
							);
						}),
					),
			}),
		},
	);

	const isFile = (path: string): boolean => handle.volume.bytes(path) !== undefined;

	return {
		layer: handle.layer,
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
		existsCalls: () => existsCallCount,
		mkdir: (path) => handle.mkdir(path),
		beforeWatch: (hook) => {
			beforeWatchHook = hook;
		},
		replace: (path, bytes) => {
			if (isFile(path)) handle.remove(path);
			handle.write(path, bytes);
		},
		bytes: (path) => handle.volume.bytes(path),
		write: (path, bytes) => handle.write(path, bytes),
		unlink: (path) => handle.remove(path),
		has: isFile,
		paths: () => handle.volume.paths(),
	};
};

/** Decode a stored file back to text, for assertions. */
export const textOf = (memfs: MemFs, path: string): string => {
	const bytes = memfs.bytes(path);
	return bytes === undefined ? "" : new TextDecoder().decode(bytes);
};
