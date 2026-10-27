// A bounded, stateless model checker for the RunOnce protocol — ported from
// the review's checker (mc2.mts) to typed code, with files modelled by
// IDENTITY.
//
// Each schedule is a sequence of choices — which live process takes its next
// step, finishing a process that is inside its work (and, under `runFail`,
// failing it), or crashing one — replayed from scratch against a fresh world.
// Depth-first search walks every schedule within a CHESS-style preemption
// bound: switching away from a process that could still step costs one
// preemption; switching away from one inside its work, finished or crashed is
// free; a crash never costs one. A schedule in which any process sleeps more
// than `maxPolls` times is pruned (not a violation).
//
// The filesystem binds paths to inodes. A create or write is NON-ATOMIC — the
// path is bound to an empty inode at once and the text lands on THAT inode at
// the writer's next step — so a write follows its file through a rename, as a
// write through an open descriptor does. A rename moves the binding and keeps
// the inode (and its mtime).

import type { MachineConfig, MachineOutcome, Request } from "../src/internal/runOnceMachine.js";
import { validate } from "../src/internal/runOnceMachine.js";

/** One file's contents and modification time. */
interface Inode {
	text: string;
	mtime: number;
}

/** The machine under test: anything that turns a config into the protocol generator. */
export type MachineFactory = (config: MachineConfig) => Generator<Request, MachineOutcome, unknown>;

/** A scenario to explore. */
export interface ModelOptions {
	readonly label: string;
	/** Number of processes, all on one host. */
	readonly processes: number;
	/** How many crash choices a schedule may make. */
	readonly crashes: number;
	/** Preemption bound. */
	readonly preemptions: number;
	/** Prune a schedule once any process has slept more than this many times. */
	readonly maxPolls: number;
	/** Also explore a failing work for every finish choice. */
	readonly runFail?: boolean;
	/** The pre-existing files: path → [text, mtime]. */
	readonly initial?: Readonly<Record<string, readonly [string, number]>>;
	/** Stop after this many schedules (a safety valve; the suite asserts it is not hit). */
	readonly maxSchedules?: number;
	/**
	 * Also count SAFETY violations (an overlapping run, a displaced lock, a run
	 * despite an observed done marker, a hot loop) seen in a schedule that was
	 * later pruned by `maxPolls`. They are prefix-closed: once observed, no
	 * continuation undoes them. Defaults to `true`; `false` reproduces the
	 * review checker's counting, which judged complete schedules only.
	 */
	readonly countPrunedSafety?: boolean;
	/** Record a step-by-step trace for the first schedule of each violation kind. Slower; off by default. */
	readonly trace?: boolean;
	/**
	 * Partial-order reduction: never preempt a process whose next request is
	 * local (`Now`, `Nonce`, `MakeDirectory`). Such a step touches no shared
	 * file, so a switch just before it explores nothing a switch just before
	 * the process's next shared step does not. Defaults to `true`.
	 */
	readonly reduceLocal?: boolean;
	/**
	 * How a deferred (non-atomic) write lands. `"inode"` (the default) follows
	 * the file it opened through any rename, as a write through a descriptor
	 * does. `"path"` reproduces the review checker's model exactly — the text
	 * lands on whatever file is at the path by then, and a truncating write
	 * binds a fresh file — and exists only to compare the two checkers.
	 */
	readonly writes?: "inode" | "path";
	/** Report leftovers as one combined kind per schedule (the review checker's grouping) instead of one per path. */
	readonly combinedLeftovers?: boolean;
	/** Count every occurrence of a violation rather than once per schedule (the review checker's counting). */
	readonly countOccurrences?: boolean;
	/**
	 * The review checker's exact accounting, for comparing the two checkers
	 * only: overlapping runs and runs despite an observed done marker count per
	 * occurrence, in pruned schedules too; everything else once per complete
	 * schedule.
	 */
	readonly reviewAccounting?: boolean;
}

const LOCAL: ReadonlySet<Request["_tag"]> = new Set(["Now", "Nonce", "MakeDirectory"]);

const SAFETY = new Set(["DOUBLE_RUN_OVERLAP", "RAN_DESPITE_OBSERVED_DONE", "LOCK_DISPLACED_WHILE_RUNNING", "HOT_LOOP"]);

