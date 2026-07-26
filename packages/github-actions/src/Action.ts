import { NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Layer, Option, Result } from "effect";
import type { HttpClient } from "effect/unstable/http";
import { FetchHttpClient } from "effect/unstable/http";
import { ActionEnvironment } from "./ActionEnvironment.js";
import { ActionInput } from "./ActionInput.js";
import { ActionLogger } from "./ActionLogger.js";
import { ActionOutputs } from "./ActionOutputs.js";
import { ActionState } from "./ActionState.js";
import { WorkflowCommand } from "./WorkflowCommand.js";

/**
 * Everything {@link ActionRuntime.layer} provides.
 *
 * @remarks
 * Spelled out rather than inferred so a caller can name it — a program written
 * against `ActionServices` is a program `Action.run` can run, and the compiler
 * says so before the runner does.
 *
 * @public
 */
export type ActionServices =
	| ActionEnvironment
	| ActionLogger
	| ActionOutputs
	| ActionState
	| NodeServices.NodeServices
	| HttpClient.HttpClient;

/**
 * The default runtime an action executes inside.
 *
 * @remarks
 * The one place in the kit where `@effect/platform-node` is composed rather
 * than left to the consumer, and the reason is that there is no second answer:
 * a GitHub Action is a Node process on a GitHub-provided runner.
 *
 * **The cache, artifact and blob services are deliberately NOT in here.** They
 * are the only modules that import `@azure/storage-blob`, and folding them into
 * the default runtime would put a blob-storage client in the bundle of every
 * action that merely sets an output. Their requirements are all satisfied by
 * this layer, so taking one costs a caller exactly one line:
 * `Action.run(program, { layer: ActionCache.layer })`.
 *
 * @public
 */
export class ActionRuntime {
	private constructor() {}

	/**
	 * The composed default: the runner services, the platform, an HTTP client
	 * and the workflow-command `Logger`.
	 *
	 * @remarks
	 * A bound constant rather than a factory. A layer-returning function mints a
	 * fresh layer per call, and layers memoize by reference — a factory here
	 * would rebuild the environment snapshot for every composition site.
	 */
	static readonly layer: Layer.Layer<ActionServices> = Layer.mergeAll(
		ActionLogger.layer,
		// The named constant, not a second spelling of it: two `Logger.layer([...])`
		// values with the same contents are different layers and memoize separately.
		ActionLogger.layerLogger,
		ActionState.layer,
		// The inputs-first config provider, NOT the record-backed test double
		// (`ActionInput.layer()`, which replaces the environment lookup wholesale
		// and stays exported for resolving inputs from an explicit record in a
		// test). This one changes bare `Config` reads only: a flat name tries the
		// runner's INPUT_ derivation first and then falls back to the ambient
		// lookup unchanged. It is here because a live action shipped a false
		// green — every bare read fell back to its `withDefault` because the
		// runner publishes INPUT_<MANGLED> and a plain-named lookup finds
		// nothing. A caller-supplied provider in the `layer` option still wins:
		// the extra layer's context merges last in `Action.run`'s composition.
		ActionInput.layerDefault,
	).pipe(
		// `provideMerge` rather than a flat `mergeAll`, and the difference is the
		// whole wiring: `ActionState` needs `ActionOutputs` (it masks before it
		// persists) and `ActionOutputs` needs `ActionEnvironment`. Merged as
		// siblings they would not see each other, and the layer would not build.
		Layer.provideMerge(ActionOutputs.layer),
		Layer.provideMerge(ActionEnvironment.layer),
		Layer.provideMerge(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
	);
}

/**
 * How to run an action.
 *
 * @public
 */
export interface ActionRunOptions<R> {
	/**
	 * Services the program needs beyond {@link ActionServices}.
	 *
	 * @remarks
	 * It may require anything {@link ActionRuntime.layer} provides — which is
	 * what makes `{ layer: ActionCache.layer }` compile with no further wiring.
	 */
	readonly layer?: Layer.Layer<R, never, ActionServices> | undefined;
}

/**
 * A readable one-line summary of why an action failed.
 *
 * @remarks
 * `[Tag] message` because a workflow log is read by a human scanning for the
 * first red line, and every error in this kit carries both. The `_tag` is what
 * makes two failures with the same wording distinguishable, and the `message`
 * getter is what makes the line worth reading.
 *
 * An interruption has neither, and `Cause.pretty` is the honest answer for it.
 *
 * @public
 */
export const describeCause = (cause: Cause.Cause<unknown>): string => {
	const failure = Cause.findErrorOption(cause);
	if (Option.isSome(failure)) {
		return describeError(failure.value);
	}
	const defect = Cause.findDefect(cause);
	if (Result.isSuccess(defect)) {
		return `[defect] ${describeError(defect.success)}`;
	}
	const pretty = Cause.pretty(cause);
	return pretty.trim() === "" ? "the action failed with no diagnostic information" : pretty;
};

/** The `[Tag]: message` half, over anything a failure or a defect can be. */
const describeError = (error: unknown): string => {
	if (typeof error === "object" && error !== null && "_tag" in error) {
		const tagged = error as { readonly _tag: unknown; readonly message?: unknown };
		const detail = typeof tagged.message === "string" && tagged.message !== "" ? `: ${tagged.message}` : "";
		return `[${String(tagged._tag)}]${detail}`;
	}
	return error instanceof Error ? `[${error.name}]: ${error.message}` : `[unknown]: ${String(error)}`;
};

/**
 * The entry point an action's `main`, `pre` and `post` scripts call.
 *
 * @remarks
 * Everything an action entry point does that is not the action: compose the
 * runtime, run the program, render a failure as a `::error::` annotation, and
 * **set the exit code** — which is the piece
 * `ActionOutputs.setFailed` deliberately leaves alone, so an action that
 * reports a failure and then recovers is not doomed by a side effect it cannot
 * undo.
 *
 * Two things it deliberately does **not** do:
 *
 * - **It does not wrap the program in a log buffer.** The package this replaces
 *   did, and an unhandled defect inside the buffer swallowed the entire
 *   transcript — the run failed and printed nothing. `ActionLogger.withBuffer`
 *   is opt-in and flushes on every exit path including a defect, so the
 *   buffering is where the caller can see it.
 * - **It does not throw.** The returned promise always resolves; the failure is
 *   in `process.exitCode`, which is what the runner reads. An action entry
 *   point that rejected would produce an unhandled rejection *and* a failed
 *   step, and only the first would be legible.
 *
 * The rendering depth is deliberate too: one `::error::` line carrying
 * `[Tag]: message`, and the fiddly diagnostics — the full `Cause.pretty` render
 * with its span trace and stack — behind `::debug::`, which the runner shows
 * only when someone turns step debugging on. The package this replaces spliced
 * a JS stack into the visible error, which in a bundled action points at one
 * line of `dist/main.js`.
 *
 * @example
 * ```ts
 * import { Action, ActionCache } from "@effected/github-actions";
 *
 * await Action.run(program, { layer: ActionCache.layer });
 * ```
 *
 * @public
 */
export class Action {
	private constructor() {}

