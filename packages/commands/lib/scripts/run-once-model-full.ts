/**
 * The RunOnce protocol at the review's FULL model-checking bounds.
 *
 * `__test__/RunOnce.model.test.ts` runs a fast subset on every test run. This
 * script is the single definition of "the full bounds" that
 * `packages/commands/CLAUDE.md` and `okf/decisions/run-once-trust.md` demand
 * a change to `src/internal/runOnceMachine.ts` stay clean at: scenarios a–h
 * and g0, each explored in `once` mode, in `serialize` mode, and with `once`
 * and `serialize` callers mixed on one key in both orders.
 *
 * It is offline and deliberately NOT part of CI or the vitest run: the whole
 * matrix takes tens of minutes. Run it by hand:
 *
 * ```sh
 * pnpm --filter @effected/commands model:full
 * pnpm --filter @effected/commands model:full -- --scenario g0 --mode serialize
 * ```
 *
 * Every scenario × mode runs in its own child process under a hard timeout
 * (`--timeout-ms`, default 1800000; scenario g alone takes five to ten minutes), killed with SIGKILL when it overruns, so a
 * protocol change that makes the explorer loop cannot hang the run. The script
 * exits non-zero on any violation, a hit schedule cap, a timeout, a child that
 * crashed, or an exploration below its leaf floor (an explorer that silently
 * stopped exploring).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { ModelOptions } from "../../__test__/runOnceModel.js";
import { DEAD_LOCK, explore } from "../../__test__/runOnceModel.js";
import { runOnceMachine } from "../../src/internal/runOnceMachine.js";

/** A dead lock plus a stale breaker whose record is unreadable, so only its age can condemn it. */
const STALE_BREAKER_WRECK = { ...DEAD_LOCK, "/d/k.lock.break": ["oldbreaker", 0] as const };

type Bounds = Omit<ModelOptions, "label" | "serialize" | "modes">;

/** The review's full bounds. Change one only with a reason recorded in `okf/decisions/run-once-trust.md`. */
const SCENARIOS: Readonly<Record<string, Bounds>> = {
	a: { processes: 2, crashes: 0, preemptions: 3, maxPolls: 3, runFail: true },
	b: { processes: 2, crashes: 1, preemptions: 3, maxPolls: 3 },
	c: { processes: 3, crashes: 0, preemptions: 2, maxPolls: 2 },
	d: { processes: 3, crashes: 1, preemptions: 2, maxPolls: 2 },
	e: { processes: 2, crashes: 0, preemptions: 3, maxPolls: 3, initial: DEAD_LOCK },
	f: { processes: 3, crashes: 0, preemptions: 2, maxPolls: 2, initial: DEAD_LOCK },
	g: { processes: 3, crashes: 1, preemptions: 2, maxPolls: 2, initial: STALE_BREAKER_WRECK },
	h: { processes: 2, crashes: 1, preemptions: 3, maxPolls: 3, initial: DEAD_LOCK },
	g0: { processes: 3, crashes: 0, preemptions: 3, maxPolls: 2, initial: STALE_BREAKER_WRECK },
};

type Mode = "once" | "serialize" | "mixed" | "mixed-reverse";
const MODES: ReadonlyArray<Mode> = ["once", "serialize", "mixed", "mixed-reverse"];

/** The per-process modes a run mode stands for: `mixed` alternates starting with `once`, `mixed-reverse` with `serialize`. */
const modesFor = (mode: Mode, processes: number): ReadonlyArray<"once" | "serialize"> =>
	Array.from({ length: processes }, (_, index) => {
		if (mode === "once" || mode === "serialize") return mode;
		const first = mode === "mixed" ? "once" : "serialize";
		const second = first === "once" ? "serialize" : "once";
		return index % 2 === 0 ? first : second;
	});

/** A safety valve on schedules per exploration; hitting it is a failure, never a pass. */
const MAX_SCHEDULES = 50_000_000;
/** Every full-bounds exploration reaches far more leaves than this; fewer means the explorer stopped exploring. */
const LEAF_FLOOR = 10_000;

