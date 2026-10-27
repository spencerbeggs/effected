// The run-once protocol, written ONCE as a generator that yields IO requests.
//
// `RunOnce.runSync` answers each request synchronously from a caller-supplied
// host; `RunOnce.run` answers it with an Effect. Neither driver decides
// anything: every rule — when to trust a done marker, when an owner is dead,
// how a stale lock is broken, when to give up — lives here, so the two forms
// cannot drift (the same move `WorkspacesSync` makes with one traversal state
// machine for both worlds). Pure: no IO, no clock, no platform.

import { Option, Schema } from "effect";

/** What a lock file holds: who owns it, and the nonce that proves it. */
export const OwnerRecord = Schema.Struct({
	pid: Schema.Int,
	host: Schema.String,
	nonce: Schema.NonEmptyString,
	startedAt: Schema.Number,
});
export type OwnerRecord = typeof OwnerRecord.Type;

/** What a done marker holds: the nonce of the owner that finished, and when. */
export const DoneRecord = Schema.Struct({
	nonce: Schema.NonEmptyString,
	at: Schema.Number,
});
export type DoneRecord = typeof DoneRecord.Type;

/**
 * What a breaker ticket holds: its holder's owner record plus the nonce of
 * the lock it means to break (absent for an unreadable lock) — the latter for
 * diagnosis only; abandonment is judged on age and the holder's liveness.
 */
export const BreakerRecord = Schema.Struct({
	...OwnerRecord.fields,
	breaking: Schema.optionalKey(Schema.String),
});
export type BreakerRecord = typeof BreakerRecord.Type;

const OwnerJson = Schema.fromJsonString(OwnerRecord);
const BreakerJson = Schema.fromJsonString(BreakerRecord);
const decodeBreaker = Schema.decodeUnknownOption(BreakerJson);
const encodeBreaker = Schema.encodeSync(BreakerJson);
const DoneJson = Schema.fromJsonString(DoneRecord);
const decodeOwner = Schema.decodeUnknownOption(OwnerJson);
const decodeDone = Schema.decodeUnknownOption(DoneJson);
const encodeOwner = Schema.encodeSync(OwnerJson);
const encodeDone = Schema.encodeSync(DoneJson);

/** One IO request the protocol makes of its driver. */
export type Request =
	| { readonly _tag: "Now" }
	| { readonly _tag: "Nonce" }
	| { readonly _tag: "Sleep"; readonly ms: number }
	| { readonly _tag: "MakeDirectory"; readonly path: string }
	| { readonly _tag: "ReadText"; readonly path: string }
	| { readonly _tag: "CreateExclusive"; readonly path: string; readonly text: string }
	| { readonly _tag: "WriteText"; readonly path: string; readonly text: string }
	| { readonly _tag: "Remove"; readonly path: string }
	| { readonly _tag: "AgeMs"; readonly path: string }
	| { readonly _tag: "Rename"; readonly from: string; readonly to: string }
	| { readonly _tag: "ListDirectory"; readonly path: string }
	| { readonly _tag: "Backoff"; readonly ms: number }
	| { readonly _tag: "Run" };

/** What the driver answers each request with. */
export interface Responses {
	readonly Now: number;
	readonly Nonce: string;
	readonly Sleep: undefined;
	/** `false` when the directory could not be created. */
	readonly MakeDirectory: boolean;
	/** `undefined` when missing or unreadable. */
	readonly ReadText: string | undefined;
	/** `"failed"` for any failure other than "already exists". */
	readonly CreateExclusive: "created" | "exists" | "failed";
	/** Best effort: the driver absorbs failure. */
	readonly WriteText: undefined;
	/** Best effort: the driver absorbs failure, including "missing". */
	readonly Remove: undefined;
	/** `undefined` when missing. */
	readonly AgeMs: number | undefined;
	/** An atomic rename: `"missing"` when `from` is gone, `"failed"` for any other failure. */
	readonly Rename: "renamed" | "missing" | "failed";
	/** The entry names in a directory, or `undefined` when it cannot be listed. */
	readonly ListDirectory: ReadonlyArray<string> | undefined;
	/** A pause that is NOT an interruption point — used while the lock is held. */
	readonly Backoff: undefined;
	/** How the caller's work ended. */
	readonly Run: "succeeded" | "failed";
}

