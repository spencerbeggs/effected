// A differential worker: runs triples one at a time against the engine and the
// installed minimatch oracle, reporting each result to the parent over IPC.
// It takes one triple per message and says `phase engine` once the oracle side is
// done, so when the parent's watchdog kills a worker stalled in the vendored
// backtracking regexp it knows which triple, and which side, was running. Run by `run.ts`; not collected by vitest.

import { Minimatch as OracleMinimatch } from "minimatch";
import { isGuardExceeded } from "../../src/internal/limits.js";
import { Minimatch } from "../../src/internal/minimatch.js";
import {
	bracketsAcrossAlternatives,
	hasLargeNumericRange,
	oracleAnswer,
	oracleOpts,
	pastCapExtglob,
} from "../support/oracle.js";
import type { Triple } from "./generate.js";

export type Side = "oracle" | "engine";

/** What one side did with a triple. */
export type Outcome =
	| { readonly kind: "ok"; readonly match: boolean; readonly hasMagic: boolean }
	| { readonly kind: "typed"; readonly reason: string }
	| { readonly kind: "throw"; readonly message: string };

export interface Result {
	readonly index: number;
	readonly oracle: Outcome;
	readonly engine: Outcome;
	readonly exceptions: ReadonlyArray<string>;
}

export type ToParent =
	| { readonly t: "phase"; readonly index: number; readonly side: Side }
	| { readonly t: "result"; readonly result: Result };

/** One triple per message, so the parent always knows which one is running. */
export interface ToWorker {
	readonly index: number;
	readonly triple: Triple;
}

const runOracle = (tr: Triple): Outcome => {
	try {
		const opts = oracleOpts(tr.options);
		const m = new OracleMinimatch(tr.pattern, opts);
		const hasMagic = m.hasMagic();
		// the defect-aware answer, as the compliance test holds the engine to
		return { kind: "ok", match: oracleAnswer(tr.path, tr.pattern, opts), hasMagic };
	} catch (e) {
		return { kind: "throw", message: e instanceof Error ? e.message : String(e) };
	}
};

const runEngine = (tr: Triple): Outcome => {
	try {
		const m = new Minimatch(tr.pattern, tr.options);
		return { kind: "ok", match: m.match(tr.path), hasMagic: m.hasMagic() };
	} catch (e) {
		if (isGuardExceeded(e)) return { kind: "typed", reason: e.reason };
		return { kind: "throw", message: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
	}
};

const exceptionsFor = (tr: Triple): ReadonlyArray<string> => {
	const out: Array<string> = [];
	if (hasLargeNumericRange(tr.pattern)) out.push("hasLargeNumericRange");
	if (pastCapExtglob(tr.pattern, tr.options.maxExtglobRecursion)) out.push("pastCapExtglob");
	try {
		if (bracketsAcrossAlternatives(new OracleMinimatch(tr.pattern, oracleOpts(tr.options)))) {
			out.push("bracketsAcrossAlternatives");
		}
	} catch {
		// the oracle rejects the pattern: nothing to classify
	}
	return out;
};

if (process.send) {
	const send = (m: ToParent): void => {
		process.send?.(m);
	};
	process.on("message", ({ index, triple }: ToWorker) => {
		const oracle = runOracle(triple);
		// the engine is the side that stalls; say so before it starts
		send({ t: "phase", index, side: "engine" });
		const engine = runEngine(triple);
		send({ t: "result", result: { index, oracle, engine, exceptions: exceptionsFor(triple) } });
	});
}
