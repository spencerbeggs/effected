// Both drivers answer the machine's `CreateExclusive` the same way. "failed"
// means the create did not happen, so whatever sits at the path afterwards is
// someone else's: a driver must remove only what IT created. The scenario is
// a rival creating the lock between this caller observing it absent and this
// caller's own exclusive create, which then fails with something other than
// "already exists" (EMFILE). The machine runs unserialized; the rival's lock
// must survive in both drivers.
//
// The other half: the create succeeds and the write fails. The file is ours,
// but by then a breaker may have swept it into its tomb and a rival created
// its lock at the path, so neither driver removes by path. The garbled file
// stays, and a later caller takes it over once it is older than staleMs.

import { assert, describe, it } from "@effect/vitest";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, PlatformError, Result } from "effect";
import { TestClock } from "effect/testing";
import type { RunOnceFileSystem, RunOnceSyncHost } from "../src/RunOnce.js";
import { ProcessLiveness, RunOnce } from "../src/RunOnce.js";

const DIR = "/locks";
const LOCK = `${DIR}/k.lock`;
const OPTIONS = { key: "k", dir: DIR } as const;
const RIVAL = JSON.stringify({ pid: 8, host: "here", nonce: "rival", startedAt: 0 });

const emfile = (method: string, path: string) =>
	PlatformError.systemError({ _tag: "Unknown", module: "FileSystem", method, syscall: "open", pathOrDescriptor: path });

/** End state both drivers must reach: the rival's lock, untouched. */
const EXPECTED = { outcome: { _tag: "RanUnserialized", reason: "lockUnavailable" }, runs: 1, lock: RIVAL } as const;

/**
 * An in-memory sync filesystem, every file stamped with the clock at its last
 * write. The exclusive create of the lock is `onLock`, handed the writer.
 */
const memorySync = (
	files: Map<string, string>,
	now: () => number,
	onLock: (text: string, put: (path: string, text: string) => void) => boolean,
): RunOnceFileSystem => {
	const mtimes = new Map<string, number>();
	const put = (path: string, text: string) => {
		files.set(path, text);
		mtimes.set(path, now());
	};
	return {
		makeDirectory: () => {},
		readText: (path) => files.get(path),
		createExclusive: (path, text) => {
			if (files.has(path)) return false;
			if (path === LOCK) return onLock(text, put);
			put(path, text);
			return true;
		},
		writeText: put,
		remove: (path) => {
			files.delete(path);
			mtimes.delete(path);
		},
		mtimeMs: (path) => (files.has(path) ? mtimes.get(path) : undefined),
		readDirectory: (dir) =>
			[...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)),
		rename: (from, to) => {
			const text = files.get(from);
			if (text === undefined) return false;
			const mtime = mtimes.get(from) ?? now();
			files.delete(from);
			mtimes.delete(from);
			files.set(to, text);
			mtimes.set(to, mtime);
			return true;
		},
	};
};

const host = (fs: RunOnceFileSystem, now: () => number): RunOnceSyncHost => {
	let n = 0;
	return {
		fs,
		liveness: { pid: 7, host: "here", isAlive: () => true },
		now,
		sleep: () => {},
		nonce: () => `n${++n}`,
	};
};