type Protocol<A> = Generator<Request, A, unknown>;

function* ask<R extends Request>(request: R): Protocol<Responses[R["_tag"]]> {
	return (yield request) as Responses[R["_tag"]];
}

/** The protocol's settings, validated. */
export interface MachineConfig {
	readonly key: string;
	readonly dir: string;
	readonly staleMs: number;
	readonly pollMs: number;
	readonly waitTimeoutMs: number;
	readonly trustSequentialMs: number | undefined;
	readonly self: { readonly pid: number; readonly host: string };
	readonly isAlive: (pid: number) => boolean;
}

/** How the protocol ended — the driver attaches the work's own value. */
export type MachineOutcome =
	| { readonly _tag: "Ran" }
	| { readonly _tag: "RanUnserialized"; readonly reason: "waitTimeout" | "lockUnavailable" }
	| { readonly _tag: "Trusted"; readonly owner: string; readonly finishedAt: number };

/** The state of the lock file as one poll observed it. */
export type LockState =
	| { readonly _tag: "Absent" }
	| {
			readonly _tag: "Held";
			/** The owner record, or none when the file is garbled or mid-write. */
			readonly owner: Option.Option<OwnerRecord>;
			/** Age of the lock file. */
			readonly ageMs: number | undefined;
			/** Whether the owner is alive: undefined when it cannot be probed (another host, no record). */
			readonly alive: boolean | undefined;
	  };

/** What one poll does next. */
export type Decision =
	| { readonly _tag: "Trust"; readonly done: DoneRecord }
	| { readonly _tag: "Create" }
	| { readonly _tag: "Takeover"; readonly expected: Option.Option<string> }
	| { readonly _tag: "Wait" }
	| { readonly _tag: "GiveUp" };

/**
 * The pure poll decision.
 *
 * - A done marker is trusted when its writer is an owner THIS caller observed
 *   holding the lock — a concurrent winner, never a previous sequential run —
 *   or, opted in, when it is younger than `trustSequentialMs`.
 * - An absent lock is created.
 * - A held lock is taken over when its owner is known dead (same host, the
 *   signal-0 probe says gone); when it cannot be probed (another host, or no
 *   readable record) and is older than `staleMs`; or — the recycled-pid rule —
 *   when its owner probes alive but the lock is older than
 *   `staleMs + waitTimeoutMs`, so a dead owner whose pid was reused cannot hold
 *   the lock forever. Below that age a live owner is never taken over.
 * - Past the deadline nothing more is waited on or taken over: give up and
 *   run unserialized.
 */
export const decide = (
	observation: { readonly done: Option.Option<DoneRecord>; readonly lock: LockState; readonly now: number },
	state: { readonly observed: ReadonlySet<string>; readonly deadline: number },
	config: {
		readonly staleMs: number;
		readonly waitTimeoutMs: number;
		readonly trustSequentialMs: number | undefined;
	},
): Decision => {
	if (Option.isSome(observation.done)) {
		const done = observation.done.value;
		const sequential = config.trustSequentialMs !== undefined && observation.now - done.at <= config.trustSequentialMs;
		if (state.observed.has(done.nonce) || sequential) return { _tag: "Trust", done };
	}
	const lock = observation.lock;
	if (lock._tag === "Absent") return { _tag: "Create" };
	const age = lock.ageMs ?? 0;
	const breakable =
		lock.alive === false ||
		(lock.alive === undefined && age > config.staleMs) ||
		(lock.alive === true && age > config.staleMs + config.waitTimeoutMs);
	if (observation.now > state.deadline) return { _tag: "GiveUp" };
	return breakable ? { _tag: "Takeover", expected: Option.map(lock.owner, (owner) => owner.nonce) } : { _tag: "Wait" };
};

