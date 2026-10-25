import { Cache, Context, Duration, Effect, Exit, Layer, Option, Result, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { Evidence, Probe } from "./internal/toolResolution.js";
import {
	ABSENT,
	decideResolution,
	isPositive,
	isRefusedName,
	probeArgs,
	probeFromRun,
} from "./internal/toolResolution.js";
import type { LocalExecError } from "./LocalExec.js";
import { ExecContext, LocalExec } from "./LocalExec.js";
import { Run } from "./Run.js";
import type { Tool } from "./Tool.js";
import { VersionProbe } from "./Tool.js";

/** How many tools' probe evidence to remember. */
const CACHE_CAPACITY = 256;

/**
 * Where a tool was resolved from.
 *
 * @public
 */
export const ResolvedSource = Schema.Literals(["global", "local"]);

/**
 * The decoded type of {@link (ResolvedSource:variable)}.
 *
 * @public
 */
export type ResolvedSource = typeof ResolvedSource.Type;

/**
 * A tool that was found, with everything discovery learned about it.
 *
 * @public
 */
export class ResolvedTool extends Schema.Class<ResolvedTool>("ResolvedTool")({
	/** The executable name. */
	name: Schema.String,
	/** Which copy this resolution selected. */
	source: ResolvedSource,
	/** The selected copy's version, when one could be read. */
	version: Schema.Option(Schema.String),
	/** The global copy's version, when it exists and reports one. */
	globalVersion: Schema.Option(Schema.String),
	/** The project-local copy's version, when it exists and reports one. */
	localVersion: Schema.Option(Schema.String),
	/** Whether the two copies reported different versions. */
	mismatch: Schema.Boolean,
	/** The project-local execution context, when {@link ResolvedTool.source} is `"local"`. */
	context: Schema.optionalKey(ExecContext),
}) {
	/**
	 * A core `Command` that runs this tool — bare for a global resolution,
	 * launcher-prefixed and directory-scoped for a local one.
	 *
	 * @remarks
	 * Returns core's own `ChildProcess.Command`, not a wrapper: hand it to
	 * {@link Run} or to core's spawner directly, and compose it with core's
	 * combinators.
	 *
	 * @example
	 * ```ts
	 * const biome = yield* discovery.resolve(Tool.named("biome"));
	 * yield* Run.text(biome.command("check", "."));
	 * ```
	 */
	command(...args: ReadonlyArray<string>): ChildProcess.Command {
		const bare = ChildProcess.make(this.name, args);
		return this.source === "local" && this.context !== undefined ? this.context.apply(bare) : bare;
	}

	/**
	 * The argv that runs this tool, as plain strings — bare for a global
	 * resolution, launcher-prefixed for a local one.
	 *
	 * @remarks
	 * For a caller that hands a command line to another runner rather than
	 * spawning it here: a lint-staged task, a generated script. The launcher's
	 * working directory is NOT in the argv — a local resolution's
	 * `context.directory` says where it must run, and a runner that starts
	 * elsewhere must honour it. Prefer {@link ResolvedTool.command} whenever
	 * this package or core's spawner runs the process.
	 *
	 * @example
	 * ```ts
	 * resolved.argv("check", "--write").join(" "); // "pnpm exec biome check --write"
	 * ```
	 */
	argv(...args: ReadonlyArray<string>): ReadonlyArray<string> {
		const prefix = this.source === "local" && this.context !== undefined ? this.context.prefix : [];
		return [...prefix, this.name, ...args];
	}
}

/**
 * A tool could not be found where it was required.
 *
 * @public
 */
export class ToolNotFoundError extends Schema.TaggedError<ToolNotFoundError>()("ToolNotFoundError", {
	/** The tool that was looked for. */
	tool: Schema.String,
	/** The locations its `source` requirement demanded. */
	searched: Schema.Array(ResolvedSource),
}) {
	override get message(): string {
		return `Tool not found: ${this.tool} (required ${this.searched.join(" and ")})`;
	}
}

/**
 * The global and project-local copies disagree, and the tool's policy is
 * `"fail"`.
 *
 * @public
 */
export class ToolVersionMismatchError extends Schema.TaggedError<ToolVersionMismatchError>()(
	"ToolVersionMismatchError",
	{
		/** The tool. */
		tool: Schema.String,
		/** The global copy's version. */
		globalVersion: Schema.String,
		/** The project-local copy's version. */
		localVersion: Schema.String,
	},
) {
	override get message(): string {
		return `Version mismatch for ${this.tool}: global ${this.globalVersion} vs local ${this.localVersion}`;
	}
}

/**
 * A tool name that cannot safely be spawned was refused before any process
 * started.
 *
 * @remarks
 * An empty name, or one beginning with `-`, which the operating system would
 * read as a flag rather than an executable. The refusal happens **pre-spawn**,
 * which is the point: `Tool.named("-rf")` never reaches a shell, and this
 * package never builds a shell command line in the first place.
 *
 * @public
 */
export class ToolRefusedError extends Schema.TaggedError<ToolRefusedError>()("ToolRefusedError", {
	/** The refused name. */
	tool: Schema.String,
}) {
	override get message(): string {
		return this.tool === ""
			? "Refused an empty tool name"
			: `Refused the tool name "${this.tool}": a leading "-" would be read as a flag`;
	}
}

/**
 * Every way `ToolDiscovery.resolve` can fail.
 *
 * @public
 */
export type ToolResolutionFailure = ToolNotFoundError | ToolVersionMismatchError | ToolRefusedError | LocalExecError;

/**
 * The cache key: everything the probe outcome depends on, and nothing else.
 *
 * @remarks
 * A `Schema.Class` rather than a string because the cache's `MutableHashMap`
 * keys on `Equal`/`Hash`, which schema classes implement structurally — so the
 * key can carry the probe itself instead of an encoded rendering of it, and the
 * lookup needs no side table. Policy fields are deliberately absent: they are
 * applied to the evidence per call.
 */
export class EvidenceKey extends Schema.Class<EvidenceKey>("EvidenceKey")({
	name: Schema.String,
	probe: VersionProbe,
}) {}

/**
 * Runs one location's probe.
 *
 * @remarks
 * Presence is decided by whether the process **ran**, never by a shell
 * `command -v`: a spawn failure (`Run.collect`'s typed failure) proves absence,
 * so a tool name is never interpolated into a command line. What a completed
 * run proves depends on the location — see `probeFromRun`: a global tool's
 * non-zero `--version` still proves it exists, while a local probe's non-zero
 * exit is the launcher reporting the tool missing.
 */
const probeLocation = (
	location: "global" | "local",
	command: ChildProcess.Command,
	probe: VersionProbe,
): Effect.Effect<Probe, never, ChildProcessSpawner.ChildProcessSpawner> =>
	Run.collect(command).pipe(
		Effect.map((output) => probeFromRun(location, probe, output)),
		Effect.catch(() => Effect.succeed(ABSENT)),
	);

/**
 * Applies a tool's policy to its evidence, building the public result.
 *
 * @remarks
 * Shared with `makeToolDiscoverySync`, so the Effect service and the sync
 * facade answer identically from identical evidence. The refusal is NOT here:
 * it must happen before any evidence is gathered.
 */
export const resolveFromEvidence = (
	tool: Tool,
	evidence: Evidence,
): Result.Result<ResolvedTool, ToolNotFoundError | ToolVersionMismatchError> => {
	const decision = decideResolution(tool, evidence);
	switch (decision._tag) {
		case "NotFound":
			return Result.fail(new ToolNotFoundError({ tool: tool.name, searched: decision.searched }));
		case "Mismatch":
			return Result.fail(
				new ToolVersionMismatchError({
					tool: tool.name,
					globalVersion: decision.globalVersion,
					localVersion: decision.localVersion,
				}),
			);
		case "Resolved":
			return Result.succeed(
				ResolvedTool.make({
					name: tool.name,
					source: decision.source,
					version: decision.version,
					globalVersion: evidence.global.version,
					localVersion: evidence.local.version,
					mismatch: decision.mismatch,
					...(decision.context === undefined ? {} : { context: decision.context }),
				}),
			);
	}
};

/**
 * The {@link ToolDiscovery} service shape.
 *
 * @public
 */
export interface ToolDiscoveryShape {
	/** Resolve a tool against its source requirement and mismatch policy. */
	readonly resolve: (tool: Tool) => Effect.Effect<ResolvedTool, ToolResolutionFailure>;
	/** Whether a tool resolves. Never fails. */
	readonly isAvailable: (tool: Tool) => Effect.Effect<boolean>;
	/** Forget one tool's probe evidence. */
	readonly invalidate: (tool: Tool) => Effect.Effect<void>;
	/** Forget every tool's probe evidence. */
	readonly invalidateAll: Effect.Effect<void>;
}

/** Builds the service over an already-resolved spawner and local-exec context. */
const make = Effect.fnUntraced(function* () {
	const local = yield* LocalExec;
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

	// Cache the EVIDENCE, not the answer: `source` and `onMismatch` are applied
	// per call, so a second Tool with different constraints gets the right answer
	// without a second probe.
	//
	// The key is (name, version probe) — exactly what the evidence depends on —
	// as a `Schema.Class`, whose structural `Equal`/`Hash` the cache's
	// `MutableHashMap` uses, nested union members included. Two tools differing
	// only in policy share one probe; two differing in how they ask for a
	// version do not — pinned by "the cache stores EVIDENCE, so a second Tool
	// with different constraints is answered correctly".
	//
	// `timeToLive` is not decoration: with a fixed TTL, core `Cache` memoizes a
	// FAILED lookup for the entry's lifetime, so one
	// transient probe failure would mark a tool permanently absent.
	const cache = yield* Cache.makeWith(
		(key: EvidenceKey) =>
			Effect.gen(function* () {
				const context = yield* local.context;
				const args = probeArgs(key.probe);
				const globalProbe = yield* probeLocation("global", ChildProcess.make(key.name, args), key.probe);
				const localProbe = Option.isNone(context)
					? ABSENT
					: yield* probeLocation("local", context.value.apply(ChildProcess.make(key.name, args)), key.probe);
				return { global: globalProbe, local: localProbe, context } satisfies Evidence;
			}),
		{
			capacity: CACHE_CAPACITY,
			// Only a POSITIVE result is worth remembering. Two distinct traps sit
			// behind this line, and a naive `isSuccess ? infinity : zero` catches
			// only the first:
			//
			// 1. A failed lookup (the LocalExec mechanism erroring) is memoized for
			//    the entry's whole TTL by default, so a transient failure would
			//    stick for the process lifetime.
			// 2. "Not found" is a SUCCESSFUL lookup carrying negative evidence. Left
			//    memoized, a tool installed mid-process (an action that provisions a
			//    runtime and then uses it) stays absent forever, with nothing to
			//    suggest why — pinned by "ABSENCE is not memoized — a tool installed
			//    mid-process is found".
			//
			// A tool that exists does not stop existing; a tool that does not exist
			// very often starts to.
			timeToLive: (exit) => (Exit.isSuccess(exit) && isPositive(exit.value) ? Duration.infinity : Duration.zero),
		},
	).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner));

	const evidenceFor = (tool: Tool): Effect.Effect<Evidence, LocalExecError> =>
		Cache.get(cache, EvidenceKey.make({ name: tool.name, probe: tool.version }));

	const resolve = Effect.fn("ToolDiscovery.resolve")(function* (tool: Tool) {
		yield* Effect.annotateCurrentSpan({ tool: tool.name, source: tool.source });
		// Pre-spawn guard: argv position zero is not a place to accept a flag.
		if (isRefusedName(tool.name)) {
			return yield* Effect.fail(new ToolRefusedError({ tool: tool.name }));
		}
		const evidence = yield* evidenceFor(tool);
		return yield* Effect.fromResult(resolveFromEvidence(tool, evidence));
	});

	const isAvailable = Effect.fn("ToolDiscovery.isAvailable")(function* (tool: Tool) {
		return yield* resolve(tool).pipe(
			Effect.map(() => true),
			Effect.catch(() => Effect.succeed(false)),
		);
	});

	return {
		resolve,
		isAvailable,
		invalidate: (tool: Tool) => Cache.invalidate(cache, EvidenceKey.make({ name: tool.name, probe: tool.version })),
		invalidateAll: Cache.invalidateAll(cache),
	} satisfies ToolDiscoveryShape;
});