/** What one exploration found. */
export interface ModelReport {
	readonly leaves: number;
	readonly pruned: number;
	readonly capped: boolean;
	/** Violation kind → count, over all complete schedules. */
	readonly violations: ReadonlyMap<string, number>;
	/** The first schedule's trace for each violation kind. */
	readonly traces: ReadonlyMap<string, ReadonlyArray<string>>;
}

const DIR = "/d";
const LOCK = "/d/k.lock";
const DONE = "/d/k.done";
/** A per-schedule step cap: a loop that never sleeps must FAIL, not hang the explorer. */
const STEP_CAP = 4000;

interface Proc {
	readonly id: number;
	readonly gen: Generator<Request, MachineOutcome, unknown>;
	next: IteratorResult<Request, MachineOutcome>;
	done: boolean;
	crashed: boolean;
	running: boolean;
	serialized: boolean;
	lockText: string | undefined;
	polls: number;
	readonly observed: Set<string>;
	deferred: (() => void) | undefined;
	outcome: MachineOutcome | undefined;
}

const parse = (text: string | undefined): { readonly pid?: unknown; readonly nonce?: unknown } | undefined => {
	if (text === undefined || text === "") return undefined;
	try {
		return JSON.parse(text) as { readonly pid?: unknown; readonly nonce?: unknown };
	} catch {
		return undefined;
	}
};