/**
 * Whether a lock observed under the breaker is still the one judged dead:
 * the same owner nonce, or — judged with no readable record — still no
 * readable record and still stale.
 */
export const stillBreakable = (
	expected: Option.Option<string>,
	owner: Option.Option<OwnerRecord>,
	ageMs: number | undefined,
	staleMs: number,
): boolean =>
	Option.isSome(expected)
		? Option.isSome(owner) && owner.value.nonce === expected.value
		: Option.isNone(owner) && ageMs !== undefined && ageMs > staleMs;

const pathOf = (dir: string, name: string): string => `${dir.replace(/[\\/]+$/, "")}/${name}`;

/*
 * The file names this machine produces for a key `K` — the whole grammar:
 *
 * - `K.lock`, the lock, and `K.done`, the done marker;
 * - `K.lock.break.<nonce>`, a breaker ticket (and `K.lock.break`, the single
 *   breaker file an older version left);
 * - `K.lock.tomb.<nonce>.<renamedAt>`, a compare-and-delete tomb of the lock
 *   (and `K.lock.break.tomb.<nonce>.<renamedAt>`, one of the older single
 *   breaker).
 *
 * A key may hold `.`, so another key's files can share any prefix of these:
 * `foo.lock.breaker.lock` starts with `foo.lock.break`. Every other key's name
 * is that key plus one of the suffixes above, so whatever follows a shared
 * prefix holds a `.`, or is that key's `lock` or `done` — and a nonce is
 * neither. Every list-and-match site goes through these predicates, which
 * accept only names this grammar produces for THIS key.
 */

/**
 * A nonce names files, so it holds no `.` (the grammar's separator) and no
 * path separator, and is neither `lock` nor `done`: key `K.lock.break`'s own
 * `K.lock.break.lock` and `K.lock.break.done` would otherwise read as a ticket
 * of `K`. Those two are the only one-segment suffixes, so nothing else collides.
 */
const isNonce = (text: string): boolean =>
	text.length > 0 && text !== "lock" && text !== "done" && !/[./\\]/.test(text);

/** Whether `name` is one of `key`'s breaker tickets, or the single breaker file an older version left. */
const isTicketName = (key: string, name: string): boolean => {
	const legacy = `${key}.lock.break`;
	return name === legacy || (name.startsWith(`${legacy}.`) && isNonce(name.slice(legacy.length + 1)));
};

/** The rename time a tomb of `key`'s lock (or older breaker) carries in its name, or `undefined` when `name` is not one. */
const tombRenamedAt = (key: string, name: string): number | undefined => {
	const prefix = [`${key}.lock.tomb.`, `${key}.lock.break.tomb.`].find((candidate) => name.startsWith(candidate));
	if (prefix === undefined) return undefined;
	const rest = name.slice(prefix.length);
	const dot = rest.lastIndexOf(".");
	if (dot === -1 || !isNonce(rest.slice(0, dot)) || !/^\d+$/.test(rest.slice(dot + 1))) return undefined;
	return Number(rest.slice(dot + 1));
};

/**
 * A fresh nonce from the host, held to the grammar: a nonce with a `.` would
 * make this caller's ticket and tombs indistinguishable from another key's
 * files, so every other caller would skip them. A host that breaks the
 * contract is a wiring defect, so this throws.
 */
function* freshNonce(): Protocol<string> {
	const nonce = yield* ask({ _tag: "Nonce" });
	if (!isNonce(nonce)) {
		throw new Error(
			`RunOnce: a nonce names files, so it must be non-empty, neither "lock" nor "done", with no ".", "/" or "\\", received ${JSON.stringify(nonce)}`,
		);
	}
	return nonce;
}

