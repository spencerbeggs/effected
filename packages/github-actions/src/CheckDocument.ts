import { Clock, Context, Duration, Effect, Latch, Layer, Ref, Schema, Semaphore } from "effect";
import { CheckState } from "./CheckState.js";
import { ManagedDocument } from "./ManagedDocument.js";

/**
 * What a run knows about one of its checks: the authoritative state, and the
 * presentation facts a renderer projects into the document.
 *
 * @remarks
 * Only `state` is required. The rest exist because a status table needs them:
 * `title` when the display name differs from the registry key, `outcome` for
 * the one-line verdict cell, `url` for linking the check's name, and `detail`
 * for the per-check block a body region carries. A later report for the same
 * key **replaces** the whole entry — last write wins, per field and per check.
 *
 * @public
 */
export class CheckReport extends Schema.Class<CheckReport>("CheckReport")({
	/** Where the check is now. The last reported state is the authoritative one. */
	state: CheckState,
	/** Display name, when it differs from the registry key. */
	title: Schema.optionalKey(Schema.String),
	/** A one-line verdict, e.g. `in progress...` or `3 packages ready`. */
	outcome: Schema.optionalKey(Schema.String),
	/** A pre-rendered markdown block of per-check detail. */
	detail: Schema.optionalKey(Schema.String),
	/** Where the check's name should link. */
	url: Schema.optionalKey(Schema.String),
}) {}

/**
 * Raised when the check document cannot be regenerated or written.
 *
 * @remarks
 * `render` — projecting the registry onto the document failed, almost always
 * because a reported `detail` contains a line the region scanner would read
 * as a marker; the underlying `ManagedDocumentError` rides in `cause`.
 * `sink` — the consumer's write effect failed; its error rides in `cause`.
 * Callers of `flush` branch on `kind`; the background reconciler never fails
 * a fiber with this — it logs and retries on the next report.
 *
 * @public
 */
