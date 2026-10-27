// The RunOnce protocol under a bounded model checker (`runOnceModel.ts`):
// every schedule of 2–3 processes within a preemption bound, with
// non-atomic creates and writes, against the invariants the protocol owes —
// no two serialized runs overlap, a running owner's lock is never displaced,
// no run happens despite an observed done marker, no hot loop, and nothing
// (lock, breaker, tomb) left behind by a crash-free schedule.
//
// Calibrated before it was trusted: against the protocol as it stood before
// the stale-breaker fix, this explorer reproduces the review's numbers for
// scenario e (33,098 leaves, 1,600 runs despite an observed done, at the
// review's counting) and finds the breaker race in g0. Each scenario carries a
// leaf-count FLOOR as its positive control, so an explorer that silently
// stopped exploring cannot pass.

import { assert, describe, it } from "@effect/vitest";
import { runOnceMachine } from "../src/internal/runOnceMachine.js";
import type { MachineFactory, ModelOptions, ModelReport } from "./runOnceModel.js";
import { DEAD_LOCK, explore } from "./runOnceModel.js";

const machine: MachineFactory = runOnceMachine;

/** A dead lock plus a stale breaker whose record is unreadable (so only its age can condemn it). */
const STALE_BREAKER_WRECK = { ...DEAD_LOCK, "/d/k.lock.break": ["oldbreaker", 0] as const };

const check = (options: ModelOptions, floor: number): ModelReport => {
	const report = explore(options, machine);
	if (report.violations.size > 0) {
		// Re-explore with tracing only on failure: the trace is the debugging aid.
		const traced = explore({ ...options, trace: true }, machine);
		const [kind, trace] = [...traced.traces.entries()][0] ?? ["?", []];
		assert.fail(
			`${options.label}: ${[...report.violations.entries()].map(([k, n]) => `${k} x${n}`).join(", ")}\n` +
				`first ${kind} schedule:\n${trace.join("\n")}`,
		);
	}
	assert.isFalse(report.capped, `${options.label}: hit the schedule cap`);
	assert.isAtLeast(report.leaves, floor, `${options.label}: explored too few schedules — is the explorer broken?`);
	return report;
};

describe("RunOnce protocol, model-checked", () => {
	it("a: 2 processes, no crash, failing work explored, preemption bound 3", { timeout: 60_000 }, () => {
		check({ label: "a", processes: 2, crashes: 0, preemptions: 3, maxPolls: 3, runFail: true }, 16_000);
	});

	it("c: 3 processes, no crash, preemption bound 2", { timeout: 60_000 }, () => {
		check({ label: "c", processes: 3, crashes: 0, preemptions: 2, maxPolls: 2 }, 13_000);
	});

	it("e: a pre-existing dead lock, 2 processes, preemption bound 3", { timeout: 60_000 }, () => {
		check({ label: "e", processes: 2, crashes: 0, preemptions: 3, maxPolls: 3, initial: DEAD_LOCK }, 21_000);
	});

	it("g0 (2 processes): dead lock + stale breaker, preemption bound 2 — the breaker-race regression", {
		timeout: 60_000,
	}, () => {
		// The age-then-text TOCTOU in the stale-breaker sweep displaces a running
		// owner's lock with just two processes; a third only turns it into an
		// overlapping run. This is the fast regression for it.
		check(
			{ label: "g0/2", processes: 2, crashes: 0, preemptions: 2, maxPolls: 1, initial: STALE_BREAKER_WRECK },
			1_000,
		);
	});

	it("g0 (2 processes): dead lock + stale breaker, preemption bound 3 — breaker put-back leftovers", {
		timeout: 120_000,
	}, () => {
		// The shape that once let a stale-breaker sweep carry a live breaker off
		// and put it back after its holder moved on. With per-contender tickets
		// nothing about a breaker is ever renamed or put back.
		check(
			{ label: "g0/2/b3", processes: 2, crashes: 0, preemptions: 3, maxPolls: 1, initial: STALE_BREAKER_WRECK },
			15_000,
		);
	});

	it("g0 (3 processes): dead lock + stale breaker, preemption bound 2", { timeout: 120_000 }, () => {
		check(
			{ label: "g0/3", processes: 3, crashes: 0, preemptions: 2, maxPolls: 1, initial: STALE_BREAKER_WRECK },
			18_000,
		);
	});
});