function* observeLock(config: MachineConfig, lockPath: string): Protocol<LockState> {
	const { text, ageMs } = yield* evidence(lockPath);
	if (text === undefined && ageMs === undefined) return { _tag: "Absent" };
	const owner = text === undefined ? Option.none() : decodeOwner(text);
	const alive =
		Option.isSome(owner) && owner.value.host === config.self.host ? config.isAlive(owner.value.pid) : undefined;
	return { _tag: "Held", owner, ageMs, alive };
}

/** A file's text and age, read together as one judgement's evidence. */
function* evidence(path: string): Protocol<{ readonly text: string | undefined; readonly ageMs: number | undefined }> {
	const text = yield* ask({ _tag: "ReadText", path });
	const ageMs = yield* ask({ _tag: "AgeMs", path });
	return { text, ageMs };
}

/**
 * Compare-and-delete, built from an atomic rename because a file has no CAS.
 *
 * `path` is renamed to a tomb private to this caller, and ONLY THEN judged:
 * `accept` sees the owner decoded from the tomb's text (none when that text is
 * not a record) and the tomb's age — never the live path's —
 * so nothing that arrives at `path` after the rename can be mistaken for what
 * was judged. Accepted, the tomb is deleted; rejected, its exact text is put
 * back with an exclusive create, so its owner still owns it, nonce and all —
 * unless that text is not a record at all, which is never resurrected.
 * The residual window is the instant between the rename and the put-back: a
 * caller that finds `path` empty there can create in it (`"lost"`).
 */
function* compareAndDelete(
	path: string,
	mine: string,
	accept: (owner: Option.Option<OwnerRecord>, ageMs: number) => boolean,
): Protocol<"deleted" | "restored" | "lost" | "missing" | "stuck"> {
	// The tomb's NAME carries the time of the rename: a rename preserves mtime,
	// so a just-made tomb of an old file already looks old, and only the name
	// tells the tomb collector it is in flight.
	const tomb = `${path}.tomb.${mine}.${yield* ask({ _tag: "Now" })}`;
	const renamed = yield* ask({ _tag: "Rename", from: path, to: tomb });
	if (renamed === "missing") return "missing";
	if (renamed === "failed") return "stuck";
	const { text, ageMs } = yield* evidence(tomb);
	// A tomb that vanished under us was collected as abandoned: never resurrect it.
	if (text === undefined || ageMs === undefined) {
		yield* ask({ _tag: "Remove", path: tomb });
		return "deleted";
	}
	// An unparseable tomb is never resurrected: it is either a stale wreck or a
	// file caught between a non-atomic create and its write — and that
	// creator, finding its file gone (its write landed in our tomb), backs off
	// and retries. Putting it back would leave an empty file nobody can judge.
	const owner = decodeOwner(text);
	if (!accept(owner, ageMs) && Option.isSome(owner)) {
		const restored = yield* ask({ _tag: "CreateExclusive", path, text });
		yield* ask({ _tag: "Remove", path: tomb });
		return restored === "created" ? "restored" : "lost";
	}
	yield* ask({ _tag: "Remove", path: tomb });
	return "deleted";
}

/** Bookkeeping one run threads through the protocol. */
interface RunState {
	/** Every owner nonce this caller has seen holding the lock — the trust set. */
	readonly observed: Set<string>;
}

/**
 * Whether a breaker ticket (or a breaker file an older version left) may be
 * removed by a caller that does not hold it: it is older than `staleMs`
 * (another host, an unreadable record, or a holder stalled far past a
 * few-syscall critical section), or its holder is a dead process on this
 * host.
 */
const ticketAbandoned = (config: MachineConfig, text: string | undefined, ageMs: number | undefined): boolean => {
	if ((ageMs ?? 0) > config.staleMs) return true;
	const holder = text === undefined ? Option.none() : decodeBreaker(text);
	if (Option.isNone(holder) || holder.value.host !== config.self.host) return false;
	return holder.value.pid !== config.self.pid && !config.isAlive(holder.value.pid);
};

