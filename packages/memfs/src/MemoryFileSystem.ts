// The facade over the vendored engine (see internal/volume.ts for the port
// header and the adaptation ledger pointer). Everything in this file — the
// seeding API and the fault-injection wrapper — is a kit extension, not part
// of the vendored port.

import type { PlatformError } from "effect";
import { Effect, FileSystem, Layer } from "effect";
import * as internal from "./internal/volume.js";

/**
 * A seed entry describing a file, optionally carrying its initial permission
 * mode — built with {@link MemoryFileSystem.file}.
 *
 * @public
 */
export interface MemoryFileSystemSeedFile {
	readonly _tag: "MemoryFileSystemSeedFile";
	/** File contents; strings are UTF-8 encoded, `Uint8Array`s written verbatim. */
	readonly content: string | Uint8Array;
	/** Initial permission bits (defaults to the volume's `0o644`). */
	readonly mode?: number;
}

/**
 * A seed entry describing a directory — built with
 * {@link MemoryFileSystem.directory}. The only way a seed can express an *empty*
 * directory, and the way a directory receives an initial permission mode.
 *
 * @public
 */
export interface MemoryFileSystemSeedDirectory {
	readonly _tag: "MemoryFileSystemSeedDirectory";
	/** Initial permission bits (defaults to the volume's `0o755`). */
	readonly mode?: number;
}

/**
 * A seed entry describing a symbolic link — built with
 * {@link MemoryFileSystem.symlink}.
 *
 * @public
 */
export interface MemoryFileSystemSeedSymlink {
	readonly _tag: "MemoryFileSystemSeedSymlink";
	/** The link target, stored verbatim; it may dangle. */
	readonly target: string;
}

/**
 * One value in a {@link MemoryFileSystemSeed}: plain file contents
 * (`string | Uint8Array`, unchanged from the original seed shape), or a tagged
 * entry describing a file with a mode, a directory, or a symbolic link.
 *
 * @public
 */
export type MemoryFileSystemSeedEntry =
	| string
	| Uint8Array
	| MemoryFileSystemSeedFile
	| MemoryFileSystemSeedDirectory
	| MemoryFileSystemSeedSymlink;

/**
 * A volume seed: absolute POSIX paths mapped to seed entries.
 *
 * @remarks
 * Plain `string` values are UTF-8 encoded; `Uint8Array` values are written
 * verbatim. Tagged entries built with {@link MemoryFileSystem.file},
 * {@link MemoryFileSystem.directory} and {@link MemoryFileSystem.symlink} let one
 * seed literal describe a whole tree — empty directories, symbolic links, and
 * initial permission modes included. Parent directories are created
 * recursively before each entry, so a seed never has to list them.
 *
 * Entries are applied in the seed's own key order; a symlink may target a path
 * seeded later (or never — dangling links are legal).
 *
 * @public
 */
export interface MemoryFileSystemSeed {
	readonly [path: string]: MemoryFileSystemSeedEntry;
}

/**
 * The members of `FileSystem.FileSystem` that a fault handler can intercept:
 * every function-valued method, the `Stream`/`Sink`-returning trio (`stream`,
 * `sink`, `watch`) included. Only {@link MemoryFileSystem.failTimes} is
 * narrower — a transient fault substitutes a failing `Effect`, so it slots
 * into the `Effect`-returning methods alone.
 *
 * @public
 */
export type MemoryFileSystemFaultMethod = {
	[Method in keyof FileSystem.FileSystem]: FileSystem.FileSystem[Method] extends (...args: never) => unknown
		? Method
		: never;
}[keyof FileSystem.FileSystem];

/**
 * A fault handler for one `FileSystem` method. It receives the real call
 * arguments (path, mode, options…), so a fault can be path- or mode-specific.
 * Returning a value replaces the call — typically
 * `Effect.fail(PlatformError.systemError({...}))`, a `Stream`/`Sink` for the
 * `stream`/`sink`/`watch` members, though a canned success is equally valid;
 * returning `undefined` **declines**, delegating the call to the wrapped
 * filesystem. The return type is the method's own, so an injected failure is
 * constrained to the method's `PlatformError` channel — a bare `new Error`
 * does not typecheck. This delegate-by-default posture is the whole
 * difference from `FileSystem.layerNoop`, which denies unlisted methods.
 *
 * @public
 */
