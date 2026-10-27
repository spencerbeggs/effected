import { assert, describe, it } from "@effect/vitest";
import { Option, Redacted, Result } from "effect";
import { decide, stillBreakable } from "../src/internal/runOnceMachine.js";
import { REDACTED } from "../src/Redaction.js";
import { CommandFailedError } from "../src/Run.js";
import type { RunOnceCommandHost, RunOnceOutcome, SyncRunResult } from "../src/RunOnce.js";
import { RunOnce } from "../src/RunOnce.js";

const DIR = "/locks";
const LOCK = `${DIR}/k.lock`;
const DONE = `${DIR}/k.done`;
const BREAK = `${LOCK}.break`;

interface Hooks {
	/** Called on every sleep, after the clock advances — where "another process" acts. */
	readonly onSleep?: (host: TestHost) => void;
	/** Called before each createExclusive — lets a test interleave another process. */
	readonly beforeCreate?: (path: string, host: TestHost, text: string) => void;
	/**
	 * Called before each readText — lets a test act between two of the
	 * protocol's reads. Returning `{ text }` overrides what the read answers
	 * (`{ text: undefined }` makes it miss); returning nothing lets it through.
	 */
	readonly beforeRead?: (path: string, host: TestHost) => { readonly text: string | undefined } | undefined;
	/** Called before each rename. */
	readonly beforeRename?: (from: string, host: TestHost) => void;
	readonly makeDirectoryThrows?: boolean;
	readonly createThrows?: boolean | ((path: string) => boolean);
	readonly renameThrows?: boolean;
	/** Per-call rename failure, e.g. a transient Windows sharing violation. */
	readonly renameFails?: (from: string, host: TestHost) => boolean;
}

/** A looping regression must FAIL, not hang: every poll reads the clock, so cap the reads. */
const STEP_CAP = 20_000;

interface TestHost extends RunOnceCommandHost {
	readonly files: Map<string, { text: string; mtime: number }>;
	readonly sleeps: Array<number>;
	clock: number;
	readonly alive: Set<number>;
	readonly put: (path: string, text: string, ageMs?: number) => void;
}

const owner = (nonce: string, pid = 42, host = "here", startedAt = 0): string =>
	JSON.stringify({ pid, host, nonce, startedAt });
const done = (nonce: string, at: number): string => JSON.stringify({ nonce, at });

const makeHost = (hooks: Hooks = {}, runResult?: SyncRunResult): TestHost => {
	let counter = 0;
	let steps = 0;
	const host: TestHost = {
		files: new Map(),
		sleeps: [],
		clock: 1_000_000,
		alive: new Set([7]),
		put: (path, text, ageMs = 0) => host.files.set(path, { text, mtime: host.clock - ageMs }),
		fs: {
			makeDirectory: () => {
				if (hooks.makeDirectoryThrows === true) throw new Error("EACCES");
			},
			readText: (path) => {
				const scripted = hooks.beforeRead?.(path, host);
				return scripted === undefined ? host.files.get(path)?.text : scripted.text;
			},
			createExclusive: (path, text) => {
				hooks.beforeCreate?.(path, host, text);
				const throws = typeof hooks.createThrows === "function" ? hooks.createThrows(path) : hooks.createThrows;
				if (throws === true) throw new Error("EACCES");
				if (host.files.has(path)) return false;
				host.put(path, text);
				return true;
			},
			writeText: (path, text) => host.put(path, text),
			remove: (path) => {
				host.files.delete(path);
			},
			mtimeMs: (path) => host.files.get(path)?.mtime,
			readDirectory: (path) =>
				[...host.files.keys()]
					.filter((file) => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes("/"))
					.map((file) => file.slice(path.length + 1)),
			rename: (from, to) => {
				hooks.beforeRename?.(from, host);
				if (hooks.renameThrows === true || hooks.renameFails?.(from, host) === true) throw new Error("EBUSY");
				const entry = host.files.get(from);
				if (entry === undefined) return false;
				host.files.delete(from);
				host.files.set(to, entry);
				return true;
			},
		},
		liveness: { pid: 7, host: "here", isAlive: (pid) => host.alive.has(pid) },
		now: () => {
			if (++steps > STEP_CAP) throw new Error(`step cap: the protocol polled ${STEP_CAP} times`);
			return host.clock;
		},
		sleep: (ms) => {
			host.sleeps.push(ms);
			host.clock += ms;
			hooks.onSleep?.(host);
		},
		nonce: () => `n${++counter}`,
		run: () => runResult ?? { status: 0, stdout: "ok", stderr: "" },
	};
	return host;
};