/**
 * Takes the breaker, or reports contention.
 *
 * Each contender creates its OWN uniquely named ticket
 * (`<key>.lock.break.<nonce>`, carrying its owner record and the lock nonce
 * it means to break) and then lists every ticket. An abandoned ticket is
 * removed by its name — a unique name only ever holds that one ticket, whose
 * record never changes, so this is not a check-then-act on someone else's
 * live file. If any other live ticket remains, this caller withdraws its own
 * and backs off. Exclusion follows from the order of operations: a
 * contender proceeds only when its listing saw no other ticket, so any other
 * contender created its ticket after that listing — and that contender's own
 * listing, later still, sees this one's ticket and backs off.
 *
 * Nothing about a breaker is ever renamed or put back: a put-back of a single
 * shared breaker file is what once let a third caller take the breaker in the
 * instant it was gone, while its holder still trusted it.
 */
function* takeBreaker(
	config: MachineConfig,
	lockPath: string,
	expected: Option.Option<string>,
): Protocol<{ readonly ticket: string; readonly mine: string } | undefined> {
	const mine = yield* freshNonce();
	const startedAt = yield* ask({ _tag: "Now" });
	const ticket = `${lockPath}.break.${mine}`;
	const record = encodeBreaker({
		pid: config.self.pid,
		host: config.self.host,
		nonce: mine,
		startedAt,
		...(Option.isSome(expected) ? { breaking: expected.value } : {}),
	});
	if ((yield* ask({ _tag: "CreateExclusive", path: ticket, text: record })) !== "created") return undefined;
	const names = yield* ask({ _tag: "ListDirectory", path: config.dir });
	if (names === undefined) {
		yield* ask({ _tag: "Remove", path: ticket });
		return undefined;
	}
	let contended = false;
	for (const name of names) {
		if (!isTicketName(config.key, name)) continue;
		const path = pathOf(config.dir, name);
		if (path === ticket) continue;
		const { text, ageMs } = yield* evidence(path);
		if (text === undefined && ageMs === undefined) continue;
		if (ticketAbandoned(config, text, ageMs)) yield* ask({ _tag: "Remove", path });
		else contended = true;
	}
	if (contended) {
		yield* ask({ _tag: "Remove", path: ticket });
		return undefined;
	}
	return { ticket, mine };
}

/**
 * Breaks a lock judged breakable, holding the breaker (`takeBreaker`). `true`
 * when the state moved on (re-observe at once); `false` when nothing changed
 * (sleep before retrying).
 */
function* breakLock(
	config: MachineConfig,
	state: RunState,
	lockPath: string,
	expected: Option.Option<string>,
): Protocol<boolean> {
	const held = yield* takeBreaker(config, lockPath, expected);
	if (held === undefined) return false;
	// Under the breaker: is it still the lock that was judged? Any owner seen
	// here joins the trust set — its success is one this caller watched.
	const lock = yield* evidence(lockPath);
	const owner = lock.text === undefined ? Option.none() : decodeOwner(lock.text);
	if (Option.isSome(owner)) state.observed.add(owner.value.nonce);
	let outcome: "deleted" | "restored" | "lost" | "missing" | "stuck" = "missing";
	if (
		!(lock.text === undefined && lock.ageMs === undefined) &&
		stillBreakable(expected, owner, lock.ageMs, config.staleMs)
	) {
		outcome = yield* compareAndDelete(lockPath, held.mine, (moved, ageMs) => {
			if (Option.isSome(moved)) state.observed.add(moved.value.nonce);
			return stillBreakable(expected, moved, ageMs, config.staleMs);
		});
	}
	yield* ask({ _tag: "Remove", path: held.ticket });
	return outcome !== "stuck";
}

