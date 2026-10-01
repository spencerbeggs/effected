import type { AudienceShape } from "@effected/env";
import { Audience, TerminalEnv } from "@effected/env";
import type { Cause } from "effect";
import { Context, Effect, MutableRef, Option } from "effect";
import { CliFailure } from "../CliFailure.js";
import { CliLinks } from "../CliLinks.js";
import { CliTheme } from "../CliTheme.js";
import { Glyphs } from "../Glyphs.js";
import type { RenderContext } from "../Render.js";
import { Render } from "../Render.js";
import { autoFormat } from "./autoFormat.js";

/**
 * Where a failure report is written to: the context the renderer lays out for, and which renderer.
 *
 * @internal
 */
export interface FailureTarget {
	readonly ctx: RenderContext;
	readonly format: "plain" | "ansi" | "githubLog";
}

/**
 * A cell `CliRuntime.main` provides outside failure reporting and fills from inside it.
 *
 * @remarks
 * `reportFailures` catches OUTSIDE the layers `main` provides, so the theme, terminal, audience and links a report is
 * rendered with are not in its context when a failure arrives. The environment layer writes the target here as it is
 * built, and an audience flag rewrites it once the flag is read. A `Reference` defaulting to `undefined`, so a
 * program run without `main` finds no cell and falls back, and no state is shared between runs.
 *
 * @internal
 */
export const FailureTargetCell = Context.Reference<MutableRef.MutableRef<FailureTarget | undefined> | undefined>(
	"@effected/cli/FailureTargetCell",
	{ defaultValue: () => undefined },
);

/** What a report is rendered with when nothing is known about the terminal: plain text, no limit, no escapes. */
export const fallbackTarget: FailureTarget = {
	ctx: {
		width: Number.POSITIVE_INFINITY,
		audience: "agent",
		color: "none",
		paint: (_token, text) => text,
		glyphs: Glyphs.ascii,
		link: (_target, label) => label,
		displayPath: (absolute) => absolute,
		// Nothing is known about the runner here, so the report refuses to emit a workflow command: a zero-width space
		// in front of a line that starts with `::` or `##` costs nothing anywhere else.
		neutralizeWorkflowCommands: true,
	},
	format: "plain",
};

/**
 * The target for the services in the current context, or `undefined` when it lacks any of the four.
 *
 * @remarks
 * Each is read with `serviceOption`, so this never adds a requirement. `audience` overrides the one in context: an
 * audience flag is provided deeper than the environment layer, where the report cannot see it.
 */
const build = (
	audience?: AudienceShape,
	displayPath?: (absolute: string) => string,
): Effect.Effect<FailureTarget | undefined> =>
	Effect.gen(function* () {
		const theme = yield* Effect.serviceOption(CliTheme);
		const terminal = yield* Effect.serviceOption(TerminalEnv);
		const current = yield* Effect.serviceOption(Audience);
		const links = yield* Effect.serviceOption(CliLinks);
		if (Option.isNone(theme) || Option.isNone(terminal) || Option.isNone(links)) return undefined;
		const shape = audience ?? (Option.isSome(current) ? current.value : undefined);
		if (shape === undefined) return undefined;
		const ctx = yield* Render.context("stderr", displayPath === undefined ? undefined : { displayPath }).pipe(
			Effect.provideService(CliTheme, theme.value),
			Effect.provideService(TerminalEnv, terminal.value),
			Effect.provideService(CliLinks, links.value),
			Effect.provideService(Audience, shape),
		);
		return { ctx, format: yield* autoFormat(ctx.audience) };
	});

/**
 * Record the target for the services in context in the cell, if there is one. A no-op without a cell or services.
 *
 * @internal
 */
export const refreshFailureTarget = (
	audience?: AudienceShape,
	displayPath?: (absolute: string) => string,
): Effect.Effect<void> =>
	Effect.gen(function* () {
		const cell = yield* FailureTargetCell;
		if (cell === undefined) return;
		// A rewrite for an audience flag keeps the path display the environment layer recorded.
		const recorded = MutableRef.get(cell);
		const target = yield* build(audience, displayPath ?? recorded?.ctx.displayPath);
		if (target !== undefined) MutableRef.set(cell, target);
	});

/** The target a report is rendered with: the cell, else the services in context, else the plain fallback. */
const currentTarget: Effect.Effect<FailureTarget> = Effect.gen(function* () {
	const cell = yield* FailureTargetCell;
	const recorded = cell === undefined ? undefined : MutableRef.get(cell);
	if (recorded !== undefined) return recorded;
	return (yield* build()) ?? fallbackTarget;
});

const linesOf = (cause: Cause.Cause<unknown>, target: FailureTarget): ReadonlyArray<string> => {
	const doc = CliFailure.toDoc(cause, { displayPath: target.ctx.displayPath });
	const text = Render[target.format](doc, target.ctx);
	return text === "" ? [] : text.split("\n");
};

/**
 * The lines of a failure report for the current environment.
 *
 * @internal
 */
export const failureLines = (cause: Cause.Cause<unknown>): Effect.Effect<ReadonlyArray<string>> =>
	Effect.flatMap(currentTarget, (target) => Effect.sync(() => linesOf(cause, target)));

/**
 * The plain lines of a failure, for a caller with no services: what `CliRuntime.defaultRender` returns.
 *
 * @internal
 */
export const plainFailureLines = (cause: Cause.Cause<unknown>): ReadonlyArray<string> => linesOf(cause, fallbackTarget);
