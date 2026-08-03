import type { Layer } from "effect";
import { Effect, FileSystem, Option, Queue, Stream } from "effect";

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
	/** Whether a path exists. */
	readonly has: (path: string) => boolean;
	/** Every path currently present. */
	readonly paths: () => ReadonlyArray<string>;
	/**
	 * Deliver a watch event for `path` to every registered watcher of it or of
	 * its parent directory.
	 *
	 * The deterministic seam: watcher behaviour is driven explicitly instead of
	 * racing a real filesystem, so offset bookkeeping, resync and activation are
	 * timer-free unit tests.
	 */
	readonly poke: (path: string) => void;
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

	const write = (path: string, bytes: Uint8Array | string): void => {
		files.set(path, typeof bytes === "string" ? encoder.encode(bytes) : bytes);
		const parent = path.slice(0, Math.max(0, path.lastIndexOf("/")));
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
					Effect.sync(() => {
						const current = files.get(path) ?? new Uint8Array(0);
						const slice = current.subarray(position, position + Number(size));
						return slice.length === 0 ? Option.none<Uint8Array>() : Option.some(new Uint8Array(slice));
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
		watch: ((target: string) =>
			Stream.callback<FileSystem.WatchEvent>((queue) =>
				Effect.acquireRelease(
					Effect.sync(() => {
						beforeWatchHook?.(target);
						// Mirrors the real backend: watching a path that does not exist
						// fails, which is precisely why activation needs the parent
						// directory rather than the journal itself.
						const isDirectory =
							directories.has(target) || [...files.keys()].some((file) => file.startsWith(`${target}/`));
						if (!files.has(target) && !isDirectory) {
							throw new Error(`ENOENT: ${target}`);
						}
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
			const event = { _tag: "Update", path } as unknown as FileSystem.WatchEvent;
			notify(path, event);
			const directory = path.slice(0, Math.max(0, path.lastIndexOf("/"))) || ".";
			// A directory watcher receives the BARE BASENAME, as the node backend
			// does — which is why the activation path must never use event.path to
			// open anything.
			notify(directory, {
				_tag: "Remove",
				path: path.slice(path.lastIndexOf("/") + 1),
			} as unknown as FileSystem.WatchEvent);
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
		has: (path) => files.has(path),
		paths: () => [...files.keys()],
	};
};

/** Decode a stored file back to text, for assertions. */
export const textOf = (memfs: MemFs, path: string): string => {
	const bytes = memfs.bytes(path);
	return bytes === undefined ? "" : new TextDecoder().decode(bytes);
};