/**
 * Garbage-collects this key's tombs (`<key>.lock.tomb.<nonce>.<renamedAt>`, or
 * `<key>.lock.break.tomb.…` of an older breaker) whose
 * rename is older than `staleMs` — a caller that crashed between a rename and
 * its delete leaves one. Nobody else ever reads a tomb, and its owner treats
 * one that vanished as collected (never resurrecting it), so a plain remove is
 * the compare-and-delete here: the judgement is the immutable name.
 */
function* sweepTombs(config: MachineConfig): Protocol<void> {
	const names = yield* ask({ _tag: "ListDirectory", path: config.dir });
	if (names === undefined) return;
	const now = yield* ask({ _tag: "Now" });
	for (const name of names) {
		// Judged by the rename time in the name, never by mtime (which a rename
		// preserves). A tomb is abandoned once its critical section — a few
		// syscalls — has been outlived by `staleMs`.
		const renamedAt = tombRenamedAt(config.key, name);
		if (renamedAt === undefined || !Number.isFinite(renamedAt) || now - renamedAt <= config.staleMs) continue;
		yield* ask({ _tag: "Remove", path: pathOf(config.dir, name) });
	}
}

const RELEASE_BACKOFF_MS: ReadonlyArray<number> = [10, 25, 50, 100, 200];

/**
 * Releases the lock only while it still carries `nonce`. A rename that fails
 * outright — on Windows, a virus scanner or indexer holding the file without
 * share-delete answers `EPERM`/`EBUSY`/`EACCES` for a moment — is retried with
 * a short, uninterruptible backoff, so waiters are not left to the stale rule.
 */
function* release(lockPath: string, nonce: string): Protocol<void> {
	for (const pause of [0, ...RELEASE_BACKOFF_MS]) {
		if (pause > 0) yield* ask({ _tag: "Backoff", ms: pause });
		const outcome = yield* compareAndDelete(
			lockPath,
			nonce,
			(owner) => Option.isSome(owner) && owner.value.nonce === nonce,
		);
		if (outcome !== "stuck") return;
	}
}

/** The whole protocol: acquire or trust or give up, run, mark, release. */
export function* runOnceMachine(config: MachineConfig): Protocol<MachineOutcome> {
	return yield* protocol(config, { observed: new Set() });
}

