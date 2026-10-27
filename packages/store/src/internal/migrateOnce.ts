import { Cause, Effect, Exit, Option } from "effect";

// The process-wide registry behind `Store.migrateOnce`. Facade-free like
// `migrator.ts`: the facade hands in the work to run, so this module never
// imports `Store.ts`.

/**
 * How a shared run ended.
 *
 * CROSS-VERSION CONTRACT — do not change without a new registry symbol.
 *
 * The registry lives on `globalThis` under an unversioned `Symbol.for` key, on
 * purpose: two copies of this package in one process (a bundled reporter
 * beside a CLI, possibly different versions on different Effect instances)
 * must share it. Every copy that ever shipped therefore reads and writes the
 * same three things, and they are frozen:
 *
 * - the registry: a `Map<string, Promise<Outcome>>` at
 *   `globalThis[Symbol.for("@effected/store/migrateOnce")]`;
 * - the key: `<realpath of the file's directory>/<basename>`, a NUL, then the
 *   JSON fingerprint `{"migrations":[[id,name],…],"adopt":…,"mirror":…}`
 *   (see {@link registryKey} and `Store.migrateOnce`);
 * - the value: a `Promise` that never rejects, resolving to a plain object
 *   whose `_tag` is one of the four below. No Effect value (`Exit`, `Cause`,
 *   `Deferred`, `Fiber`) is ever stored: those are Effect-instance internals,
 *   and another copy cannot trust them. The `error` / `defect` payloads are
 *   whatever the run failed with — a `StoreError` instance of the copy that
 *   ran it — so a waiter in another copy sees an object that fails its own
 *   `instanceof StoreError` while `_tag`-based handling (`catchTag`) still
 *   matches. A waiter in the copy that ran replays the run's full `Cause`
 *   instead, from {@link localCauses}, which is per copy and never shared.
 *
 * A change to any of the three needs a new symbol, so an old and a new copy
 * stop sharing rather than misreading each other.
 */
type Outcome =
	| { readonly _tag: "Success" }
	| { readonly _tag: "Failure"; readonly error: unknown }
	| { readonly _tag: "Defect"; readonly defect: unknown }
	| { readonly _tag: "Interrupted" };

type Registry = Map<string, Promise<Outcome>>;

const REGISTRY = Symbol.for("@effected/store/migrateOnce");

const registry = (): Registry => {
	const holder = globalThis as { [REGISTRY]?: Registry };
	holder[REGISTRY] ??= new Map();
	return holder[REGISTRY];
};

/**
 * The full `Cause` behind each failed {@link Outcome} this copy produced,
 * keyed by the outcome object itself. Module-local, so it never crosses
 * copies and the shared shape stays plain: a waiter in this copy replays the
 * run's own cause (every defect, every error, their spans), while a waiter in
 * another copy finds nothing here and rebuilds from the plain outcome.
 */
const localCauses = new WeakMap<Outcome, Cause.Cause<unknown>>();

/**
 * A filename that names no shared file: `:memory:` and `""` are a fresh
 * database per connection, and a `file:` URI is not a path to resolve.
 */
export const isEphemeralFilename = (filename: string): boolean =>
	filename === "" || filename === ":memory:" || filename.startsWith("file:");

/** The registry key: the resolved file, then a separator no path contains, then the run's fingerprint. */
export const registryKey = (resolvedFile: string, fingerprint: string): string => `${resolvedFile}\u0000${fingerprint}`;

const outcomeOf = <E>(cause: Cause.Cause<E>): Outcome => {
	if (Cause.hasInterruptsOnly(cause)) return { _tag: "Interrupted" };
	const error = Cause.findErrorOption(cause);
	return Option.isSome(error)
		? { _tag: "Failure", error: error.value }
		: { _tag: "Defect", defect: Cause.squash(cause) };
};

const awaitOutcome = <E>(outcome: Promise<Outcome>): Effect.Effect<void, E> =>
	Effect.flatMap(
		Effect.promise(() => outcome),
		(settled): Effect.Effect<void, E> => {
			const cause = settled._tag === "Interrupted" ? undefined : localCauses.get(settled);
			if (cause !== undefined) return Effect.failCause(cause as Cause.Cause<E>);
			switch (settled._tag) {
				case "Success":
					return Effect.void;
				case "Failure":
					return Effect.fail(settled.error as E);
				case "Defect":
					return Effect.die(settled.defect);
				case "Interrupted":
					return Effect.interrupt;
			}
		},
	);

/**
 * Run `work` at most once per `key` in this process; concurrent callers share
 * the one in-flight run.
 *
 * The first caller registers the run and executes `work` on a detached fiber,
 * so interrupting any one caller (the first included) stops only its wait,
 * never the shared run. A success stays registered. A failure, defect or
 * interruption removes the entry **before** the waiters are released, so the
 * waiters see that failure and the next caller starts a fresh run — a
 * transient error never poisons the process.
 *
 * The lookup and the registration happen in one synchronous step, so two
 * fibers cannot both become the runner. Registration and the fork are one
 * **uninterruptible** region, and only the wait is restored to
 * interruptibility: interrupted between the two, a caller would leave a
 * registered promise no fiber will ever settle, and every later caller for the
 * key would wait forever.
 */
export const runOnce = <E>(key: string, work: Effect.Effect<void, E>): Effect.Effect<void, E> =>
	Effect.uninterruptibleMask((restore) =>
		Effect.suspend(() => {
			const runs = registry();
			const existing = runs.get(key);
			if (existing !== undefined) return restore(awaitOutcome<E>(existing));
			let settle: (outcome: Outcome) => void = () => {};
			const pending = new Promise<Outcome>((resolve) => {
				settle = resolve;
			});
			runs.set(key, pending);
			// `onExit` rather than `exit` + `flatMap`: the finalizer runs even when the
			// detached fiber itself is interrupted (runtime shutdown), so a waiter is
			// never left on a promise that cannot settle. The fork's default
			// (`uninterruptible: false`) makes the run interruptible again, so the
			// mask covers only the registration and the fork itself.
			const runner = Effect.onExit(work, (exit) =>
				Effect.sync(() => {
					if (Exit.isSuccess(exit)) {
						settle({ _tag: "Success" });
						return;
					}
					// Delete first: a released waiter that calls again must start a
					// fresh run, never join this failed one.
					runs.delete(key);
					const outcome = outcomeOf(exit.cause);
					if (outcome._tag !== "Interrupted") localCauses.set(outcome, exit.cause);
					settle(outcome);
				}),
			);
			return Effect.andThen(Effect.forkDetach(runner), restore(awaitOutcome<E>(pending)));
		}),
	);