/** The default for an unstubbed {@link ToolDiscovery.makeTest} member. */
const notStubbed = (method: string) => () =>
	Effect.die(
		new Error(
			`ToolDiscovery.makeTest: ${method}() was called but not stubbed — no honest default exists for a test double; pass a \`${method}\` override.`,
		),
	);

/**
 * Resolves CLI tools: globally on `PATH`, or project-locally through the
 * launcher {@link LocalExec} describes.
 *
 * @remarks
 * Presence is proven by **running** the tool, never by a shell `command -v` and
 * never by a filesystem scan: a spawn that completes proves existence whatever
 * the exit code, and a spawn failure proves absence. That is one probe per
 * location, it needs no shell (so a tool name is never interpolated into a
 * command line), and it behaves the same on Windows.
 *
 * Discovery caches what probing learned (presence and versions), not the
 * answer: each call applies its own `Tool.source` and `Tool.onMismatch` to the
 * cached evidence. Only a tool that was found is remembered, so one installed
 * mid-process is picked up on the next call; call `invalidate` to force a
 * re-probe of a tool that changed.
 *
 * @example
 * ```ts
 * import { LocalExec, Run, Tool, ToolDiscovery } from "@effected/commands";
 * import { NodeServices } from "@effect/platform-node";
 * import { Effect, Layer } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const discovery = yield* ToolDiscovery;
 *   if (yield* discovery.isAvailable(Tool.named("git"))) {
 *     const git = yield* discovery.resolve(Tool.named("git"));
 *     return yield* Run.text(git.command("--version"));
 *   }
 *   return "no git";
 * });
 *
 * const AppLayer = ToolDiscovery.layer.pipe(
 *   Layer.provide(LocalExec.layerNone),
 *   Layer.provide(NodeServices.layer),
 * );
 *
 * Effect.runPromise(program.pipe(Effect.provide(AppLayer)));
 * ```
 *
 * @public
 */