const OPTIONS = { key: "k", dir: DIR } as const;

const ranWith = <A>(result: Result.Result<RunOnceOutcome<A>, unknown>): RunOnceOutcome<A> => {
	assert.isTrue(Result.isSuccess(result));
	return Result.isSuccess(result) ? result.success : (undefined as never);
};

describe("decide", () => {
	const state = { observed: new Set(["seen"]), deadline: 100 };
	const config = { staleMs: 10, waitTimeoutMs: 50, trustSequentialMs: undefined };
	const held = (alive: boolean | undefined, ageMs: number, nonce: string | undefined = "x") =>
		({
			_tag: "Held",
			owner: nonce === undefined ? Option.none() : Option.some({ pid: 1, host: "h", nonce, startedAt: 0 }),
			ageMs,
			alive,
		}) as const;
	const absent = { _tag: "Absent" } as const;

	it("trusts a done marker only from an observed owner, unless sequential trust opts in", () => {
		const seen = Option.some({ nonce: "seen", at: 50 });
		const unseen = Option.some({ nonce: "other", at: 50 });
		assert.strictEqual(decide({ done: seen, lock: absent, now: 60 }, state, config)._tag, "Trust");
		assert.strictEqual(decide({ done: unseen, lock: absent, now: 60 }, state, config)._tag, "Create");
		assert.strictEqual(
			decide({ done: unseen, lock: absent, now: 60 }, state, { ...config, trustSequentialMs: 10 })._tag,
			"Trust",
		);
		assert.strictEqual(
			decide({ done: unseen, lock: absent, now: 61 }, state, { ...config, trustSequentialMs: 10 })._tag,
			"Create",
		);
	});

	it("takes over a dead owner at once, an unprobeable one only when stale, a live one never", () => {
		const none = Option.none();
		assert.strictEqual(decide({ done: none, lock: held(false, 0), now: 0 }, state, config)._tag, "Takeover");
		assert.strictEqual(decide({ done: none, lock: held(undefined, 5), now: 0 }, state, config)._tag, "Wait");
		assert.strictEqual(decide({ done: none, lock: held(undefined, 11), now: 0 }, state, config)._tag, "Takeover");
		assert.strictEqual(decide({ done: none, lock: held(true, 60), now: 0 }, state, config)._tag, "Wait");
		assert.strictEqual(decide({ done: none, lock: held(true, 60), now: 101 }, state, config)._tag, "GiveUp");
		// Recycled pid: an alive-probed owner older than staleMs + waitTimeoutMs is breakable.
		assert.strictEqual(decide({ done: none, lock: held(true, 61), now: 0 }, state, config)._tag, "Takeover");
		// Past the deadline even a breakable lock is given up on.
		assert.strictEqual(decide({ done: none, lock: held(false, 0), now: 101 }, state, config)._tag, "GiveUp");
	});

	it("re-checks the lock under the breaker against the nonce judged dead", () => {
		const rec = (nonce: string) => Option.some({ pid: 1, host: "h", nonce, startedAt: 0 });
		assert.isTrue(stillBreakable(Option.some("a"), rec("a"), 0, 10));
		assert.isFalse(stillBreakable(Option.some("a"), rec("b"), 0, 10));
		assert.isFalse(stillBreakable(Option.some("a"), Option.none(), 100, 10));
		assert.isTrue(stillBreakable(Option.none(), Option.none(), 11, 10));
		assert.isFalse(stillBreakable(Option.none(), Option.none(), 5, 10));
		assert.isFalse(stillBreakable(Option.none(), rec("b"), 100, 10));
	});
});

