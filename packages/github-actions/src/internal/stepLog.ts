import { CommandNeutralizer, WorkflowCommand } from "@effected/github-commands";
import type { Console, LogLevel } from "effect";
import { Context, Inspectable } from "effect";

/**
 * The step log's state and renderer: what `ActionLogger.step` holds while a step runs, and the lines it writes when
 * the step ends.
 *
 * @remarks
 * Everything here is synchronous on purpose. A logger callback is synchronous, and so is a `Console` write, so every
 * mutation of a {@link StepRun} and every write it causes happens inside one synchronous block: nothing can interleave
 * between reading the mode and acting on it. That is the lock a switch from `"held"` to `"live"` needs: the window
 * timer's {@link goLive} flushes the held lines and flips the mode in one block, so a line is either held and flushed
 * or printed live, never both and never lost between the two.
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
	/** The outermost step's name, which prefixes its live lines while another step streams too. */
	readonly name: string;
	/**
	 * `"held"` while the detail is buffered for the fold; `"live"` once it streams; `"closed"` once the outermost step
	 * has written its result, after which a late line (from a fiber forked inside the step) prints as an ordinary line.
	 */
	mode: "held" | "live" | "closed";
	/** The held detail, unneutralized, each line already indented for its nesting. */
	readonly lines: Array<string>;
	/** The console the step was opened under, which every line goes out through. */
	readonly console: Console.Console;
	/** Whether the result may open a `::group::`: false when the step opened inside a group, which cannot nest. */
	readonly canFold: boolean;
	/** Whether any step in the run failed, recovered or not: such a run is never folded. */
	failed: boolean;
	/** The runs streaming live right now, shared by every step of one logger: two or more turn the prefix on. */
	readonly streaming: Set<StepRun>;
	/**
	 * The minimum log level outside the step, which the step overrides to `All`: a step opened by a fiber that outlived
	 * this run reads its window from this, not from the override.
	 */
	readonly minimum: LogLevel.LogLevel;
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
export const open = (
	name: string,
	parent: StepFrame | null,
	console: Console.Console,
	canFold: boolean,
	streaming: Set<StepRun>,
	minimum: LogLevel.LogLevel,
): StepFrame =>
	parent === null
		? {
				name,
				run: { name: singleLine(name), mode: "held", lines: [], console, canFold, failed: false, streaming, minimum },
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

/** Text on one line, for a name in a result, opening or prefix. */
const singleLine = (text: string): string => text.replace(/\r\n|\r|\n/g, " ");

/** Write one detail line of a live run: indented under the step, prefixed while another run streams too. */
const writeLive = (run: StepRun, line: string): void => {
	write(run, `  ${run.streaming.size >= 2 ? `[${run.name}]  ` : ""}${line}`);
};

/**
 * Add detail to a step, held or streamed by its run's mode.
 *
 * @remarks
 * Split at every line break first, so each line of a multi-line entry (a git transcript is one) takes the indent.
 * Once the run has closed, a line (a fiber forked inside the step outlived it) is never dropped: it prints as an
 * ordinary log line, unindented and unprefixed.
 */
export const detail = (frame: StepFrame, text: string): void => {
	const run = frame.run;
	for (const part of text.split(LINE_BREAK)) {
		const line = `${indent(frame.depth)}${part}`;
		if (run.mode === "held") {
			run.lines.push(line);
		} else if (run.mode === "live") {
			writeLive(run, line);
		} else {
			write(run, part);
		}
	}
};

/**
 * The line a step writes when it starts streaming: `… <name> is taking longer than <window>, showing live output`, or
 * `… <name>` alone for a step whose window is zero (runner debug, or `window: 0`), which streams from the start.
 */
export const opening = (name: string, window: string | undefined): string =>
	window === undefined
		? `… ${singleLine(name)}`
		: `… ${singleLine(name)} is taking longer than ${window}, showing live output`;

/**
 * Switch a held run to live: write its opening line and everything held so far, after which each detail line streams.
 *
 * @remarks
 * One synchronous block, so no line can land between the flush and the switch. A run that is already live or has
 * closed (the window timer lost the race with the step's end) is left alone.
 */
export const goLive = (run: StepRun, openingLine: string): void => {
	if (run.mode !== "held") {
		return;
	}
	run.mode = "live";
	run.streaming.add(run);
	write(run, openingLine);
	for (const line of run.lines.splice(0)) {
		writeLive(run, line);
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
export const heading = (title: string): string => `\x1b[1m${singleLine(title)}\x1b[22m`;

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
		return `${red("✗")} ${singleLine(frame.name)} · interrupted`;
	}
	const counts = [
		...(frame.warnings > 0 ? [plural(frame.warnings, "warning")] : []),
		...(frame.errors > 0 ? [plural(frame.errors, "error")] : []),
		...(frame.failedSteps > 0 ? [plural(frame.failedSteps, "failed step")] : []),
	];
	const mark = outcome._tag === "Failure" ? red("✗") : counts.length > 0 ? yellow("⚠") : green("✓");
	const text = singleLine(outcome.text);
	return [`${mark} ${text}`, ...counts, dim(formatDuration(millis))].join(" · ");
};

/**
 * End a step and write what it owes the log.
 *
 * @remarks
 * A nested step adds its result line to the enclosing step's detail; when it failed or was interrupted it counts as a
 * failed step against every step around it and marks the run failed, so an outer step that recovers still shows `⚠`
 * and never folds the failure away. A live outermost step has streamed its detail already, so it writes its result
 * line alone, unfolded. A held outermost step writes its held detail: under a folded `::group::` titled by the result
 * line when every step in the run succeeded, or indented beneath an unfolded result line otherwise, or when the step
 * cannot fold. A step with no detail is its result line alone. Either way the run is closed afterwards.
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
	if (run.mode === "live") {
		run.mode = "closed";
		run.streaming.delete(run);
		write(run, line);
		return;
	}
	run.mode = "closed";
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

/** `Console` arguments as one text, the way a log message is rendered. */
const consoleText = (args: ReadonlyArray<unknown>): string =>
	args.map((part) => (typeof part === "string" ? part : Inspectable.toStringUnknown(part, 0))).join(" ");

const GROUP = "::group::";
const END_GROUP = "::endgroup::";

/**
 * Route text written straight to `Console` inside a step: detail, except the workflow commands in it.
 *
 * @remarks
 * Each line is read on its own. A group command becomes a `▸ <title>` header line of the detail and its end is
 * dropped, because a group cannot open inside the step's fold. Every other workflow command (a line starting `::`)
 * goes out at once, unchanged, through the run's console: an `::add-mask::` must reach the runner before the secret
 * appears in any line, and an annotation is never held. A `::warning` or `::error` command counts against the step and
 * every step around it, as a logged warning or error does.
 */
const routeConsole = (frame: StepFrame, args: ReadonlyArray<unknown>): void => {
	for (const line of consoleText(args).split(LINE_BREAK)) {
		const command = line.trimStart();
		if (command.startsWith(GROUP)) {
			detail(frame, `▸ ${command.slice(GROUP.length)}`);
		} else if (command.startsWith(END_GROUP)) {
			// The header above stands in for the group; there is nothing to end.
		} else if (command.startsWith("::")) {
			if (command.startsWith("::warning")) {
				countAnnotation(frame, "warning");
			} else if (command.startsWith("::error")) {
				countAnnotation(frame, "error");
			}
			frame.run.console.log(line);
		} else {
			detail(frame, line);
		}
	}
};

/**
 * The `Console` a step's body runs under: what it writes is the step's detail.
 *
 * @remarks
 * Every writing method (`log`, `info`, `debug`, `trace`, `warn`, `error`, `dirxml`) goes through {@link routeConsole},
 * so `@effected/cli-kit`'s renderers and a raw `Console.log` land in the fold, or stream while the step is live, rather
 * than printing ahead of its `::group::`. The rest (`table`, `dir`, timers, counters, grouping) pass through to the
 * run's console unchanged. The step log's own lines never go through this console: they are written through the run's.
 */
export const capture = (frame: StepFrame): Console.Console => {
	const real = frame.run.console;
	const route = (...args: ReadonlyArray<unknown>): void => routeConsole(frame, args);
	return {
		assert: (condition, ...args) => real.assert(condition, ...args),
		clear: () => real.clear(),
		count: (label) => real.count(label),
		countReset: (label) => real.countReset(label),
		debug: route,
		dir: (item, options) => real.dir(item, options),
		dirxml: route,
		error: route,
		group: (...args) => real.group(...args),
		groupCollapsed: (...args) => real.groupCollapsed(...args),
		groupEnd: () => real.groupEnd(),
		info: route,
		log: route,
		table: (tabularData, properties) => real.table(tabularData, properties),
		time: (label) => real.time(label),
		timeEnd: (label) => real.timeEnd(label),
		timeLog: (label, ...args) => real.timeLog(label, ...args),
		trace: route,
		warn: route,
	};
};
