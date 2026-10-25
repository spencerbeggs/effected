// KIT EXTENSION (fault injection). The delegate-by-default wrapper behind
// `makeFaulty`, `layerFaulty` and `options.faults`: handlers run first, and a
// handler answering `undefined` delegates to the wrapped filesystem.

import { Effect, FileSystem } from "effect";
import type {
	MemoryFileSystemFaultMethod,
	MemoryFileSystemFaults,
	MemoryFileSystemFaultsFactory,
	MemoryFileSystemFileFaults,
	MemoryFileSystemSpies,
	MemoryFileSystemTransientFault,
} from "../MemoryFileSystem.js";

// The armed form of a fault: per-method parameter and return typing is erased
// for storage in the method → handler map (a handler may return an Effect, a
// Stream, a Sink, or undefined); `wrapFaulty` restores it at each call site.
type ArmedHandler = (...args: ReadonlyArray<unknown>) => unknown;

const armFault = (fault: ArmedHandler | MemoryFileSystemTransientFault): ArmedHandler => {
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

/**
 * Throws a `RangeError` naming any fault key that is not a function-valued
 * member of `target`. A misspelled key would otherwise be ignored silently and
 * the test would pass without its fault ever firing — a wiring bug, surfaced at
 * construction like `failTimes`' invalid counts.
 */
export const assertKnownFaultKeys = (faults: object, target: object, subject: string): void => {
	const members = new Set(
		Object.keys(target).filter((key) => typeof (target as Record<string, unknown>)[key] === "function"),
	);
	const unknown = Object.keys(faults).filter((key) => !members.has(key));
	if (unknown.length > 0) {
		throw new RangeError(
			`${subject}: unknown fault key(s) ${unknown.map((key) => `"${key}"`).join(", ")}; expected one of ${[...members].sort().join(", ")}`,
		);
	}
};

export const wrapFaulty = (
	base: FileSystem.FileSystem,
	registration: MemoryFileSystemFaults | MemoryFileSystemFaultsFactory,
	spies?: MemoryFileSystemSpies,
): FileSystem.FileSystem => {
	const faults = typeof registration === "function" ? registration(base) : registration;
	assertKnownFaultKeys(faults, base, "MemoryFileSystem faults");
	if (spies !== undefined) assertKnownFaultKeys(spies, base, "MemoryFileSystem spies");
	const armed = new Map<MemoryFileSystemFaultMethod, ArmedHandler>();
	for (const method of Object.keys(faults) as Array<MemoryFileSystemFaultMethod>) {
		const fault = faults[method];
		if (fault !== undefined) {
			armed.set(method, armFault(fault as ArmedHandler | MemoryFileSystemTransientFault));
		}
	}
	// KIT EXTENSION (spies): a spy runs first and its return value is
	// discarded, so it observes every call — one a fault then fails included —
	// and can never replace one. It rides the same interception, so it runs per
	// execution and propagates into derived members exactly as a fault does.
	for (const method of Object.keys(spies ?? {}) as Array<MemoryFileSystemFaultMethod>) {
		const spy = spies?.[method] as ArmedHandler | undefined;
		if (spy === undefined) continue;
		const fault = armed.get(method);
		armed.set(method, (...args) => {
			spy(...args);
			return fault?.(...args);
		});
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
		lstat: intercept("lstat", base.lstat),
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

// KIT EXTENSION (file decoration). A `File` is commonly a class instance whose
// members live on its prototype (memfs's own is), so a spread copies none of
// them. This forwards every member by name, consulting a handler first; each
// member is intercepted on its own — the wrapped file's `writeAll` still
// calls its OWN `write`, never the decorated one.
const fileMethods = ["seek", "read", "readAlloc", "truncate", "write", "writeAll"] as const;
const fileMembers: ReadonlyArray<string> = [...fileMethods, "stat", "sync"];

export const wrapFile = (file: FileSystem.File, overrides: MemoryFileSystemFileFaults): FileSystem.File => {
	const unknown = Object.keys(overrides).filter((key) => !fileMembers.includes(key));
	if (unknown.length > 0) {
		throw new RangeError(
			`MemoryFileSystem.wrapFile: unknown override key(s) ${unknown.map((key) => `"${key}"`).join(", ")}; expected one of ${[...fileMembers].sort().join(", ")}`,
		);
	}
	const armed = new Map<string, ArmedHandler>();
	for (const [key, fault] of Object.entries(overrides)) {
		if (fault !== undefined) armed.set(key, armFault(fault as ArmedHandler | MemoryFileSystemTransientFault));
	}
	type Delegate = (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown, unknown>;
	const method = (name: (typeof fileMethods)[number]) => {
		const handler = armed.get(name);
		const delegate = (...args: ReadonlyArray<unknown>) => (file[name] as Delegate).call(file, ...args);
		return handler === undefined
			? delegate
			: (...args: ReadonlyArray<unknown>) =>
					Effect.suspend(() => (handler(...args) as Effect.Effect<unknown, unknown> | undefined) ?? delegate(...args));
	};
	// `stat` and `sync` are Effect-valued members, read afresh on each access
	// (memfs's are getters), so the wrapper reads them lazily too.
	const property = (name: "stat" | "sync") => {
		const handler = armed.get(name);
		return handler === undefined
			? () => file[name]
			: () => Effect.suspend(() => (handler() as Effect.Effect<unknown, unknown> | undefined) ?? file[name]);
	};
	const stat = property("stat");
	const sync = property("sync");
	return {
		[FileSystem.FileTypeId]: FileSystem.FileTypeId,
		get stat() {
			return stat() as FileSystem.File["stat"];
		},
		get sync() {
			return sync() as FileSystem.File["sync"];
		},
		seek: method("seek") as FileSystem.File["seek"],
		read: method("read") as FileSystem.File["read"],
		readAlloc: method("readAlloc") as FileSystem.File["readAlloc"],
		truncate: method("truncate") as FileSystem.File["truncate"],
		write: method("write") as FileSystem.File["write"],
		writeAll: method("writeAll") as FileSystem.File["writeAll"],
	};
};