export type MemoryFileSystemFaultHandler<Method extends MemoryFileSystemFaultMethod> = (
	...args: Parameters<FileSystem.FileSystem[Method]>
) => ReturnType<FileSystem.FileSystem[Method]> | undefined;

/**
 * A transient fault built with {@link MemoryFileSystem.failTimes}: usable
 * anywhere a fault handler is, it fails a fixed number of calls with a given
 * `PlatformError` and then delegates forever after.
 *
 * @remarks
 * The countdown state is **armed per volume build** — see
 * {@link MemoryFileSystem.failTimes} for exactly when a counter is shared and
 * when it is re-armed.
 *
 * @public
 */
export interface MemoryFileSystemTransientFault {
	readonly _tag: "MemoryFileSystemTransientFault";
	/** How many calls fail before the fault starts delegating. */
	readonly times: number;
	/** The typed failure each of those calls fails with. */
	readonly error: PlatformError.PlatformError;
}

/**
 * The fault registration map for {@link MemoryFileSystem.makeFaulty} and
 * {@link MemoryFileSystem.layerFaulty}: per intercepted method, either a
 * {@link MemoryFileSystemFaultHandler} or — on the `Effect`-returning methods
 * — a {@link MemoryFileSystemTransientFault}. Methods absent from the map are
 * never intercepted.
 *
 * @public
 */
export type MemoryFileSystemFaults = {
	readonly [Method in MemoryFileSystemFaultMethod]?:
		| MemoryFileSystemFaultHandler<Method>
		| (Effect.Effect<never, PlatformError.PlatformError> extends ReturnType<FileSystem.FileSystem[Method]>
				? MemoryFileSystemTransientFault
				: never);
};

const encoder = new TextEncoder();

const seedVolume = (
	fs: FileSystem.FileSystem,
	seed: MemoryFileSystemSeed,
): Effect.Effect<void, PlatformError.PlatformError> =>
	Effect.gen(function* () {
		for (const [path, entry] of Object.entries(seed)) {
			const separator = path.lastIndexOf("/");
			const parent = separator <= 0 ? "/" : path.slice(0, separator);
			if (parent !== "/") {
				yield* fs.makeDirectory(parent, { recursive: true });
			}
			if (typeof entry === "string" || entry instanceof Uint8Array) {
				yield* fs.writeFile(path, typeof entry === "string" ? encoder.encode(entry) : entry);
				continue;
			}
			switch (entry._tag) {
				case "MemoryFileSystemSeedFile": {
					const data = typeof entry.content === "string" ? encoder.encode(entry.content) : entry.content;
					yield* fs.writeFile(path, data, entry.mode !== undefined ? { mode: entry.mode } : undefined);
					break;
				}
				case "MemoryFileSystemSeedDirectory": {
					yield* fs.makeDirectory(path, { recursive: true });
					// Applied via chmod rather than makeDirectory's mode option so the
					// mode also lands when the directory already exists — e.g. created
					// implicitly as an earlier entry's parent.
					if (entry.mode !== undefined) {
						yield* fs.chmod(path, entry.mode);
					}
					break;
				}
				case "MemoryFileSystemSeedSymlink": {
					yield* fs.symlink(entry.target, path);
					break;
				}
			}
		}
	});

// The armed form of a fault: per-method parameter and return typing is erased
// for storage in the method → handler map (a handler may return an Effect, a
// Stream, a Sink, or undefined); `wrapFaulty` restores it at each call site.
type ArmedHandler = (...args: ReadonlyArray<unknown>) => unknown;

const armFault = (fault: NonNullable<MemoryFileSystemFaults[MemoryFileSystemFaultMethod]>): ArmedHandler => {
	if (typeof fault === "function") {
		return fault as ArmedHandler;
	}
	let remaining = fault.times;
	return () => {
		if (remaining <= 0) {
			return undefined;
		}
		remaining -= 1;
		return Effect.fail(fault.error);
	};
};