export class CheckDocumentError extends Schema.TaggedError<CheckDocumentError>()("CheckDocumentError", {
	/** Which half failed: regenerating the document, or writing it. */
	kind: Schema.Literals(["render", "sink"]),
	/** The underlying failure. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		return this.kind === "render"
			? "The check document could not be regenerated from the reported state"
			: "Writing the check document failed";
	}
}

/**
 * How a rendered document leaves the process: the narrow sink contract.
 *
 * @remarks
 * One rendered document in, one write effect out — nothing else. That is
 * what lets the sticky PR comment (`PullRequestComment.upsert`), the PR
 * description (`PATCH` on the pull request) and a test's recording `Ref` all
 * fit the same reconciler. The success value is ignored; a failure surfaces
 * as {@link CheckDocumentError} with `kind: "sink"`. Provide any services the
 * write needs when constructing the sink — the reconciler runs it as given.
 *
 * @public
 */
export type CheckDocumentSink = (rendered: string) => Effect.Effect<unknown, unknown>;

/**
 * Options for {@link CheckDocument.layer}.
 *
 * @public
 */
export interface CheckDocumentOptions {
	/** The managed document's namespace, e.g. your action's name. */
	readonly namespace: string;
	/** Which document, within that namespace. */
	readonly key: string;
	/**
	 * The document text to reconcile against initially — a PR body fetched
	 * once at startup, so human content outside the managed regions survives.
	 * Defaults to empty: a fresh document.
	 */
	readonly initial?: string | undefined;
	/**
	 * The pure projection from registry state to region entries.
	 *
	 * @remarks
	 * Called with the full snapshot on every reconcile pass; returns the
	 * regions to replace, keyed however the consumer's document is laid out —
	 * typically one region per check plus a shared status table. It must be a
	 * pure function of the snapshot: rendering the same state twice must
	 * produce the same entries, because byte-identical output is what
	 * suppresses the write.
	 */
	readonly render: (checks: ReadonlyMap<string, CheckReport>) => ReadonlyArray<readonly [key: string, content: string]>;
	/** Where the rendered document goes. */
	readonly sink: CheckDocumentSink;
	/**
	 * Debounce parameters: `quiet` is the trailing settle window, `maxWait`
	 * the staleness bound under a steady stream of reports. Defaults: 500
	 * milliseconds and 3 seconds.
	 */
	readonly debounce?:
		| { readonly quiet?: Duration.Input | undefined; readonly maxWait?: Duration.Input | undefined }
		| undefined;
	/**
	 * How long one sink write may run before the pass fails with
	 * `kind: "sink"`. Default: 30 seconds.
	 *
	 * @remarks
	 * The reconciler serializes passes behind one permit, and the finalizer's
	 * last flush waits on that same permit — so a sink that never resolves
	 * would otherwise stall every later pass AND scope teardown. The bound
	 * turns a hung write into the ordinary sink failure path: a background
	 * pass logs and retries on the next report, `flush` surfaces the typed
	 * error.
	 */
	readonly sinkTimeout?: Duration.Input | undefined;
}

/**
 * The check-run → document reconciler's surface.
 *
 * @public
 */
export interface CheckDocumentShape {
	/**
	 * Record a check's current state and schedule a reconcile.
	 *
	 * @remarks
	 * Never fails and never blocks on the write — the state lands in the
	 * registry, and the debounced background pass projects it. Reporting the
	 * same key again replaces the entry; resolution is **not** terminal, so
	 * `pass` followed by `fail` leaves `fail` even inside one debounce window.
	 */
	readonly report: (check: string, report: CheckReport) => Effect.Effect<void>;
	/** The registry as of now, in first-report order. */
	readonly checks: Effect.Effect<ReadonlyMap<string, CheckReport>>;
	/**
	 * Reconcile immediately, skipping the debounce.
	 *
	 * @remarks
	 * Rendering unchanged state issues no write. Call it at the end of a run;
	 * the layer's finalizer also runs it, so the last burst of reports lands
	 * even when the scope closes inside the quiet window.
	 */
	readonly flush: Effect.Effect<void, CheckDocumentError>;
}

/**
 * A living document of check state: an in-process registry the run reports
 * into, debounced onto a marker-delimited document, written through a narrow
 * sink.
 *
 * @remarks
 * **Push, not pull.** The run owns its checks and knows when they resolve;
 * nothing here polls GitHub. Consumers call `report` as states change, and a
 * background fiber projects the registry onto a {@link ManagedDocument} —
 * regions replaced from current state, so a check that resolves many times
 * updates its region in place instead of appending.
 *
 * The debounce is **trailing with a max-wait, never leading**: a burst of
 * reports coalesces into one write carrying the *final* state, and a steady
 * stream still surfaces progress every `maxWait`. A pass that renders
 * byte-identical text issues no write at all.
 *
 * `layer` mints fresh state per call — one layer per document. Bind it to a
 * `const` if two parts of a program must share one registry.
 *
 * @example
 * ```ts
 * import { CheckDocument, CheckReport, GitHubMarkdown } from "@effected/github-actions";
 * import { Effect } from "effect";
 *
 * const layer = CheckDocument.layer({
 *   namespace: "my-action",
 *   key: "release-validation",
 *   render: (checks) => [
 *     [
 *       "header",
 *       GitHubMarkdown.table(
 *         ["Check", "Outcome"],
 *         [...checks].map(([key, check]) => [key, check.outcome ?? check.state]),
 *       ),
 *     ],
 *   ],
 *   sink: (rendered) => Effect.log(rendered),
 * });
 *
 * const program = Effect.gen(function* () {
 *   const doc = yield* CheckDocument;
 *   yield* doc.report("build", CheckReport.make({ state: "running" }));
 *   yield* doc.report("build", CheckReport.make({ state: "pass", outcome: "clean" }));
 *   yield* doc.flush;
 * });
 * ```
 *
 * @public
 */
export class CheckDocument extends Context.Service<CheckDocument, CheckDocumentShape>()(
	"@effected/github-actions/CheckDocument",
) {
	/**
	 * The reconciler over one document.
	 *
	 * @remarks
	 * Forks the debounce fiber into the layer's scope and registers a
	 * finalizer that flushes once more on the way out, so the scope closing
	 * mid-window cannot strand the final state. A background pass that fails
	 * logs a structured warning and leaves the registry intact — the next
	 * report retries it; only `flush` surfaces the typed error.
	 */
	static layer(options: CheckDocumentOptions): Layer.Layer<CheckDocument> {
		return Layer.effect(
			CheckDocument,
			Effect.gen(function* () {
				const quietMillis = Duration.toMillis(options.debounce?.quiet ?? "500 millis");
				const maxWaitMillis = Math.max(Duration.toMillis(options.debounce?.maxWait ?? "3 seconds"), quietMillis);
				const checksRef = yield* Ref.make<ReadonlyMap<string, CheckReport>>(new Map());
				const writtenRef = yield* Ref.make(options.initial ?? "");
				const versionRef = yield* Ref.make(0);
				const signal = yield* Latch.make(false);
				const gate = yield* Semaphore.make(1);

				const reconcile = Effect.fn("CheckDocument.reconcile")(function* () {
					const checks = yield* Ref.get(checksRef);
					const current = yield* Ref.get(writtenRef);
					const document = yield* ManagedDocument.parse({
						namespace: options.namespace,
						key: options.key,
						text: current,
					}).pipe(Effect.mapError((cause) => new CheckDocumentError({ kind: "render", cause })));
					const next = yield* document
						.withRegions(options.render(checks))
						.pipe(Effect.mapError((cause) => new CheckDocumentError({ kind: "render", cause })));
					if (next.text === current) {
						return;
					}
					// The timeout is load-bearing, not defensive: this pass holds the
					// single permit, and the finalizer's last flush waits on it — an
					// unbounded hung sink would stall reconciling AND scope teardown.
					yield* options.sink(next.text).pipe(
						Effect.timeout(options.sinkTimeout ?? "30 seconds"),
						Effect.mapError((cause) => new CheckDocumentError({ kind: "sink", cause })),
					);
					yield* Ref.set(writtenRef, next.text);
				});

				// One pass at a time: the debounce fiber and a manual `flush` must
				// not interleave their read-render-compare-write sequences.
				const flush = gate.withPermits(1)(reconcile());

				// Trailing debounce with a max-wait. The latch wakes the fiber on
				// the first report of a burst; the poll loop then waits for a quiet
				// window (no version movement for `quiet`) or the staleness bound,
				// whichever comes first — so the write always carries the burst's
				// FINAL state, never its first.
				const daemon = Effect.gen(function* () {
					while (true) {
						yield* signal.await;
						yield* signal.close;
						const start = yield* Clock.currentTimeMillis;
						let settled = false;
						while (!settled) {
							const before = yield* Ref.get(versionRef);
							yield* Effect.sleep(quietMillis);
							const after = yield* Ref.get(versionRef);
							const now = yield* Clock.currentTimeMillis;
							settled = after === before || now - start >= maxWaitMillis;
						}
						yield* flush.pipe(
							Effect.catch((failure) =>
								Effect.logWarning("CheckDocument reconcile failed; retrying on the next report", {
									kind: failure.kind,
								}),
							),
						);
					}
				});

				// Registered BEFORE the fork so it runs AFTER the fork's own
				// interruption finalizer: the daemon is already dead when the last
				// flush runs, so the two cannot race for the sink.
				yield* Effect.addFinalizer(() =>
					flush.pipe(
						Effect.catch((failure) => Effect.logWarning("CheckDocument final flush failed", { kind: failure.kind })),
					),
				);
				yield* Effect.forkScoped(daemon);

				const report = Effect.fn("CheckDocument.report")(function* (check: string, entry: CheckReport) {
					yield* Ref.update(checksRef, (current) => {
						const next = new Map(current);
						next.set(check, entry);
						return next;
					});
					yield* Ref.update(versionRef, (count) => count + 1);
					yield* signal.open;
				});

				return { report, checks: Ref.get(checksRef), flush } satisfies CheckDocumentShape;
			}),
		);
	}

	/** An inert double; unstubbed members die naming themselves. */
	static readonly makeTest = (overrides: Partial<CheckDocumentShape> = {}): CheckDocumentShape => ({
		report: overrides.report ?? (() => Effect.sync(() => unstubbed("report"))),
		checks: overrides.checks ?? Effect.sync(() => unstubbed("checks")),
		flush: overrides.flush ?? Effect.sync(() => unstubbed("flush")),
	});

	/** {@link CheckDocument.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<CheckDocumentShape> = {}): Layer.Layer<CheckDocument> =>
		Layer.succeed(CheckDocument, CheckDocument.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`CheckDocument.makeTest: ${member}() was called but not stubbed — pass an override.`);
};