describe("RunOnce.runSync", () => {
	it("runs uncontended work, writes a done marker carrying its nonce, and releases", () => {
		const host = makeHost();
		let runs = 0;
		const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(++runs)));
		assert.deepStrictEqual(outcome, { _tag: "Ran", value: 1 });
		assert.isFalse(host.files.has(LOCK));
		assert.strictEqual(JSON.parse(host.files.get(DONE)?.text ?? "{}").nonce, "n1");
	});

	it("B1: a done marker from a previous SEQUENTIAL run is not trusted — the work runs again", () => {
		const host = makeHost();
		host.put(DONE, done("previous", host.clock - 1));
		let runs = 0;
		assert.strictEqual(ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(++runs)))._tag, "Ran");
		assert.strictEqual(runs, 1);
	});

	it("trustSequentialMs opts in to trusting a fresh unobserved marker", () => {
		const host = makeHost();
		host.put(DONE, done("previous", host.clock - 5));
		let runs = 0;
		const outcome = ranWith(RunOnce.runSync({ ...OPTIONS, trustSequentialMs: 30 }, host, () => Result.succeed(++runs)));
		assert.deepStrictEqual(outcome, { _tag: "Trusted", owner: "previous", finishedAt: host.clock - 5 });
		assert.strictEqual(runs, 0);
	});

	it("waits on a live concurrent owner and trusts it when it finishes", () => {
		const host = makeHost({
			onSleep: (h) => {
				if (h.sleeps.length === 3) {
					h.put(DONE, done("winner", h.clock));
					h.files.delete(LOCK);
				}
			},
		});
		host.alive.add(99);
		host.put(LOCK, owner("winner", 99));
		let runs = 0;
		const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(++runs)));
		assert.strictEqual(outcome._tag, "Trusted");
		assert.strictEqual(runs, 0);
		assert.deepStrictEqual(host.sleeps, [200, 200, 200]);
	});

	it("B3: a dead same-host owner is taken over immediately, with no stale wait", () => {
		const host = makeHost();
		host.put(LOCK, owner("dead", 1234));
		const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed("built")));
		assert.deepStrictEqual(outcome, { _tag: "Ran", value: "built" });
		assert.deepStrictEqual(host.sleeps, []);
		assert.isFalse(host.files.has(BREAK));
	});

	it("never takes over a live owner below staleMs + waitTimeoutMs; gives up at the deadline, unserialized, no marker", () => {
		const host = makeHost();
		host.alive.add(99);
		host.put(LOCK, owner("slow", 99), 50_000);
		const outcome = ranWith(
			RunOnce.runSync({ ...OPTIONS, waitTimeoutMs: 1000, pollMs: 100 }, host, () => Result.succeed("x")),
		);
		assert.deepStrictEqual(outcome, { _tag: "RanUnserialized", value: "x", reason: "waitTimeout" });
		assert.strictEqual(JSON.parse(host.files.get(LOCK)?.text ?? "{}").nonce, "slow");
		assert.isFalse(host.files.has(DONE));
	});

	it("B4: an owner recorded on another host is never pid-probed — taken over only when stale", () => {
		const probed: Array<number> = [];
		const host = makeHost();
		const liveness = {
			...host.liveness,
			isAlive: (pid: number) => {
				probed.push(pid);
				return false;
			},
		};
		host.put(LOCK, owner("remote", 1234, "elsewhere"));
		const young = ranWith(
			RunOnce.runSync({ ...OPTIONS, staleMs: 1000, waitTimeoutMs: 500 }, { ...host, liveness }, () =>
				Result.succeed(1),
			),
		);
		assert.strictEqual(young._tag, "RanUnserialized");
		assert.deepStrictEqual(probed, []);

		const old = makeHost();
		old.put(LOCK, owner("remote", 1234, "elsewhere"), 5000);
		assert.strictEqual(
			ranWith(RunOnce.runSync({ ...OPTIONS, staleMs: 1000 }, old, () => Result.succeed(1)))._tag,
			"Ran",
		);
	});

	it("a garbled lock (no readable owner) is waited on while young and taken over once stale", () => {
		const host = makeHost();
		host.put(LOCK, "");
		const outcome = ranWith(RunOnce.runSync({ ...OPTIONS, staleMs: 500, pollMs: 100 }, host, () => Result.succeed(1)));
		assert.strictEqual(outcome._tag, "Ran");
		assert.deepStrictEqual(host.sleeps, [100, 100, 100, 100, 100, 100]);
	});

	it("B2: under the breaker, a lock that changed since it was judged dead is NOT removed", () => {
		const host = makeHost({
			beforeCreate: (path, h) => {
				// Another breaker already replaced the dead lock with its own live one.
				if (path.startsWith(`${BREAK}.`) && h.files.get(LOCK)?.text.includes("dead")) {
					h.put(LOCK, owner("successor", 99));
				}
			},
			onSleep: (h) => {
				if (h.sleeps.length === 2) {
					h.put(DONE, done("successor", h.clock));
					h.files.delete(LOCK);
				}
			},
		});
		host.alive.add(99);
		host.put(LOCK, owner("dead", 1234));
		let runs = 0;
		const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(++runs)));
		// The successor's lock survived the break; we waited on it and trusted it.
		assert.deepStrictEqual(outcome, { _tag: "Trusted", owner: "successor", finishedAt: host.clock });
		assert.strictEqual(runs, 0);
	});

	it("a breaker held by someone else is waited out; a stale one is removed", () => {
		const host = makeHost();
		host.put(LOCK, owner("dead", 1234));
		host.put(BREAK, "1", 0);
		const outcome = ranWith(RunOnce.runSync({ ...OPTIONS, staleMs: 1000, pollMs: 400 }, host, () => Result.succeed(1)));
		assert.strictEqual(outcome._tag, "Ran");
		// Fresh breaker: wait. Once it ages past staleMs (1200 > 1000) it is removed — progress, so the
		// break proceeds at once with no further sleep.
		assert.deepStrictEqual(host.sleeps, [400, 400, 400]);
		assert.isFalse(host.files.has(BREAK));
	});

	it("release is owner-only: a lock replaced during the run is left alone", () => {
		const host = makeHost();
		const outcome = ranWith(
			RunOnce.runSync(OPTIONS, host, () => {
				host.put(LOCK, owner("thief", 99));
				return Result.succeed(1);
			}),
		);
		assert.strictEqual(outcome._tag, "Ran");
		assert.strictEqual(JSON.parse(host.files.get(LOCK)?.text ?? "{}").nonce, "thief");
	});

	it("a failed run returns its failure, writes no marker and releases the lock", () => {
		const host = makeHost();
		const result = RunOnce.runSync(OPTIONS, host, () => Result.fail("broke"));
		assert.deepStrictEqual(result, Result.fail("broke"));
		assert.isFalse(host.files.has(DONE));
		assert.isFalse(host.files.has(LOCK));
	});

	it("a throwing run releases the lock and rethrows", () => {
		const host = makeHost();
		assert.throws(
			() =>
				RunOnce.runSync(OPTIONS, host, () => {
					throw new Error("boom");
				}),
			"boom",
		);
		assert.isFalse(host.files.has(LOCK));
		assert.isFalse(host.files.has(DONE));
	});

	it("B9: lock IO that fails outright runs the work unserialized instead of failing the caller", () => {
		for (const hooks of [{ makeDirectoryThrows: true }, { createThrows: true }]) {
			const host = makeHost(hooks);
			const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(1)));
			assert.deepStrictEqual(outcome, { _tag: "RanUnserialized", value: 1, reason: "lockUnavailable" });
			assert.isFalse(host.files.has(DONE));
		}
	});

	it("a liveness probe that throws counts as alive", () => {
		const host = makeHost();
		host.put(LOCK, owner("unknown", 5));
		const liveness = {
			...host.liveness,
			isAlive: () => {
				throw new Error("no");
			},
		};
		const outcome = ranWith(
			RunOnce.runSync({ ...OPTIONS, waitTimeoutMs: 300 }, { ...host, liveness }, () => Result.succeed(1)),
		);
		assert.strictEqual(outcome._tag, "RanUnserialized");
	});

	it("rejects bad wiring before any IO", () => {
		const host = makeHost();
		const run = () => Result.succeed(1);
		assert.throws(() => RunOnce.runSync({ key: "a/b", dir: DIR }, host, run), /key/);
		assert.throws(() => RunOnce.runSync({ key: "k", dir: "" }, host, run), /dir/);
		assert.throws(() => RunOnce.runSync({ ...OPTIONS, pollMs: 5 }, host, run), /pollMs/);
		assert.throws(() => RunOnce.runSync({ ...OPTIONS, staleMs: -1 }, host, run), /staleMs/);
		assert.throws(() => RunOnce.runSync({ ...OPTIONS, waitTimeoutMs: 1.5 }, host, run), /waitTimeoutMs/);
		assert.strictEqual(host.files.size, 0);
	});
});