/** Explores every schedule of `options` within its bounds against `machine`. */
export const explore = (options: ModelOptions, machine: MachineFactory): ModelReport => {
	const stack: Array<{ index: number; count: number }> = [];
	const violations = new Map<string, number>();
	const traces = new Map<string, ReadonlyArray<string>>();
	let leaves = 0;
	let pruned = 0;
	let capped = false;

	for (;;) {
		// ---- replay one schedule from scratch ----
		let depth = 0;
		const choose = (count: number): number => {
			const existing = stack[depth];
			if (existing !== undefined) {
				depth++;
				return existing.index;
			}
			stack.push({ index: 0, count });
			depth++;
			return 0;
		};
		const paths = new Map<string, number>();
		const inodes = new Map<number, Inode>();
		let nextInode = 1;
		const bind = (path: string, text: string, mtime: number): number => {
			const id = nextInode++;
			inodes.set(id, { text, mtime });
			paths.set(path, id);
			return id;
		};
		const fileAt = (path: string): Inode | undefined => {
			const id = paths.get(path);
			return id === undefined ? undefined : inodes.get(id);
		};
		for (const [path, [text, mtime]] of Object.entries(options.initial ?? {})) bind(path, text, mtime);
		let clock = 10_000;
		let nonces = 0;
		let crashesLeft = options.crashes;
		let preemptionsLeft = options.preemptions;
		let last = -1;
		let prune = false;
		let steps = 0;
		const trace: Array<string> = [];
		const tracing = options.trace === true;
		const scheduleViolations = new Map<string, number>();
		const violate = (kind: string): void => {
			if (
				options.reviewAccounting === true &&
				(kind === "DOUBLE_RUN_OVERLAP" || kind === "RAN_DESPITE_OBSERVED_DONE")
			) {
				// Counted immediately, per occurrence, whether or not the schedule is later pruned.
				violations.set(kind, (violations.get(kind) ?? 0) + 1);
				if (!traces.has(kind)) traces.set(kind, [...trace]);
				return;
			}
			const seen = scheduleViolations.get(kind);
			if (seen === undefined) scheduleViolations.set(kind, 1);
			else if (options.countOccurrences === true && options.reviewAccounting !== true) {
				scheduleViolations.set(kind, seen + 1);
			}
		};

		const procs: Array<Proc> = [];
		for (let index = 0; index < options.processes; index++) {
			const id = index + 1;
			const config: MachineConfig = {
				...validate({ key: "k", dir: DIR, pollMs: 100, staleMs: 1000, waitTimeoutMs: 1_000_000 }),
				self: { pid: id, host: "h" },
				isAlive: (pid) => {
					const proc = procs[pid - 1];
					return proc !== undefined && !proc.crashed && !proc.done;
				},
			};
			const gen = machine(config);
			procs.push({
				id,
				gen,
				next: gen.next(),
				done: false,
				crashed: false,
				running: false,
				serialized: false,
				lockText: undefined,
				polls: 0,
				observed: new Set(),
				deferred: undefined,
				outcome: undefined,
			});
		}

		const answer = (proc: Proc, request: Request): unknown => {
			clock += 1;
			switch (request._tag) {
				case "Now":
					return clock;
				case "Nonce":
					return `p${proc.id}n${++nonces}`;
				case "Sleep":
					clock += request.ms;
					proc.polls++;
					if (proc.polls > options.maxPolls) prune = true;
					return undefined;
				case "Backoff":
					clock += request.ms;
					return undefined;
				case "MakeDirectory":
					return true;
				case "ReadText": {
					const text = fileAt(request.path)?.text;
					if (request.path === LOCK) {
						const nonce = parse(text)?.nonce;
						if (typeof nonce === "string") proc.observed.add(nonce);
					}
					return text;
				}
				case "AgeMs": {
					const file = fileAt(request.path);
					return file === undefined ? undefined : clock - file.mtime;
				}
				case "CreateExclusive": {
					if (paths.has(request.path)) return "exists";
					const id = bind(request.path, "", clock);
					proc.deferred =
						options.writes === "path"
							? () => {
									const file = fileAt(request.path);
									if (file !== undefined && file.text === "") file.text = request.text;
								}
							: () => {
									const inode = inodes.get(id);
									if (inode !== undefined) inode.text = request.text;
								};
					return "created";
				}
				case "WriteText": {
					if (options.writes === "path") {
						bind(request.path, "", clock);
						proc.deferred = () => {
							const file = fileAt(request.path);
							if (file !== undefined) file.text = request.text;
						};
						return undefined;
					}
					// A truncating write keeps the existing inode; a missing path gets a new one.
					let id = paths.get(request.path);
					if (id === undefined) id = bind(request.path, "", clock);
					else {
						const inode = inodes.get(id);
						if (inode !== undefined) {
							inode.text = "";
							inode.mtime = clock;
						}
					}
					const target = id;
					proc.deferred = () => {
						const inode = inodes.get(target);
						if (inode !== undefined) inode.text = request.text;
					};
					return undefined;
				}
				case "Remove":
					paths.delete(request.path);
					return undefined;
				case "Rename": {
					const id = paths.get(request.from);
					if (id === undefined) return "missing";
					paths.delete(request.from);
					paths.set(request.to, id);
					return "renamed";
				}
				case "ListDirectory":
					return [...paths.keys()]
						.filter((path) => path.startsWith(`${request.path}/`))
						.map((path) => path.slice(request.path.length + 1));
				case "Run":
					throw new Error("Run is handled by the scheduler");
			}
		};

		const deliver = (proc: Proc, value: unknown): void => {
			proc.next = proc.gen.next(value);
			if (proc.next.done === true) {
				proc.done = true;
				proc.outcome = proc.next.value;
				tracing && trace.push(`P${proc.id} => ${JSON.stringify(proc.next.value)}`);
			}
		};

		const step = (proc: Proc): void => {
			const pending = proc.deferred;
			proc.deferred = undefined;
			pending?.();
			if (proc.next.done === true) return;
			const request = proc.next.value;
			if (request._tag === "Run") {
				const lock = fileAt(LOCK)?.text;
				const mine = parse(lock)?.pid === proc.id;
				proc.serialized = mine;
				proc.lockText = mine ? lock : undefined;
				const others = procs.filter((other) => other !== proc && other.running && other.serialized);
				if (mine && others.length > 0) violate("DOUBLE_RUN_OVERLAP");
				const done = parse(fileAt(DONE)?.text)?.nonce;
				if (mine && typeof done === "string" && proc.observed.has(done)) violate("RAN_DESPITE_OBSERVED_DONE");
				proc.running = true;
				tracing && trace.push(`P${proc.id} RUN start (serialized=${mine})`);
				return;
			}
			tracing &&
				trace.push(
					`P${proc.id} ${request._tag} ${"path" in request ? request.path : ""}${"from" in request ? `${request.from}->${request.to}` : ""}`,
				);
			const value = answer(proc, request);
			if (!prune) deliver(proc, value);
		};

		const finish = (proc: Proc, how: "succeeded" | "failed"): void => {
			proc.running = false;
			tracing && trace.push(`P${proc.id} run ${how}`);
			deliver(proc, how);
		};

		for (;;) {
			const live = procs.filter((proc) => !proc.done && !proc.crashed);
			if (live.length === 0) break;
			if (++steps > STEP_CAP) {
				violate("HOT_LOOP");
				break;
			}
			const choices: Array<{ readonly pid: number; readonly crash: boolean; readonly run: () => void }> = [];
			for (const proc of live) {
				if (proc.running) {
					choices.push({ pid: proc.id, crash: false, run: () => finish(proc, "succeeded") });
					if (options.runFail === true) choices.push({ pid: proc.id, crash: false, run: () => finish(proc, "failed") });
				} else {
					choices.push({ pid: proc.id, crash: false, run: () => step(proc) });
				}
				if (crashesLeft > 0) {
					choices.push({
						pid: proc.id,
						crash: true,
						run: () => {
							proc.crashed = true;
							proc.running = false;
							crashesLeft--;
							tracing && trace.push(`P${proc.id} CRASH`);
						},
					});
				}
			}
			const lastLive = live.find((proc) => proc.id === last && !proc.running);
			const lastLocal =
				options.reduceLocal !== false &&
				lastLive !== undefined &&
				lastLive.next.done !== true &&
				lastLive.deferred === undefined &&
				LOCAL.has(lastLive.next.value._tag);
			const isPreemption = (choice: { readonly pid: number; readonly crash: boolean }): boolean =>
				lastLive !== undefined && choice.pid !== last && !choice.crash;
			const allowed = choices.filter((choice) => !isPreemption(choice) || (preemptionsLeft > 0 && !lastLocal));
			const chosen = allowed[choose(allowed.length)];
			if (chosen === undefined) break;
			if (isPreemption(chosen)) preemptionsLeft--;
			if (!chosen.crash) last = chosen.pid;
			chosen.run();
			if (prune) break;
			for (const proc of procs) {
				if (proc.running && proc.serialized && proc.lockText !== undefined && fileAt(LOCK)?.text !== proc.lockText) {
					violate("LOCK_DISPLACED_WHILE_RUNNING");
				}
			}
		}

		if (prune) {
			pruned++;
			if (options.countPrunedSafety !== false) {
				for (const [kind, count] of scheduleViolations) {
					if (!SAFETY.has(kind)) continue;
					violations.set(kind, (violations.get(kind) ?? 0) + count);
					if (!traces.has(kind)) traces.set(kind, [...trace]);
				}
			}
		} else {
			leaves++;
			const crashed = procs.some((proc) => proc.crashed);
			const leftovers = [...paths.keys()].filter(
				(path) => path.includes(".tomb.") || path.startsWith(`${LOCK}.break`) || path === LOCK,
			);
			if (!crashed && leftovers.length > 0) {
				const shown = leftovers.map((path) => path.replace(/\.p\d+n\d+(\.\d+)?$/, ".*"));
				// A breaker ticket is `k.lock.break.<nonce>`; the review checker named the single file `k.lock.break`.
				if (options.combinedLeftovers === true) violate(`LEFTOVER_FILES_NO_CRASH(${shown.join(",")})`);
				else for (const path of shown) violate(`LEFTOVER_FILES_NO_CRASH(${path})`);
			}
			for (const proc of procs) {
				if (proc.outcome?._tag === "RanUnserialized") violate(`UNSERIALIZED(${proc.outcome.reason})`);
			}
			for (const [kind, count] of scheduleViolations) {
				violations.set(kind, (violations.get(kind) ?? 0) + count);
				if (!traces.has(kind)) traces.set(kind, [...trace]);
			}
		}

		// ---- backtrack to the next unexplored choice ----
		while (stack.length > 0 && (stack[stack.length - 1]?.index ?? 0) + 1 >= (stack[stack.length - 1]?.count ?? 0)) {
			stack.pop();
		}
		const top = stack[stack.length - 1];
		if (top === undefined) break;
		top.index++;
		if (options.maxSchedules !== undefined && leaves + pruned >= options.maxSchedules) {
			capped = true;
			break;
		}
	}
	return { leaves, pruned, capped, violations, traces };
};

/** A dead lock: owner pid 99 (never alive in the model), created at time 0. */
export const DEAD_LOCK: Readonly<Record<string, readonly [string, number]>> = {
	[LOCK]: [JSON.stringify({ pid: 99, host: "h", nonce: "dead", startedAt: 0 }), 0],
};

/** A dead lock plus a stale breaker left by a dead holder. */
export const STALE_BREAKER: Readonly<Record<string, readonly [string, number]>> = {
	...DEAD_LOCK,
	[`${LOCK}.break`]: [JSON.stringify({ pid: 98, host: "h", nonce: "oldbreaker", startedAt: 0 }), 0],
};