export class ToolDiscovery extends Context.Service<ToolDiscovery, ToolDiscoveryShape>()(
	"@effected/commands/ToolDiscovery",
) {
	/** Resolves its dependencies once at construction, so every method's `R` is `never`. */
	static readonly layer: Layer.Layer<ToolDiscovery, never, ChildProcessSpawner.ChildProcessSpawner | LocalExec> =
		Layer.effect(this, make());

	/**
	 * An in-memory test double: stub only what the test exercises; every other
	 * member dies with a defect naming itself.
	 *
	 * @remarks
	 * No member has an honest default — a fabricated `ResolvedTool` would leak
	 * into consumer logic as fact — so an unstubbed call fails loudly rather
	 * than lying.
	 */
	static readonly makeTest = (overrides: Partial<ToolDiscoveryShape> = {}): ToolDiscoveryShape => ({
		resolve: notStubbed("resolve"),
		isAvailable: notStubbed("isAvailable"),
		invalidate: notStubbed("invalidate"),
		invalidateAll: Effect.die(
			new Error("ToolDiscovery.makeTest: invalidateAll was used but not stubbed — pass an `invalidateAll` override."),
		),
		...overrides,
	});

	/**
	 * {@link ToolDiscovery.makeTest} behind `Layer.succeed`.
	 *
	 * @remarks
	 * A parameterized layer factory mints a fresh reference per call and layers
	 * memoize by reference — bind the result to a `const` rather than calling it
	 * at each composition site.
	 */
	static readonly layerTest = (overrides: Partial<ToolDiscoveryShape> = {}): Layer.Layer<ToolDiscovery> =>
		Layer.succeed(ToolDiscovery, ToolDiscovery.makeTest(overrides));
}