	/** {@link describeCause}, so an action can render its own failures the same way. */
	static readonly describeCause = describeCause;

	/**
	 * Run an action program to completion.
	 *
	 * @remarks
	 * Resolves whether the program succeeded or not; read `process.exitCode` for
	 * the verdict.
	 */
	static readonly run = <E, R = never>(
		program: Effect.Effect<void, E, ActionServices | R>,
		options: ActionRunOptions<R> = {},
	): Promise<void> => {
		const extra = options.layer;
		const composed =
			extra === undefined
				? ActionRuntime.layer
				: // Both halves name the same layer value, so the build memoizes it and
					// the environment snapshot is taken once rather than twice.
					Layer.mergeAll(ActionRuntime.layer, Layer.provide(extra, ActionRuntime.layer));

		const runnable = (program as Effect.Effect<void, E, ActionServices | R>).pipe(
			Effect.provide(composed as Layer.Layer<ActionServices | R>),
			Effect.exit,
			Effect.flatMap((exit) =>
				Exit.isSuccess(exit)
					? Effect.void
					: Effect.sync(() => {
							// Written with the workflow-command renderer rather than through
							// the `Logger`, because this runs after the program — and after
							// whatever went wrong with it.
							const detail = Cause.pretty(exit.cause);
							if (detail.trim() !== "") {
								console.log(WorkflowCommand.render("debug", {}, detail));
							}
							console.log(WorkflowCommand.render("error", {}, `Action failed: ${describeCause(exit.cause)}`));
							process.exitCode = 1;
						}),
			),
		);

		return Effect.runPromise(runnable).catch(() => {
			// The last resort. If rendering the failure itself failed, the step must
			// still fail: a green step for a crashed action is the worst outcome
			// available here.
			process.exitCode = 1;
		});
	};
}