describe("RunOnce.commandSync", () => {
	it("runs argv through the host runner and succeeds on exit 0", () => {
		const calls: Array<unknown> = [];
		const host = makeHost();
		const outcome = ranWith(
			RunOnce.commandSync(
				OPTIONS,
				{
					...host,
					run: (command, args, options) => {
						calls.push([command, args, options]);
						return { status: 0, stdout: "", stderr: "" };
					},
				},
				{ argv: ["turbo", "run", "build"], cwd: "/repo" },
			),
		);
		assert.strictEqual(outcome._tag, "Ran");
		assert.deepStrictEqual(calls, [
			["turbo", ["run", "build"], { cwd: "/repo", stdio: "capture", maxOutputBytes: 1048576 }],
		]);
	});

	it("passes windowsVerbatimArguments through to the host runner", () => {
		const calls: Array<unknown> = [];
		const host = makeHost();
		ranWith(
			RunOnce.commandSync(
				OPTIONS,
				{
					...host,
					run: (_command, _args, options) => {
						calls.push(options);
						return { status: 0, stdout: "", stderr: "" };
					},
				},
				{ argv: ["cmd.exe", "/d", "/s", "/c", '"echo "a b""'], windowsVerbatimArguments: true },
			),
		);
		assert.deepStrictEqual(calls, [{ stdio: "capture", maxOutputBytes: 1048576, windowsVerbatimArguments: true }]);
	});

	it("fails nonZero with redacted argv and output, and leaves no marker", () => {
		const host = makeHost({}, { status: 2, stdout: "token s3cr3t", stderr: "bad s3cr3t" });
		const result = RunOnce.commandSync(OPTIONS, host, {
			argv: ["tool", "--token", "abc", "s3cr3t"],
			redact: [Redacted.make("s3cr3t")],
		});
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			const error = result.failure;
			assert.instanceOf(error, CommandFailedError);
			assert.strictEqual(error.kind, "nonZero");
			assert.strictEqual(error.exitCode, 2);
			assert.notInclude(JSON.stringify(error.args), "s3cr3t");
			assert.notInclude(JSON.stringify(error.args), "abc");
			assert.notInclude(error.stdout ?? "", "s3cr3t");
			assert.notInclude(error.stderr ?? "", "s3cr3t");
		}
		assert.isFalse(host.files.has(DONE));
	});

	it("fails spawn when the process cannot start; a signal death is nonZero with no exitCode", () => {
		const spawn = RunOnce.commandSync(
			OPTIONS,
			makeHost({}, { error: new Error("ENOENT"), status: null, stdout: "", stderr: "" }),
			{
				argv: ["missing"],
			},
		);
		assert.isTrue(Result.isFailure(spawn) && spawn.failure.kind === "spawn");
		const signal = RunOnce.commandSync(OPTIONS, makeHost({}, { status: null, stdout: "", stderr: "" }), {
			argv: ["x"],
		});
		assert.isTrue(
			Result.isFailure(signal) && signal.failure.kind === "nonZero" && signal.failure.exitCode === undefined,
		);
	});
});