interface ChildReport {
	readonly leaves: number;
	readonly pruned: number;
	readonly capped: boolean;
	readonly violations: ReadonlyArray<readonly [string, number]>;
	readonly ms: number;
}

/** Run ONE scenario × mode in this process and print its report as one JSON line. */
const child = (scenario: string, mode: Mode): void => {
	const bounds = SCENARIOS[scenario];
	if (bounds === undefined) throw new Error(`unknown scenario ${scenario}`);
	const started = Date.now();
	const report = explore(
		{ ...bounds, label: `${mode} ${scenario}`, modes: modesFor(mode, bounds.processes), maxSchedules: MAX_SCHEDULES },
		runOnceMachine,
	);
	const out: ChildReport = {
		leaves: report.leaves,
		pruned: report.pruned,
		capped: report.capped,
		violations: [...report.violations.entries()],
		ms: Date.now() - started,
	};
	process.stdout.write(`${JSON.stringify(out)}\n`);
};

const flag = (args: ReadonlyArray<string>, name: string): string | undefined => {
	const at = args.indexOf(name);
	return at === -1 ? undefined : args[at + 1];
};

/** Run every selected scenario × mode in a child process under the hard timeout; exit non-zero on any failure. */
const parent = (args: ReadonlyArray<string>): void => {
	const onlyScenario = flag(args, "--scenario");
	const onlyMode = flag(args, "--mode");
	const timeoutMs = Number(flag(args, "--timeout-ms") ?? "1800000");
	if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error(`--timeout-ms must be a positive integer`);
	if (onlyScenario !== undefined && !(onlyScenario in SCENARIOS)) throw new Error(`unknown --scenario ${onlyScenario}`);
	if (onlyMode !== undefined && !MODES.includes(onlyMode as Mode)) throw new Error(`unknown --mode ${onlyMode}`);

	const self = fileURLToPath(import.meta.url);
	let failures = 0;
	for (const mode of MODES) {
		if (onlyMode !== undefined && mode !== onlyMode) continue;
		for (const scenario of Object.keys(SCENARIOS)) {
			if (onlyScenario !== undefined && scenario !== onlyScenario) continue;
			// `process.execArgv` carries the TypeScript loader this script was started under.
			const result = spawnSync(process.execPath, [...process.execArgv, self, "--child", scenario, mode], {
				encoding: "utf8",
				timeout: timeoutMs,
				killSignal: "SIGKILL",
				maxBuffer: 16 * 1024 * 1024,
			});
			const line = `${mode} ${scenario}`;
			if (result.error !== undefined || result.signal !== null) {
				failures++;
				process.stdout.write(
					`${line} FAILED: ${result.signal === "SIGKILL" ? `timed out after ${timeoutMs}ms` : String(result.error ?? result.signal)}\n`,
				);
				continue;
			}
			if (result.status !== 0) {
				failures++;
				process.stdout.write(`${line} FAILED: child exited ${result.status}\n${result.stderr}\n`);
				continue;
			}
			const report = JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as ChildReport;
			const problems = [
				...report.violations.map(([kind, count]) => `${kind} x${count}`),
				...(report.capped ? [`hit the ${MAX_SCHEDULES}-schedule cap`] : []),
				...(report.leaves < LEAF_FLOOR ? [`only ${report.leaves} leaves, below the ${LEAF_FLOOR} floor`] : []),
			];
			if (problems.length > 0) failures++;
			process.stdout.write(
				`${line} leaves ${report.leaves} pruned ${report.pruned} ${report.ms}ms ${problems.length === 0 ? "clean" : `FAILED: ${problems.join(", ")}`}\n`,
			);
		}
	}
	process.stdout.write(failures === 0 ? "all clean\n" : `${failures} failed\n`);
	process.exitCode = failures === 0 ? 0 : 1;
};

const args = process.argv.slice(2);
if (args[0] === "--child") child(args[1] ?? "", (args[2] ?? "") as Mode);
else parent(args);
