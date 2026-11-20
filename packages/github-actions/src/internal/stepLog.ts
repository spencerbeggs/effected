import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";
import type { Console } from "effect";
import { Context } from "effect";

/**
 * The step log's state and renderer: what `ActionLogger.step` holds while a step runs, and the lines it writes when
 * the step ends.
 *
 * @remarks
 * Everything here is synchronous on purpose. A logger callback is synchronous, and so is a `Console` write, so every
 * mutation of a {@link StepRun} and every write it causes happens inside one synchronous block: nothing can interleave
 * between reading the mode and acting on it. That is the lock a switch from `"held"` to `"live"` needs.
 *
 * @internal
 */

/**
 * The state one outermost step shares with every step nested inside it.
 *
 * @remarks
 * One place for the held detail and the mode, because only the outermost step has a window: an inner step's detail
 * is part of the outer detail, so it lands in the same buffer in the order it happened.
 */
export interface StepRun {
	/** `"held"` while the detail is buffered for the fold; `"live"` once it streams. */
	mode: "held" | "live";
	/** The held detail, unneutralized, each line already indented for its nesting. */
	readonly lines: Array<string>;
	/** The console the step was opened under, which every line goes out through. */
	readonly console: Console.Console;
	/** Whether the result may open a `::group::`: false when the step opened inside a group, which cannot nest. */
	readonly canFold: boolean;
	/** Whether any step in the run failed, recovered or not: such a run is never folded. */
	failed: boolean;
}

/** One open step: the outermost one, or one nested inside it. */
export interface StepFrame {
	readonly name: string;
	readonly run: StepRun;
	/** The enclosing step, so warnings aggregate upward and a nested step knows it is nested. */
	readonly parent: StepFrame | null;
	/** Nesting among steps: 0 for the outermost. */
	readonly depth: number;
	warnings: number;
	errors: number;
	/** Steps nested inside this one that failed or were interrupted, whether or not this one recovered. */
	failedSteps: number;
}

/**
 * The step the current fiber is inside, or `null`.
 *
 * @remarks
 * A `Context.Reference` for the reason `ActiveBuffer` is one: concurrent steps each keep their own frame, and nothing
 * has to be restored on any exit path.
 */
export const ActiveStep = Context.Reference<StepFrame | null>("@effected/github-actions/ActiveStep", {
	defaultValue: () => null,
});

/** Open a step: a new outermost run, or a frame nested in `parent`'s run. */
export const open = (name: string, parent: StepFrame | null, console: Console.Console, canFold: boolean): StepFrame =>
	parent === null
		? {
				name,
				run: { mode: "held", lines: [], console, canFold, failed: false },
				parent: null,
				depth: 0,
				warnings: 0,
				errors: 0,
				failedSteps: 0,
			}
		: { name, run: parent.run, parent, depth: parent.depth + 1, warnings: 0, errors: 0, failedSteps: 0 };

/** Write one line, neutralized: every line is caller or program text. */
const write = (run: StepRun, line: string): void => {
	run.console.log(CommandNeutralizer.text(line));
};

/** The indent a step's detail takes: two spaces per level of nesting. */
const indent = (depth: number): string => "  ".repeat(depth);

/** The runner's line breaks. */
const LINE_BREAK = /\r\n|\r|\n/;

/**
 * Add detail to a step, held or streamed by its run's mode.
 *
 * @remarks
 * Split at every line break first, so each line of a multi-line entry (a git transcript is one) takes the indent.
 */
export const detail = (frame: StepFrame, text: string): void => {
	for (const part of text.split(LINE_BREAK)) {
		const line = `${indent(frame.depth)}${part}`;
		if (frame.run.mode === "held") {
			frame.run.lines.push(line);
		} else {
			write(frame.run, `  ${line}`);
		}
	}
};

/** Count a warning or an error against a step and every step around it. */
export const countAnnotation = (frame: StepFrame, kind: "warning" | "error"): void => {
	for (let current: StepFrame | null = frame; current !== null; current = current.parent) {
		if (kind === "warning") {
			current.warnings += 1;
		} else {
			current.errors += 1;
		}
	}
};

/** How a step ended, with the text its result line shows. */
export type StepOutcome =
	| { readonly _tag: "Success"; readonly text: string }
	| { readonly _tag: "Failure"; readonly text: string }
	| { readonly _tag: "Interrupted" };

const green = (text: string): string => `\x1b[32m${text}\x1b[39m`;
const yellow = (text: string): string => `\x1b[33m${text}\x1b[39m`;
const red = (text: string): string => `\x1b[31m${text}\x1b[39m`;
const dim = (text: string): string => `\x1b[2m${text}\x1b[22m`;

/** A phase heading: bold, one line. */
export const heading = (title: string): string => `\x1b[1m${title.replace(/\r\n|\r|\n/g, " ")}\x1b[22m`;

/** A duration as the result line shows it: tenths of a second under a minute, then minutes and seconds. */
export const formatDuration = (millis: number): string => {
	if (millis < 60_000) {
		return `${(Math.floor(millis / 100) / 10).toFixed(1)}s`;
	}
	const seconds = Math.floor(millis / 1000);
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** `<mark> <text> · <counts> · <duration>`, or `✗ <name> · interrupted`. */
const resultLine = (frame: StepFrame, outcome: StepOutcome, millis: number): string => {
	if (outcome._tag === "Interrupted") {
		return `${red("✗")} ${frame.name} · interrupted`;
	}
	const counts = [
		...(frame.warnings > 0 ? [plural(frame.warnings, "warning")] : []),
		...(frame.errors > 0 ? [plural(frame.errors, "error")] : []),
		...(frame.failedSteps > 0 ? [plural(frame.failedSteps, "failed step")] : []),
	];
	const mark = outcome._tag === "Failure" ? red("✗") : counts.length > 0 ? yellow("⚠") : green("✓");
	const text = outcome.text.replace(/\r\n|\r|\n/g, " ");
	return [`${mark} ${text}`, ...counts, dim(formatDuration(millis))].join(" · ");
};

/**
 * End a step and write what it owes the log.
 *
 * @remarks
 * A nested step adds its result line to the enclosing step's detail; when it failed or was interrupted it counts as a
 * failed step against every step around it and marks the run failed, so an outer step that recovers still shows `⚠`
 * and never folds the failure away. The outermost step writes its held detail: under a folded `::group::` titled by the
 * result line when every step in the run succeeded, or indented beneath an unfolded result line otherwise, or when the
 * step cannot fold. A step with no detail is its result line alone.
 */
export const close = (frame: StepFrame, outcome: StepOutcome, millis: number): void => {
	const line = resultLine(frame, outcome, millis);
	if (frame.parent !== null) {
		if (outcome._tag !== "Success") {
			frame.run.failed = true;
			for (let current: StepFrame | null = frame.parent; current !== null; current = current.parent) {
				current.failedSteps += 1;
			}
		}
		detail(frame.parent, line);
		return;
	}
	const run = frame.run;
	const held = run.lines.splice(0);
	if (held.length === 0) {
		write(run, line);
		return;
	}
	if (outcome._tag === "Success" && run.canFold && !run.failed) {
		run.console.log(WorkflowCommand.group(line));
		for (const entry of held) {
			write(run, entry);
		}
		run.console.log(WorkflowCommand.endGroup());
		return;
	}
	write(run, line);
	for (const entry of held) {
		write(run, `  ${entry}`);
	}
};