describe("RunOnce review regressions", () => {
	it("#1: an owner finishing between the poll's lock and done reads is trusted, not re-run", () => {
		let polls = 0;
		const host = makeHost({
			beforeRead: (path, h) => {
				// On the second poll, the observed owner finishes just as the waiter
				// reads the lock: marker written, then lock released.
				if (path === LOCK && ++polls === 2) {
					h.put(DONE, done("winner", h.clock));
					h.files.delete(LOCK);
				}
				return undefined;
			},
		});
		host.alive.add(99);
		host.put(LOCK, owner("winner", 99));
		let runs = 0;
		const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(++runs)));
		assert.deepStrictEqual(outcome, { _tag: "Trusted", owner: "winner", finishedAt: host.clock });
		assert.strictEqual(runs, 0);
	});

	it("#1: a marker that only becomes visible after the create is still trusted, and the new lock released", () => {
		let polls = 0;
		let staleDone = false;
		const host = makeHost({
			beforeRead: (path, h) => {
				if (path === LOCK && ++polls === 2) {
					h.put(DONE, done("winner", h.clock));
					h.files.delete(LOCK);
					staleDone = true;
				}
				// A lagging read (an attribute cache, say) misses the marker once.
				if (path === DONE && staleDone) {
					staleDone = false;
					return { text: undefined };
				}
				return undefined;
			},
		});
		host.alive.add(99);
		host.put(LOCK, owner("winner", 99));
		let runs = 0;
		const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(++runs)));
		assert.strictEqual(outcome._tag, "Trusted");
		assert.strictEqual(runs, 0);
		assert.isFalse(host.files.has(LOCK));
	});

	it("#2: a dead owner's lock that cannot be moved is given up on within waitTimeoutMs", () => {
		const host = makeHost({ renameThrows: true });
		host.put(LOCK, owner("dead", 1234));
		const start = host.clock;
		const outcome = ranWith(
			RunOnce.runSync({ ...OPTIONS, waitTimeoutMs: 1000, pollMs: 100 }, host, () => Result.succeed(1)),
		);
		assert.deepStrictEqual(outcome, { _tag: "RanUnserialized", value: 1, reason: "waitTimeout" });
		assert.isAtMost(host.clock - start, 1100);
		assert.isAbove(host.sleeps.length, 0);
	});

	it("#2: a breaker that cannot be created is given up on within waitTimeoutMs", () => {
		const host = makeHost({ createThrows: (path) => path.startsWith(`${BREAK}.`) });
		host.put(LOCK, owner("dead", 1234));
		const start = host.clock;
		const outcome = ranWith(
			RunOnce.runSync({ ...OPTIONS, waitTimeoutMs: 1000, pollMs: 100 }, host, () => Result.succeed(1)),
		);
		assert.deepStrictEqual(outcome, { _tag: "RanUnserialized", value: 1, reason: "waitTimeout" });
		assert.isAtMost(host.clock - start, 1100);
	});

	it("#3: a successor's lock swept up by the rename is put back intact", () => {
		let swapped = false;
		let seenAfterBreak: string | undefined;
		const host = makeHost({
			beforeRename: (from, h) => {
				// Between the re-check under the breaker and the rename, a successor
				// (which saw the dead lock gone some other way) created a live lock.
				if (from === LOCK && !swapped) {
					swapped = true;
					h.put(LOCK, owner("successor", 99));
				}
			},
			onSleep: (h) => {
				seenAfterBreak ??= h.files.get(LOCK)?.text;
				h.put(DONE, done("successor", h.clock));
				h.files.delete(LOCK);
			},
		});
		host.alive.add(99);
		host.put(LOCK, owner("dead", 1234));
		let runs = 0;
		const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(++runs)));
		assert.strictEqual(runs, 0);
		assert.strictEqual(outcome._tag, "Trusted");
		assert.strictEqual(JSON.parse(seenAfterBreak ?? "{}").nonce, "successor");
		assert.deepStrictEqual(
			[...host.files.keys()].filter((path) => path.includes(".tomb.")),
			[],
		);
	});

	it("#4: an alive-probed owner (a recycled pid) is aged out past staleMs + waitTimeoutMs", () => {
		const host = makeHost();
		host.alive.add(99);
		host.put(LOCK, owner("recycled", 99), 1000 + 2000 + 1);
		const outcome = ranWith(
			RunOnce.runSync({ ...OPTIONS, staleMs: 1000, waitTimeoutMs: 2000 }, host, () => Result.succeed(1)),
		);
		assert.deepStrictEqual(outcome, { _tag: "Ran", value: 1 });
		assert.deepStrictEqual(host.sleeps, []);
	});

	it("the step cap turns a hot loop into a failure instead of a hang", () => {
		// A host whose clock never advances and whose lock never goes away.
		const host = makeHost();
		host.alive.add(99);
		host.put(LOCK, owner("forever", 99));
		const frozen = { ...host, sleep: () => {} };
		assert.throws(() => RunOnce.runSync(OPTIONS, frozen, () => Result.succeed(1)), /step cap/);
	});

	it("#6: a secret straddling the capture cut is redacted whole, never leaked as a suffix", () => {
		const full = `${"x".repeat(40)}SECRET123${"y".repeat(4)}`;
		const host = makeHost();
		const result = RunOnce.commandSync(
			OPTIONS,
			{ ...host, run: (_c, _a, o) => ({ status: 1, stdout: "", stderr: full.slice(-o.maxOutputBytes) }) },
			{ argv: ["tool"], maxOutputBytes: 7, redact: [Redacted.make("SECRET123")] },
		);
		assert.isTrue(Result.isFailure(result));
		if (Result.isFailure(result)) {
			const stderr = result.failure.stderr ?? "";
			// Fetched 7 + 9 trailing bytes ("xxxSECRET123yyyy"), redacted, then cut to 7.
			assert.strictEqual(stderr, `${REDACTED}yyyy`);
			assert.notInclude(stderr, "123");
		}
	});

	it("#6: a runner that throws is a spawn failure, not a crash", () => {
		const host = makeHost();
		const result = RunOnce.commandSync(
			OPTIONS,
			{
				...host,
				run: () => {
					throw new TypeError("argument contains a null byte");
				},
			},
			{ argv: ["tool", "a\u0000b"] },
		);
		assert.isTrue(Result.isFailure(result) && result.failure.kind === "spawn");
		assert.isFalse(host.files.has(LOCK));
	});
});

