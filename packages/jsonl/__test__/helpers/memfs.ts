import type { Layer } from "effect";
import { Effect, FileSystem, Option, PlatformError, Queue, Stream } from "effect";

/**
 * A tiny in-memory `FileSystem`, implementing exactly the surface the journal
 * service touches: `exists`, `stat`, `remove`, and `open` returning a handle
 * with `seek` / `readAlloc` / `writeAll`.
 *
 * Deterministic and platform-free, which is what lets the tail-read, BOM,
 * widening, terminal-machine and shutdown tests be unit tests rather than
 * integration tests. Real-filesystem behavior (concurrent appends, O_APPEND
 * atomicity) belongs in `__test__/integration/` and is not simulated here —
 * a double that pretended to model it would prove nothing.
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
	/** Seed a path with raw bytes, bypassing the journal. */
	readonly write: (path: string, bytes: Uint8Array | string) => void;
	/**
	 * Delete a path behind the journal's back, synchronously.
	 *
	 * The counterpart to {@link MemFs.write}, and the only way to make a file
	 * vanish inside {@link MemFs.beforeWatch}'s window — where a hook is
	 * synchronous and cannot run the layer's own `remove`.
	 */
	readonly unlink: (path: string) => void;
	/** Whether a path exists. */
	readonly has: (path: string) => boolean;
	/** Every path currently present. */
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
	 * `sampleFirst` (the default) models `read(2)`: the bytes are taken before
	 * the suspension, so the reader receives the file as of the moment it
	 * sampled. Pass `false` to suspend before sampling, so the read observes the
	 * write.
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
	/** Give the path a NEW identity, as a rename-over or recreate would. */
	readonly replace: (path: string, bytes: Uint8Array | string) => void;
	/**
	 * Create a directory.
	 *
	 * A real parent directory exists before the journal inside it does — which is
	 * the entire premise of watching it to detect creation. Without modelling
	 * empty directories the double cannot represent the activation case at all.
	 */
	readonly mkdir: (path: string) => void;
	/**
	 * Run `hook` when `watch(target)` is called, BEFORE it registers.
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
 * A real filesystem knows its own separator; this double is asked to model both
 * so a Windows-shaped path can be exercised without a Windows runner.
 */
const lastSeparator = (path: string): number => Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));