function* protocol(config: MachineConfig, state: RunState): Protocol<MachineOutcome> {
	const lockPath = pathOf(config.dir, `${config.key}.lock`);
	const donePath = pathOf(config.dir, `${config.key}.done`);
	const { observed } = state;

	const unserialized = function* (reason: "waitTimeout" | "lockUnavailable"): Protocol<MachineOutcome> {
		// No done marker: a racer that ran unserialized proves nothing to a third caller.
		yield* ask({ _tag: "Run" });
		return { _tag: "RanUnserialized", reason };
	};
	const readDone = function* (): Protocol<Option.Option<DoneRecord>> {
		const text = yield* ask({ _tag: "ReadText", path: donePath });
		return text === undefined ? Option.none<DoneRecord>() : decodeDone(text);
	};

	if (!(yield* ask({ _tag: "MakeDirectory", path: config.dir }))) return yield* unserialized("lockUnavailable");
	yield* sweepTombs(config);

	const deadline = (yield* ask({ _tag: "Now" })) + config.waitTimeoutMs;
	for (;;) {
		// The LOCK is read before the done marker. An owner writes its marker and
		// only then releases, so a lock seen absent here means any marker its
		// owner wrote is already on disk for the read below.
		const lock = yield* observeLock(config, lockPath);
		if (lock._tag === "Held" && Option.isSome(lock.owner)) observed.add(lock.owner.value.nonce);
		const done = yield* readDone();
		const now = yield* ask({ _tag: "Now" });
		const decision = decide({ done, lock, now }, { observed, deadline }, config);

		switch (decision._tag) {
			case "Trust":
				return { _tag: "Trusted", owner: decision.done.nonce, finishedAt: decision.done.at };
			case "GiveUp":
				return yield* unserialized("waitTimeout");
			case "Wait":
				yield* ask({ _tag: "Sleep", ms: config.pollMs });
				continue;
			case "Takeover": {
				yield* sweepTombs(config);
				if (!(yield* breakLock(config, state, lockPath, decision.expected))) {
					yield* ask({ _tag: "Sleep", ms: config.pollMs });
				}
				continue;
			}
			case "Create": {
				const nonce = yield* freshNonce();
				const text = encodeOwner({ pid: config.self.pid, host: config.self.host, nonce, startedAt: now });
				const created = yield* ask({ _tag: "CreateExclusive", path: lockPath, text });
				if (created === "failed") return yield* unserialized("lockUnavailable");
				if (created === "exists") continue; // lost the race; observe the winner
				// Verify what the lock now holds. A non-atomic create (open, then
				// write) can be swept up between the two by a breaker's rename and
				// put back EMPTY, while our record went into its tomb: repair a
				// garbled lock with our record rather than leave it for the stale
				// rule. A lock that vanished, or holds another owner, is not ours.
				const held = yield* ask({ _tag: "ReadText", path: lockPath });
				if (held !== text) {
					if (held === undefined || Option.isSome(decodeOwner(held))) continue;
					yield* ask({ _tag: "WriteText", path: lockPath, text });
				}
				// An owner observed earlier may have finished between this poll's
				// reads and the create.
				const late = yield* readDone();
				if (Option.isSome(late) && observed.has(late.value.nonce)) {
					yield* release(lockPath, nonce);
					return { _tag: "Trusted", owner: late.value.nonce, finishedAt: late.value.at };
				}
				const ran = yield* ask({ _tag: "Run" });
				if (ran === "succeeded") {
					const at = yield* ask({ _tag: "Now" });
					yield* ask({ _tag: "WriteText", path: donePath, text: encodeDone({ nonce, at }) });
				}
				yield* release(lockPath, nonce);
				return { _tag: "Ran" };
			}
		}
	}
}

/** Settings as the caller spells them. */
export interface MachineInput {
	readonly key: string;
	readonly dir: string;
	readonly staleMs?: number | undefined;
	readonly pollMs?: number | undefined;
	readonly waitTimeoutMs?: number | undefined;
	readonly trustSequentialMs?: number | undefined;
}

export const DEFAULT_STALE_MS = 60_000;
export const DEFAULT_POLL_MS = 200;
export const MIN_POLL_MS = 10;
export const DEFAULT_WAIT_TIMEOUT_MS = 600_000;

const KEY = /^[A-Za-z0-9._-]{1,128}$/;

const positive = (name: string, value: number, minimum = 1): number => {
	if (!Number.isSafeInteger(value) || value < minimum) {
		throw new Error(`RunOnce: ${name} must be an integer >= ${minimum}, received ${value}`);
	}
	return value;
};

/** Validates caller settings. A bad setting is a wiring defect, so this throws. */
export const validate = (
	input: MachineInput,
): Omit<MachineConfig, "self" | "isAlive"> & { readonly key: string; readonly dir: string } => {
	if (!KEY.test(input.key)) {
		throw new Error(
			`RunOnce: key must match ${KEY.source} (hash anything else), received ${JSON.stringify(input.key)}`,
		);
	}
	if (input.dir === "") throw new Error("RunOnce: dir must not be empty");
	return {
		key: input.key,
		dir: input.dir,
		staleMs: positive("staleMs", input.staleMs ?? DEFAULT_STALE_MS),
		pollMs: positive("pollMs", input.pollMs ?? DEFAULT_POLL_MS, MIN_POLL_MS),
		waitTimeoutMs: positive("waitTimeoutMs", input.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS),
		trustSequentialMs:
			input.trustSequentialMs === undefined ? undefined : positive("trustSequentialMs", input.trustSequentialMs),
	};
};