describe("RunOnce re-review regressions", () => {
	/** A breaker record: its holder, and the lock nonce it is breaking (absent for an unreadable lock). */
	const breaker = (nonce: string, pid: number, breaking: string | undefined = "dead", host = "here") =>
		JSON.stringify({ pid, host, nonce, startedAt: 0, ...(breaking === undefined ? {} : { breaking }) });

	it("#2 (re-review): an owner seen only under the breaker is trusted when it finishes", () => {
		let lockReads = 0;
		const host = makeHost({
			beforeRead: (path, h) => {
				if (path !== LOCK) return undefined;
				lockReads++;
				// Read 2 is the re-check under the breaker: a successor took the dead lock's place.
				if (lockReads === 2) h.put(LOCK, owner("successor", 99));
				// Read 3 is the next poll: the successor has already finished.
				if (lockReads === 3) {
					h.put(DONE, done("successor", h.clock));
					h.files.delete(LOCK);
				}
				return undefined;
			},
		});
		host.alive.add(99);
		host.put(LOCK, owner("dead", 1234));
		let runs = 0;
		const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(++runs)));
		assert.strictEqual(runs, 0);
		assert.deepStrictEqual(outcome, { _tag: "Trusted", owner: "successor", finishedAt: host.clock });
	});

	it("#3: a fresh breaker left by a DEAD process on this host is removed at once, not after staleMs", () => {
		const host = makeHost();
		host.put(LOCK, owner("dead", 1234));
		host.put(BREAK, breaker("crashed-breaker", 4321));
		const outcome = ranWith(RunOnce.runSync({ ...OPTIONS, staleMs: 60_000 }, host, () => Result.succeed(1)));
		assert.strictEqual(outcome._tag, "Ran");
		assert.deepStrictEqual(host.sleeps, []);
	});

	it("#3: a lock emptied between a non-atomic create and its write is repaired with our record", () => {
		let created = false;
		let lockDuringRun: string | undefined;
		const host = makeHost({
			beforeCreate: (path) => {
				if (path === LOCK) created = true;
			},
			beforeRead: (path, h) => {
				// The verify read right after our create: a breaker's put-back left it empty.
				if (path === LOCK && created) {
					created = false;
					h.put(LOCK, "");
					return { text: "" };
				}
				return undefined;
			},
		});
		const outcome = ranWith(
			RunOnce.runSync(OPTIONS, host, () => {
				lockDuringRun = host.files.get(LOCK)?.text;
				return Result.succeed(1);
			}),
		);
		assert.strictEqual(outcome._tag, "Ran");
		assert.strictEqual(JSON.parse(lockDuringRun ?? "{}").nonce, "n1");
		assert.isFalse(host.files.has(LOCK), "the repaired lock is ours, so release removes it");
	});

	it("#3: tombs older than staleMs are swept; young tombs and other keys' tombs are not", () => {
		const host = makeHost();
		// A tomb's name ends in the time of its rename; its mtime is the renamed file's own (often old).
		const old = `${LOCK}.tomb.a.${host.clock - 5000}`;
		const oldBreak = `${LOCK}.break.tomb.b.${host.clock - 5000}`;
		const young = `${LOCK}.tomb.c.${host.clock - 10}`;
		const youngButOldMtime = `${LOCK}.tomb.d.${host.clock - 10}`;
		const otherKey = `${DIR}/other.lock.tomb.e.${host.clock - 5000}`;
		host.put(old, owner("x", 1), 5000);
		host.put(oldBreak, "b", 5000);
		host.put(young, owner("y", 1), 10);
		host.put(youngButOldMtime, owner("w", 1), 99_999);
		host.put(otherKey, owner("z", 1), 5000);
		ranWith(RunOnce.runSync({ ...OPTIONS, staleMs: 1000 }, host, () => Result.succeed(1)));
		assert.isFalse(host.files.has(old));
		assert.isFalse(host.files.has(oldBreak));
		assert.isTrue(host.files.has(young));
		// Judged by the rename time in its name, never by mtime: an in-flight tomb of an old file survives.
		assert.isTrue(host.files.has(youngButOldMtime));
		assert.isTrue(host.files.has(otherKey));
	});

	it("#4: a release that hits a transient sharing violation is retried with a short backoff", () => {
		let ran = false;
		let failures = 0;
		const host = makeHost({
			renameFails: (from) => ran && from === LOCK && failures++ < 2,
		});
		ranWith(
			RunOnce.runSync(OPTIONS, host, () => {
				ran = true;
				return Result.succeed(1);
			}),
		);
		assert.isFalse(host.files.has(LOCK));
		assert.deepStrictEqual(host.sleeps, [10, 25]);
	});

	it("#4: a release that never succeeds gives up after a bounded number of tries", () => {
		let ran = false;
		const host = makeHost({ renameFails: (from) => ran && from === LOCK });
		ranWith(
			RunOnce.runSync(OPTIONS, host, () => {
				ran = true;
				return Result.succeed(1);
			}),
		);
		assert.deepStrictEqual(host.sleeps, [10, 25, 50, 100, 200]);
	});

	const ticketsIn = (host: TestHost): ReadonlyArray<string> =>
		[...host.files.keys()].filter((path) => path.startsWith(`${BREAK}.`) && !path.includes(".tomb."));

	it("tickets: a contender that sees another LIVE ticket withdraws its own and never touches the lock", () => {
		// How many back-off sleeps had happened at each rename of the lock path.
		const lockRenames: Array<number> = [];
		const host = makeHost({
			beforeRename: (from, h) => {
				if (from === LOCK) lockRenames.push(h.sleeps.length);
			},
			onSleep: (h) => {
				// The other contender finishes its break: its ticket goes, the dead lock goes.
				if (h.sleeps.length === 2) {
					h.files.delete(`${BREAK}.other`);
					h.files.delete(LOCK);
				}
			},
		});
		host.alive.add(99);
		host.put(LOCK, owner("dead", 1234));
		host.put(`${BREAK}.other`, breaker("other", 99));
		const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(1)));
		assert.strictEqual(outcome._tag, "Ran");
		// We backed off twice while the other ticket was live, never renaming the lock ourselves.
		assert.deepStrictEqual(host.sleeps, [200, 200]);
		// The only rename of the lock path is our own release, after the rival left.
		assert.deepStrictEqual(lockRenames, [2]);
		assert.deepStrictEqual(ticketsIn(host), []);
	});

	it("tickets: two contenders that see each other both back off; neither breaks the lock that round", () => {
		let created = 0;
		const host = makeHost({
			beforeCreate: (path, h) => {
				// Each time we create our ticket, the other contender has just created theirs.
				if (path.startsWith(`${BREAK}.`) && ++created <= 2)
					h.put(`${BREAK}.rival${created}`, breaker(`rival${created}`, 99));
			},
			onSleep: (h) => {
				// The rival withdraws its ticket after seeing ours.
				for (const ticket of ticketsIn(h)) if (ticket.includes("rival")) h.files.delete(ticket);
			},
		});
		host.alive.add(99);
		host.put(LOCK, owner("dead", 1234));
		const outcome = ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(1)));
		assert.strictEqual(outcome._tag, "Ran");
		assert.deepStrictEqual(host.sleeps, [200, 200]);
		assert.deepStrictEqual(ticketsIn(host), []);
	});

	it("tickets: an abandoned ticket — stale, or a dead holder's — is removed by name and the break proceeds", () => {
		const host = makeHost();
		host.put(LOCK, owner("dead", 1234));
		host.put(`${BREAK}.stale`, breaker("stale", 99), 5000);
		host.put(`${BREAK}.crashed`, breaker("crashed", 4321));
		host.alive.add(99);
		const outcome = ranWith(RunOnce.runSync({ ...OPTIONS, staleMs: 1000 }, host, () => Result.succeed(1)));
		assert.strictEqual(outcome._tag, "Ran");
		assert.deepStrictEqual(host.sleeps, []);
		assert.deepStrictEqual(ticketsIn(host), []);
	});

	it("tickets: our own ticket is withdrawn on every path — break done, nothing to break, contention", () => {
		const host = makeHost();
		host.put(LOCK, owner("dead", 1234));
		ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(1)));
		assert.deepStrictEqual(ticketsIn(host), []);
		assert.isFalse(host.files.has(BREAK));
	});

	it("a lock tomb collected from under its breaker is never put back", () => {
		let swapped = false;
		const putBacks: Array<string> = [];
		const host = makeHost({
			beforeRename: (from, h) => {
				// A successor's lock takes the dead lock's place just before the rename…
				if (from === LOCK && !swapped) {
					swapped = true;
					h.put(LOCK, owner("successor", 99));
				}
			},
			beforeRead: (path, h) => {
				// …and the tomb collector removes the tomb right after its text is read.
				if (path.startsWith(`${LOCK}.tomb.`) && h.files.has(path)) {
					const text = h.files.get(path)?.text;
					h.files.delete(path);
					return { text };
				}
				return undefined;
			},
			beforeCreate: (path, _h, text) => {
				if (path === LOCK && text.includes("successor")) putBacks.push(text);
			},
		});
		host.alive.add(99);
		host.put(LOCK, owner("dead", 1234));
		ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(1)));
		assert.isTrue(swapped);
		assert.deepStrictEqual(putBacks, [], "a collected tomb was resurrected");
	});

	it("an unparseable file swept up by a lock rename is never put back", () => {
		let swapped = false;
		const putBacks: Array<string> = [];
		const host = makeHost({
			beforeRename: (from, h) => {
				// A creator's lock caught between its create and its write: present, still empty.
				if (from === LOCK && !swapped) {
					swapped = true;
					h.put(LOCK, "");
				}
			},
			beforeCreate: (path, _h, text) => {
				if (path === LOCK && text === "") putBacks.push(text);
			},
		});
		host.put(LOCK, owner("dead", 1234));
		ranWith(RunOnce.runSync(OPTIONS, host, () => Result.succeed(1)));
		assert.isTrue(swapped);
		assert.deepStrictEqual(putBacks, [], "an empty, unjudgeable lock was resurrected");
	});
});