describe("RunOnce drivers: a failing exclusive create of the lock", () => {
	it("the sync driver leaves a rival's lock in place", () => {
		const files = new Map<string, string>();
		const fs: RunOnceFileSystem = {
			makeDirectory: () => {},
			readText: (path) => files.get(path),
			createExclusive: (path, text) => {
				if (path === LOCK) {
					files.set(LOCK, RIVAL);
					throw MemoryFileSystem.errno("EMFILE", "open", path);
				}
				if (files.has(path)) return false;
				files.set(path, text);
				return true;
			},
			writeText: (path, text) => {
				files.set(path, text);
			},
			remove: (path) => {
				files.delete(path);
			},
			mtimeMs: (path) => (files.has(path) ? 0 : undefined),
			readDirectory: (dir) =>
				[...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1)),
			rename: (from, to) => {
				const text = files.get(from);
				if (text === undefined) return false;
				files.delete(from);
				files.set(to, text);
				return true;
			},
		};
		let runs = 0;
		let n = 0;
		const result = RunOnce.runSync(
			OPTIONS,
			{
				fs,
				liveness: { pid: 7, host: "here", isAlive: () => true },
				now: () => 0,
				sleep: () => {},
				nonce: () => `n${++n}`,
			},
			() => {
				runs++;
				return Result.succeed("x");
			},
		);
		assert.isTrue(Result.isSuccess(result));
		if (Result.isSuccess(result)) {
			assert.deepStrictEqual(
				{
					outcome: { _tag: result.success._tag, reason: (result.success as { reason?: string }).reason },
					runs,
					lock: files.get(LOCK),
				},
				EXPECTED,
			);
		}
	});

	it.effect("the Effect driver leaves a rival's lock in place", () => {
		let runs = 0;
		// Either spelling of the exclusive create — `writeFile` with `wx`, or
		// `open` with `wx` — lands the rival's lock and then fails.
		const Faulty = MemoryFileSystem.layerWith(undefined, {
			faults: (base) => ({
				writeFile: (path, _data, options) =>
					path === LOCK && options?.flag === "wx"
						? base.writeFileString(LOCK, RIVAL).pipe(Effect.andThen(Effect.fail(emfile("writeFile", path))))
						: undefined,
				open: (path, options) =>
					path === LOCK && options?.flag === "wx"
						? base.writeFileString(LOCK, RIVAL).pipe(Effect.andThen(Effect.fail(emfile("open", path))))
						: undefined,
			}),
		});
		return Effect.gen(function* () {
			const outcome = yield* RunOnce.run(
				OPTIONS,
				Effect.sync(() => {
					runs++;
					return "x";
				}),
			);
			const fs = yield* FileSystem.FileSystem;
			const lock = yield* fs.readFileString(LOCK).pipe(Effect.orElseSucceed(() => undefined));
			assert.deepStrictEqual(
				{ outcome: { _tag: outcome._tag, reason: (outcome as { reason?: string }).reason }, runs, lock },
				EXPECTED,
			);
		}).pipe(
			Effect.provide(Layer.mergeAll(Faulty, ProcessLiveness.layerFrom({ pid: 7, host: "here", isAlive: () => true }))),
		);
	});

	it("the sync driver leaves a lock whose write failed, and a later caller takes it over past staleMs", () => {
		const files = new Map<string, string>();
		let clock = 1_000;
		const now = () => clock;
		let failWrite = true;
		// The first create lands an empty file and the write of the record then fails; later creates succeed.
		const fs = memorySync(files, now, (text, put) => {
			put(LOCK, failWrite ? "" : text);
			if (!failWrite) return true;
			failWrite = false;
			throw MemoryFileSystem.errno("EIO", "write", LOCK);
		});
		const lockWrittenAt = clock;
		let runs = 0;
		const work = () => {
			runs++;
			return Result.succeed("x");
		};
		const first = Result.getOrThrow(RunOnce.runSync(OPTIONS, host(fs, now), work));
		assert.deepStrictEqual(
			{ _tag: first._tag, reason: (first as { reason?: string }).reason, runs },
			{
				_tag: "RanUnserialized",
				reason: "lockUnavailable",
				runs: 1,
			},
		);
		assert.strictEqual(files.get(LOCK), "", "the garbled lock is left in place");

		// Past staleMs the garbled lock is taken over, and the next caller runs serialized.
		clock = lockWrittenAt + 60_001;
		const second = Result.getOrThrow(RunOnce.runSync(OPTIONS, host(fs, now), work));
		assert.strictEqual(second._tag, "Ran");
		assert.strictEqual(runs, 2);
		assert.isFalse(files.has(LOCK), "released after the serialized run");
	});

	it.effect("the Effect driver leaves a file it created when the write then fails", () => {
		// The open succeeds (the file now exists, ours) and the write fails: the
		// machine runs unserialized, and the empty (garbled) lock is left in place.
		const Faulty = MemoryFileSystem.layerWith(undefined, {
			faults: (base) => ({
				open: (path, options) =>
					path === LOCK && options?.flag === "wx"
						? base
								.open(path, options)
								.pipe(
									Effect.map((file) =>
										MemoryFileSystem.wrapFile(file, { writeAll: () => Effect.fail(emfile("writeAll", path)) }),
									),
								)
						: undefined,
			}),
		});
		return Effect.gen(function* () {
			const outcome = yield* RunOnce.run(OPTIONS, Effect.succeed("x"));
			assert.deepStrictEqual(outcome, { _tag: "RanUnserialized", value: "x", reason: "lockUnavailable" });
			const fs = yield* FileSystem.FileSystem;
			assert.strictEqual(yield* fs.readFileString(LOCK), "");
		}).pipe(
			Effect.provide(Layer.mergeAll(Faulty, ProcessLiveness.layerFrom({ pid: 7, host: "here", isAlive: () => true }))),
		);
	});
});