export const makeMemFs = (): MemFs => {
	const files = new Map<string, Uint8Array>();
	const encoder = new TextEncoder();
	let gate: Promise<void> | undefined;
	let releaseGate: (() => void) | undefined;
	let gateEntered = false;
	let existsCallCount = 0;
	/** Inode identity, so replacement is detectable exactly as on a real filesystem. */
	const directories = new Set<string>();
	let beforeWatchHook: ((target: string) => void) | undefined;
	const inodes = new Map<string, number>();
	let nextInode = 1;
	const inodeOf = (path: string): number => {
		const existing = inodes.get(path);
		if (existing !== undefined) return existing;
		const assigned = nextInode++;
		inodes.set(path, assigned);
		return assigned;
	};
	/** Replace the file's identity, as a rename-over or recreate would. */
	const reinode = (path: string): void => {
		inodes.set(path, nextInode++);
	};

	/** The read gate: set by {@link MemFs.gateNextRead}, consumed by one `readAlloc`. */
	let readGate:
		| { readonly promise: Promise<void>; readonly enter: () => void; readonly sampleFirst: boolean }
		| undefined;

	const write = (path: string, bytes: Uint8Array | string): void => {
		files.set(path, typeof bytes === "string" ? encoder.encode(bytes) : bytes);
		const parent = path.slice(0, Math.max(0, lastSeparator(path)));
		if (parent !== "") directories.add(parent);
		inodeOf(path);
	};

	const openFile = (path: string, flag: string) =>
		Effect.sync(() => {
			if (flag.startsWith("a") && !files.has(path)) {
				files.set(path, new Uint8Array(0));
			}
			let position = 0;
			return {
				[FileSystem.FileTypeId]: FileSystem.FileTypeId,
				fd: 0 as never,
				stat: Effect.sync(() => ({ size: BigInt(files.get(path)?.length ?? 0) })) as never,
				seek: (offset: FileSystem.SizeInput) =>
					Effect.sync(() => {
						position = Number(offset);
					}),
				sync: Effect.void,
				read: () => Effect.succeed(0 as never),
				readAlloc: (size: FileSystem.SizeInput) =>
					Effect.gen(function* () {
						const gate = readGate;
						if (gate?.sampleFirst === false) {
							readGate = undefined;
							gate.enter();
							yield* Effect.promise(() => gate.promise);
						}
						const current = files.get(path) ?? new Uint8Array(0);
						// A real handle advances its own position; a double that does not
						// makes every chunked read re-read the same bytes, so the
						// multi-chunk path in `readRangeText` would never be exercised.
						const slice = new Uint8Array(current.subarray(position, position + Number(size)));
						position += slice.length;
						if (gate?.sampleFirst === true) {
							readGate = undefined;
							gate.enter();
							// Suspend AFTER sampling, exactly as a `read(2)` that raced a
							// concurrent append behaves: the bytes are the file as of the
							// moment the read took them.
							yield* Effect.promise(() => gate.promise);
						}
						return slice.length === 0 ? Option.none<Uint8Array>() : Option.some(slice);
					}),
				truncate: () => Effect.void,
				write: (buffer: Uint8Array) =>
					Effect.sync(() => {
						const current = files.get(path) ?? new Uint8Array(0);
						const next = new Uint8Array(current.length + buffer.length);
						next.set(current);
						next.set(buffer, current.length);
						files.set(path, next);
						return buffer.length as never;
					}),
				// Appends at the END regardless of `position`, which is what O_APPEND
				// means. Modeling it as a positional write would make the service's
				// offset bookkeeping look correct while the real thing tore.
				writeAll: (buffer: Uint8Array) =>
					Effect.gen(function* () {
						if (gate !== undefined) {
							gateEntered = true;
							yield* Effect.promise(() => gate ?? Promise.resolve());
						}
						const current = files.get(path) ?? new Uint8Array(0);
						const next = new Uint8Array(current.length + buffer.length);
						next.set(current);
						next.set(buffer, current.length);
						files.set(path, next);
					}),
			} as unknown as FileSystem.File;
		});

	const watchers = new Map<string, Set<(event: FileSystem.WatchEvent) => void>>();
	const notify = (target: string, event: FileSystem.WatchEvent): void => {
		for (const listener of watchers.get(target) ?? []) {
			listener(event);
		}
	};

	const layer = FileSystem.layerNoop({
		// Shaped like the real backend, and the shape is load-bearing: it `stat`s
		// the path OUTSIDE the callback and unwraps the result, so a missing path
		// fails the STREAM typed. Failing inside `Stream.callback` would not do —
		// that effect is forked, so its failure never reaches the stream and the
		// watch would hang instead of ending. And a raw `throw` here would be a
		// defect, which `Effect.ignore` does not absorb, so the double would kill
		// the supervisor fibre where the real backend merely ends a watch.
		watch: ((target: string) =>
			Stream.unwrap(
				Effect.gen(function* () {
					beforeWatchHook?.(target);
					const isDirectory =
						directories.has(target) || [...files.keys()].some((file) => file.startsWith(`${target}/`));
					if (!files.has(target) && !isDirectory) {
						return yield* Effect.fail(
							PlatformError.systemError({
								_tag: "NotFound",
								module: "FileSystem",
								method: "watch",
								pathOrDescriptor: target,
								description: "no such file or directory",
							}),
						);
					}
					return Stream.callback<FileSystem.WatchEvent>((queue) =>
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
							// alive for as long as the watch should. Without this the stream
							// ended the instant it registered.
							Effect.andThen(Effect.never),
						),
					);
				}),
			)) as never,
		exists: (path: string) =>
			Effect.sync(() => {
				existsCallCount += 1;
				return files.has(path);
			}),
		// Carries `dev`/`ino` as a real backend does. Returning only `size` made
		// `Option.map(info.ino, …)` throw on a bare `undefined`, which killed the
		// watcher supervisor as a silent defect — a double that is too thin fails
		// the code under test rather than the test.
		stat: (path: string) =>
			Effect.sync(() => ({
				size: BigInt(files.get(path)?.length ?? 0),
				dev: 1,
				ino: Option.some(inodeOf(path)),
			})) as never,
		remove: (path: string) =>
			Effect.sync(() => {
				files.delete(path);
				// The inode goes with the file. Keeping it would hand a
				// remove-then-recreate cycle the OLD identity, so `identityOf` would see
				// one continuous file and the `"replaced"` resync branch would be
				// unreachable through this double.
				inodes.delete(path);
			}),
		open: ((path: string, options?: { readonly flag?: string }) =>
			Effect.acquireRelease(openFile(path, options?.flag ?? "r"), () => Effect.void)) as never,
	});

	return {
		layer,
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
			// CONTENT events go to the file's own watchers and nowhere else. A
			// non-recursive directory watch does not reliably report a child's
			// appends, so routing them there too would make a journal that never
			// handed off from the activation watch to the file watch look healthy.
			notify(path, { _tag: "Update", path } as unknown as FileSystem.WatchEvent);
		},
		pokeParent: (path) => {
			const directory = path.slice(0, Math.max(0, lastSeparator(path))) || ".";
			// A directory watcher receives the BARE BASENAME, as the node backend
			// does — which is why the activation path must never use event.path to
			// open anything. The tag is `Remove` for a creation, which is what the
			// probe measured the node backend reporting.
			notify(directory, {
				_tag: "Remove",
				path: path.slice(lastSeparator(path) + 1),
			} as unknown as FileSystem.WatchEvent);
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
		mkdir: (path) => {
			directories.add(path);
		},
		beforeWatch: (hook) => {
			beforeWatchHook = hook;
		},
		replace: (path, bytes) => {
			write(path, bytes);
			reinode(path);
		},
		bytes: (path) => files.get(path),
		write,
		unlink: (path) => {
			files.delete(path);
			inodes.delete(path);
		},
		has: (path) => files.has(path),
		paths: () => [...files.keys()],
	};
};

/** Decode a stored file back to text, for assertions. */
export const textOf = (memfs: MemFs, path: string): string => {
	const bytes = memfs.bytes(path);
	return bytes === undefined ? "" : new TextDecoder().decode(bytes);
};