const wrapFaulty = (base: FileSystem.FileSystem, faults: MemoryFileSystemFaults): FileSystem.FileSystem => {
	const armed = new Map<MemoryFileSystemFaultMethod, ArmedHandler>();
	for (const method of Object.keys(faults) as Array<MemoryFileSystemFaultMethod>) {
		const fault = faults[method];
		if (fault !== undefined) {
			armed.set(method, armFault(fault));
		}
	}
	// Effect-returning methods defer through Effect.suspend so each EXECUTION
	// re-consults its handler — a retried effect re-decides, which is what lets
	// failTimes count Effect.retry attempts rather than method invocations.
	const intercept = <Method extends MemoryFileSystemFaultMethod>(
		method: Method,
		target: FileSystem.FileSystem[Method],
	): FileSystem.FileSystem[Method] => {
		const handler = armed.get(method);
		if (handler === undefined) {
			return target;
		}
		const delegate = target as (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown, unknown>;
		const intercepted = (...args: ReadonlyArray<unknown>) =>
			Effect.suspend(() => (handler(...args) ?? delegate(...args)) as Effect.Effect<unknown, unknown, unknown>);
		return intercepted as FileSystem.FileSystem[Method];
	};
	// `stream`, `sink` and `watch` return Streams/Sinks — lazy by construction
	// — so their handlers are consulted when the method is called; the value
	// the handler returns (or the delegate's) carries its own per-run laziness.
	const interceptLazy = <Method extends "sink" | "stream" | "watch">(
		method: Method,
		target: FileSystem.FileSystem[Method],
	): FileSystem.FileSystem[Method] => {
		const handler = armed.get(method);
		if (handler === undefined) {
			return target;
		}
		const delegate = target as (...args: ReadonlyArray<unknown>) => unknown;
		const intercepted = (...args: ReadonlyArray<unknown>) => handler(...args) ?? delegate(...args);
		return intercepted as FileSystem.FileSystem[Method];
	};
	// Rebuilding through FileSystem.make re-derives `exists`, `readFileString`,
	// `writeFileString`, `stream` and `sink` from the intercepted core methods,
	// so a fault registered on e.g. `readFile` or `open` propagates coherently
	// into the members derived from it — exactly as an OS-level failure would.
	// The five derived members are destructured out of the spread so the
	// contract is explicit rather than relying on `make` to overwrite them.
	const {
		exists: _exists,
		readFileString: _readFileString,
		sink: _sink,
		stream: _stream,
		writeFileString: _writeFileString,
		...primitives
	} = base;
	const core = FileSystem.make({
		...primitives,
		access: intercept("access", base.access),
		chmod: intercept("chmod", base.chmod),
		chown: intercept("chown", base.chown),
		copy: intercept("copy", base.copy),
		copyFile: intercept("copyFile", base.copyFile),
		glob: intercept("glob", base.glob),
		link: intercept("link", base.link),
		makeDirectory: intercept("makeDirectory", base.makeDirectory),
		makeTempDirectory: intercept("makeTempDirectory", base.makeTempDirectory),
		makeTempDirectoryScoped: intercept("makeTempDirectoryScoped", base.makeTempDirectoryScoped),
		makeTempFile: intercept("makeTempFile", base.makeTempFile),
		makeTempFileScoped: intercept("makeTempFileScoped", base.makeTempFileScoped),
		open: intercept("open", base.open),
		readDirectory: intercept("readDirectory", base.readDirectory),
		readFile: intercept("readFile", base.readFile),
		readLink: intercept("readLink", base.readLink),
		realPath: intercept("realPath", base.realPath),
		remove: intercept("remove", base.remove),
		rename: intercept("rename", base.rename),
		stat: intercept("stat", base.stat),
		symlink: intercept("symlink", base.symlink),
		truncate: intercept("truncate", base.truncate),
		utimes: intercept("utimes", base.utimes),
		watch: interceptLazy("watch", base.watch),
		writeFile: intercept("writeFile", base.writeFile),
	});
	return {
		...core,
		exists: intercept("exists", core.exists),
		readFileString: intercept("readFileString", core.readFileString),
		sink: interceptLazy("sink", core.sink),
		stream: interceptLazy("stream", core.stream),
		writeFileString: intercept("writeFileString", core.writeFileString),
	};
};

/**
 * An in-memory implementation of core Effect's `FileSystem` service: an
 * isolated virtual POSIX volume — files, directories, symlinks, hard links,
 * open descriptors, temporary resources, globbing, watching — behind the
 * standard `FileSystem.FileSystem` key.
 *
 * @remarks
 * The founding contract is **honest absence**: reading, statting, or opening
 * (without a create flag) a path nothing seeded fails typed with a `NotFound`
 * `SystemError` — the volume never fabricates content for a path nothing
 * arranged.
 *
 * Behavioral notes shared by every constructor:
 *
 * - Each built filesystem is one isolated volume, and layer memoization is
 *   **per-build**: every `Effect.provide` of a layer value — even the same
 *   bound `const` — builds and re-seeds a fresh volume. Sharing one volume
 *   across several effects therefore requires one provide over one composed
 *   layer graph (compose with `Layer.provideMerge`, or a suite-boundary
 *   `layer(...)` block); within that one build, every consumer of the layer
 *   value sees the same volume, and `Layer.fresh` is how a consumer *inside*
 *   the same graph opts back out into its own volume. Across separate builds
 *   `Layer.fresh` has no role — separate provides already build separate
 *   volumes, so there is nothing to isolate.
 * - **Permission modes are metadata, never enforced.** Modes set by seeding,
 *   `chmod`, `makeDirectory` or `writeFile` are recorded faithfully and
 *   readable via `stat`, but no operation checks them: the volume models no
 *   process identity (no uid/gid/umask), so no read, write, traversal or
 *   removal ever fails `PermissionDenied` on its own. Likewise `access`
 *   checks existence only, deliberately ignoring its
 *   `readable`/`writable`/`ok` options. To exercise a permission-failure code
 *   path, inject the failure with {@link MemoryFileSystem.layerFaulty}
 *   instead.
 * - Relative paths resolve from the virtual root `/`: the `FileSystem`
 *   contract has no working-directory operation.
 * - Malformed input fails through the typed `PlatformError` channel, never as
 *   a defect; pathological directory or brace-nesting depth fails typed at the
 *   engine's nesting bound.
 *
 * @example
 * ```ts
 * import { MemoryFileSystem } from "@effected/memfs";
 * import { Effect, FileSystem } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const fs = yield* FileSystem.FileSystem;
 *   return yield* fs.readFileString("/repo/package.json");
 * });
 *
 * const SeededFs = MemoryFileSystem.layerWith({
 *   "/repo/package.json": `{ "name": "fixture" }`,
 *   "/repo/tools/build.sh": MemoryFileSystem.file("#!/bin/sh\n", { mode: 0o755 }),
 *   "/repo/.cache": MemoryFileSystem.directory(),
 *   "/repo/latest": MemoryFileSystem.symlink("/repo/package.json"),
 * });
 *
 * program.pipe(Effect.provide(SeededFs));
 * ```
 *
 * @public
 */
export class MemoryFileSystem {
	/**
	 * Builds a `FileSystem` service backed by a fresh, empty in-memory volume.
	 */
	static readonly make: Effect.Effect<FileSystem.FileSystem> = internal.make;

	/**
	 * Builds a `FileSystem` service backed by a fresh volume pre-populated from
	 * `seed`.
	 *
	 * @remarks
	 * Fails typed when the seed contradicts itself — for example a file seeded
	 * at a path another entry needs as a directory, or a tagged entry carrying
	 * an invalid mode. Everything absent from the seed stays absent: reads of
	 * unseeded paths fail `NotFound`.
	 *
	 * @param seed - Absolute POSIX paths mapped to seed entries.
	 */
	static readonly makeWith = (
		seed: MemoryFileSystemSeed,
	): Effect.Effect<FileSystem.FileSystem, PlatformError.PlatformError> =>
		Effect.gen(function* () {
			const fs = yield* internal.make;
			yield* seedVolume(fs, seed);
			return fs;
		});

	/**
	 * Wraps an existing `FileSystem` so that registered faults can intercept
	 * calls, delegating everything else — and every declined call — to the
	 * wrapped filesystem.
	 *
	 * @remarks
	 * The pure core of {@link MemoryFileSystem.layerFaulty} — most tests want
	 * that layer form (or {@link MemoryFileSystem.layerFaultyWith}) and its
	 * `Layer.provide` composition; see there for the interception semantics.
	 * Reach for `makeFaulty` directly when composing a filesystem *value* by
	 * hand (e.g. over {@link MemoryFileSystem.makeWith}). Each call arms its
	 * own transient-fault counters.
	 *
	 * @param base - The filesystem to wrap; any implementation works.
	 * @param faults - The fault registration map.
	 */
	static readonly makeFaulty = (base: FileSystem.FileSystem, faults: MemoryFileSystemFaults): FileSystem.FileSystem =>
		wrapFaulty(base, faults);

	/**
	 * A layer that wraps whatever `FileSystem` is provided to it with fault
	 * interception: only methods registered in `faults` are intercepted, and a
	 * handler that declines (returns `undefined`) delegates to the wrapped
	 * filesystem — delegate-by-default, the opposite of `layerNoop`'s
	 * deny-by-default.
	 *
	 * @remarks
	 * Handlers receive the real call arguments, so a fault can key on the path
	 * or mode of one specific call. Injected failures should be genuine
	 * `PlatformError` values (`PlatformError.systemError` /
	 * `PlatformError.badArgument`) — that is what every real `FileSystem`
	 * implementation fails with, and tests asserting on the error channel
	 * depend on it.
	 *
	 * Interception scope: every function-valued method
	 * ({@link MemoryFileSystemFaultMethod}). Handlers on the Effect-returning
	 * methods are consulted at each *execution* — a retried effect re-consults
	 * its handler, which is what lets {@link MemoryFileSystem.failTimes} count
	 * `Effect.retry` attempts; handlers on `stream`, `sink` and `watch` are
	 * consulted when the method is called and return a replacement `Stream` or
	 * `Sink`. The derived members (`exists` from `access`, `readFileString`
	 * from `readFile`, `writeFileString` from `writeFile`, `stream` and `sink`
	 * from `open`) are re-derived over the intercepted core methods, so a
	 * fault on a core method propagates coherently into them — and each
	 * derived member remains directly interceptable in its own right.
	 *
	 * A parameterized layer factory: bind the result to a `const`. Transient
	 * counters ({@link MemoryFileSystem.failTimes}) are armed once per layer
	 * build — consumers within one provided layer graph share them, and a
	 * separate `Effect.provide` re-arms them.
	 *
	 * @example
	 * ```ts
	 * import { MemoryFileSystem } from "@effected/memfs";
	 * import { Effect, Layer, PlatformError } from "effect";
	 *
	 * const Volume = MemoryFileSystem.layerWith({ "/repo/src/a.ts": "export {}\n" });
	 *
	 * // chmod fails only when relocking (0o555/0o444); the unlock pass (0o755)
	 * // and every other method reach the real volume.
	 * const Faulty = MemoryFileSystem.layerFaulty({
	 *   chmod: (path, mode) =>
	 *     mode === 0o555 || mode === 0o444
	 *       ? Effect.fail(
	 *           PlatformError.systemError({
	 *             _tag: "PermissionDenied",
	 *             module: "FileSystem",
	 *             method: "chmod",
	 *             pathOrDescriptor: path,
	 *           }),
	 *         )
	 *       : undefined,
	 * }).pipe(Layer.provide(Volume));
	 * ```
	 *
	 * @param faults - The fault registration map.
	 */
	static readonly layerFaulty = (
		faults: MemoryFileSystemFaults,
	): Layer.Layer<FileSystem.FileSystem, never, FileSystem.FileSystem> =>
		Layer.effect(
			FileSystem.FileSystem,
			Effect.gen(function* () {
				const base = yield* FileSystem.FileSystem;
				return wrapFaulty(base, faults);
			}),
		);

	/**
	 * The seeded convenience form of {@link MemoryFileSystem.layerFaulty}: a
	 * self-contained layer wrapping a fresh volume seeded from `seed`.
	 *
	 * @remarks
	 * Equivalent to `layerFaulty(faults)` provided with `layerWith(seed)`. All
	 * of {@link MemoryFileSystem.layerFaulty}'s interception semantics and
	 * {@link MemoryFileSystem.layerWith}'s seeding and memoization semantics
	 * apply.
	 *
	 * @param seed - Absolute POSIX paths mapped to seed entries.
	 * @param faults - The fault registration map.
	 */
	static readonly layerFaultyWith = (
		seed: MemoryFileSystemSeed,
		faults: MemoryFileSystemFaults,
	): Layer.Layer<FileSystem.FileSystem> =>
		Layer.provide(MemoryFileSystem.layerFaulty(faults), MemoryFileSystem.layerWith(seed));

	/**
	 * A transient fault: fails the first `times` intercepted calls with `error`,
	 * then delegates to the wrapped filesystem forever after — the shape a
	 * retry-policy test needs.
	 *
	 * @remarks
	 * Usable as any value of the fault registration map. The countdown is
	 * **armed per volume build**: each `makeFaulty` call — and each build of a
	 * `layerFaulty`/`layerFaultyWith` layer — starts a fresh counter from
	 * `times`. Layer memoization is per-build, so consumers within one provided
	 * layer graph share one counter, while a separate `Effect.provide` of the
	 * same layer value re-arms it. In particular, a suite-boundary
	 * `@effect/vitest` `layer(...)` memoizes ONE build for the whole suite, so a
	 * transient fault declared there is consumed by whichever test runs first
	 * and later tests silently see it exhausted — declare the fault in a
	 * `Layer.fresh`-wrapped (or per-test-provided) layer instead.
	 *
	 * Transient faults slot into the `Effect`-returning methods only — the
	 * substitute is a failing `Effect`, which cannot stand in for the
	 * `Stream`/`Sink`-returning members (use a handler returning `Stream.fail`
	 * there instead).
	 *
	 * Throws a `RangeError` at construction when `times` is negative or not an
	 * integer — misuse is a wiring bug, matching `layerWith`'s posture on
	 * contradictory seeds, never runtime input.
	 *
	 * @example
	 * ```ts
	 * import { MemoryFileSystem } from "@effected/memfs";
	 * import { PlatformError } from "effect";
	 *
	 * const flaky = MemoryFileSystem.layerFaultyWith(
	 *   { "/config.json": "{}" },
	 *   {
	 *     readFileString: MemoryFileSystem.failTimes(
	 *       2,
	 *       PlatformError.systemError({
	 *         _tag: "Busy",
	 *         module: "FileSystem",
	 *         method: "readFileString",
	 *         pathOrDescriptor: "/config.json",
	 *       }),
	 *     ),
	 *   },
	 * );
	 * ```
	 *
	 * @param times - How many calls fail before delegation begins.
	 * @param error - The typed failure each of those calls fails with.
	 */
	static readonly failTimes = (times: number, error: PlatformError.PlatformError): MemoryFileSystemTransientFault => {
		if (!Number.isInteger(times) || times < 0) {
			throw new RangeError(`failTimes: times must be a non-negative integer, got ${String(times)}`);
		}
		return { _tag: "MemoryFileSystemTransientFault", times, error };
	};

	/**
	 * A seed entry for a file, optionally carrying its initial permission mode.
	 *
	 * @remarks
	 * `MemoryFileSystem.file(content)` is equivalent to seeding `content`
	 * directly; the tagged form exists for the `mode` option. Modes are
	 * recorded and readable via `stat`, never enforced (see the class notes).
	 *
	 * @param content - File contents; strings are UTF-8 encoded.
	 * @param options - `mode`: initial permission bits (default `0o644`).
	 */
	static readonly file = (
		content: string | Uint8Array,
		options?: { readonly mode?: number | undefined },
	): MemoryFileSystemSeedFile => ({
		_tag: "MemoryFileSystemSeedFile",
		content,
		...(options?.mode !== undefined ? { mode: options.mode } : {}),
	});

	/**
	 * A seed entry for a directory — the way a seed expresses an *empty*
	 * directory, or one with an initial permission mode.
	 *
	 * @remarks
	 * The mode also applies when the directory already exists at seeding time
	 * (for example, created implicitly as an earlier entry's parent). Modes are
	 * recorded and readable via `stat`, never enforced (see the class notes).
	 *
	 * @param options - `mode`: initial permission bits (default `0o755`).
	 */
	static readonly directory = (options?: { readonly mode?: number | undefined }): MemoryFileSystemSeedDirectory => ({
		_tag: "MemoryFileSystemSeedDirectory",
		...(options?.mode !== undefined ? { mode: options.mode } : {}),
	});

	/**
	 * A seed entry for a symbolic link to `target`.
	 *
	 * @remarks
	 * The target is stored verbatim and resolved lazily on traversal, exactly
	 * like `fs.symlink` — it may point at a path seeded later, or dangle.
	 *
	 * @param target - The link target path.
	 */
	static readonly symlink = (target: string): MemoryFileSystemSeedSymlink => ({
		_tag: "MemoryFileSystemSeedSymlink",
		target,
	});

	/**
	 * Provides `FileSystem.FileSystem` backed by a fresh, empty volume.
	 *
	 * @remarks
	 * Layer memoization is per-build: consumers within one provided layer graph
	 * share one volume; each separate `Effect.provide` builds a new one.
	 */
	static readonly layer: Layer.Layer<FileSystem.FileSystem> = internal.layer;

	/**
	 * Provides `FileSystem.FileSystem` backed by a fresh volume pre-populated
	 * from `seed`.
	 *
	 * @remarks
	 * A parameterized layer factory mints a fresh reference per call — bind the
	 * result to a `const` and reuse it rather than calling `layerWith(...)` at
	 * each composition site.
	 *
	 * Layer memoization is **per-build**, not per-value: each separate
	 * `Effect.provide` of the bound `const` builds — and re-seeds — its own
	 * volume, so a write in one provide is invisible to the next. To share one
	 * volume across several effects, run them under a single provide of one
	 * composed layer graph; within that build every consumer of the `const`
	 * sees the same volume (and `Layer.fresh` is how a consumer inside that
	 * graph opts back out into its own).
	 *
	 * A contradictory seed is a test-wiring bug and **dies** with the
	 * underlying typed error as its cause; use
	 * {@link MemoryFileSystem.makeWith} to handle seeding failures in the error
	 * channel instead.
	 *
	 * @example
	 * ```ts
	 * import { MemoryFileSystem } from "@effected/memfs";
	 * import { Effect, FileSystem } from "effect";
	 *
	 * const Volume = MemoryFileSystem.layerWith({ "/a.txt": "seed" });
	 *
	 * const write = Effect.gen(function* () {
	 *   const fs = yield* FileSystem.FileSystem;
	 *   yield* fs.writeFileString("/a.txt", "written");
	 * });
	 * const read = Effect.gen(function* () {
	 *   const fs = yield* FileSystem.FileSystem;
	 *   return yield* fs.readFileString("/a.txt");
	 * });
	 *
	 * // ONE provide, one build, one volume — reads back "written".
	 * const shared = Effect.provide(Effect.andThen(write, read), Volume);
	 *
	 * // TWO provides are two builds: the second is re-seeded — reads back "seed".
	 * const reseeded = Effect.andThen(Effect.provide(write, Volume), Effect.provide(read, Volume));
	 * ```
	 *
	 * @param seed - Absolute POSIX paths mapped to seed entries.
	 */
	static readonly layerWith = (seed: MemoryFileSystemSeed): Layer.Layer<FileSystem.FileSystem> =>
		Layer.effect(FileSystem.FileSystem, Effect.orDie(MemoryFileSystem.makeWith(seed)));

	private constructor() {}
}