// A key may hold `.`, so another key's files can share a prefix with this
// key's tickets and tombs: key `k.lock.breaker`'s lock is `k.lock.breaker.lock`,
// which starts with `k.lock.break`. A takeover on `k` lists the directory and
// must touch only names its own grammar produces — another key's stale-looking
// lock or done marker removed here lets two holders run, or re-runs done work.
describe("RunOnce drivers: keys that share a prefix with this key's file names", () => {
	const DEAD = JSON.stringify({ pid: 99, host: "here", nonce: "dead", startedAt: 0 });
	const OTHER_OWNER = JSON.stringify({ pid: 8, host: "here", nonce: "other", startedAt: 0 });
	const OTHER_DONE = JSON.stringify({ nonce: "other", at: 0 });
	/** Other keys' files, every one old enough to look abandoned: none may be touched. */
	const FOREIGN: ReadonlyArray<readonly [string, string]> = [
		["k.lock.breaker.lock", OTHER_OWNER], // key `k.lock.breaker`
		["k.lock.breaker.done", OTHER_DONE],
		["k.lock.break.lock", OTHER_OWNER], // key `k.lock.break`: a one-segment suffix after the ticket prefix
		["k.lock.break.done", OTHER_DONE],
		["k.lock.break.x.lock", OTHER_OWNER], // key `k.lock.break.x`
		["k.lock.x.lock.tomb.n5.0", OTHER_OWNER], // key `k.lock.x`'s stale tomb
		["k.lock.tomb.x.lock", OTHER_OWNER], // key `k.lock.tomb.x`
		["k.lock.break.tomb.lock", OTHER_OWNER], // key `k.lock.break.tomb`
		["k.lock.break.tomb.x.lock.tomb.n7.0", OTHER_OWNER], // key `k.lock.break.tomb.x`'s stale tomb
	];
	/** This key's own abandoned leftovers: a stale ticket, the older single breaker, a stale tomb. Each is collected. */
	const OWN: ReadonlyArray<readonly [string, string]> = [
		["k.lock.break.old", JSON.stringify({ pid: 98, host: "here", nonce: "old", startedAt: 0 })],
		["k.lock.break", JSON.stringify({ pid: 98, host: "here", nonce: "older", startedAt: 0 })],
		["k.lock.tomb.n5.0", DEAD],
		["k.lock.break.tomb.n6.0", DEAD],
	];
	const isAlive = (pid: number) => pid !== 99 && pid !== 98;
	const LATER = 10 * 60_000;

	it("the sync driver takes over its own key and leaves every other key's files alone", () => {
		const files = new Map<string, string>();
		let clock = 0;
		const now = () => clock;
		const fs = memorySync(files, now, (text, put) => {
			put(LOCK, text);
			return true;
		});
		fs.writeText(LOCK, DEAD);
		for (const [name, text] of [...FOREIGN, ...OWN]) fs.writeText(`${DIR}/${name}`, text);
		clock = LATER;
		let runs = 0;
		const outcome = Result.getOrThrow(
			RunOnce.runSync(OPTIONS, { ...host(fs, now), liveness: { pid: 7, host: "here", isAlive } }, () => {
				runs++;
				return Result.succeed("x");
			}),
		);
		assert.strictEqual(outcome._tag, "Ran");
		assert.strictEqual(runs, 1);
		for (const [name, text] of FOREIGN) assert.strictEqual(files.get(`${DIR}/${name}`), text, name);
		for (const [name] of OWN) assert.isFalse(files.has(`${DIR}/${name}`), name);
	});

	it.effect("the Effect driver takes over its own key and leaves every other key's files alone", () =>
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem;
			yield* fs.makeDirectory(DIR, { recursive: true });
			yield* fs.writeFileString(LOCK, DEAD);
			for (const [name, text] of [...FOREIGN, ...OWN]) yield* fs.writeFileString(`${DIR}/${name}`, text);
			yield* TestClock.setTime(LATER);
			const outcome = yield* RunOnce.run(OPTIONS, Effect.succeed("x"));
			assert.deepStrictEqual(outcome, { _tag: "Ran", value: "x" });
			for (const [name, text] of FOREIGN) {
				assert.strictEqual(yield* fs.readFileString(`${DIR}/${name}`), text, name);
			}
			for (const [name] of OWN) assert.isFalse(yield* fs.exists(`${DIR}/${name}`), name);
		}).pipe(
			Effect.provide(
				Layer.mergeAll(MemoryFileSystem.layer, ProcessLiveness.layerFrom({ pid: 7, host: "here", isAlive })),
			),
		),
	);

	it("a host nonce outside the grammar is a wiring defect, thrown before any ticket or lock is created", () => {
		for (const bad of ["a.b", "lock", "done", "", "a/b"]) {
			const files = new Map<string, string>();
			const fs = memorySync(
				files,
				() => 0,
				(text, put) => {
					put(LOCK, text);
					return true;
				},
			);
			assert.throws(
				() => RunOnce.runSync(OPTIONS, { ...host(fs, () => 0), nonce: () => bad }, () => Result.succeed("x")),
				/nonce names files/,
				JSON.stringify(bad),
			);
			assert.isFalse(files.has(LOCK), JSON.stringify(bad));
		}
	});
});
