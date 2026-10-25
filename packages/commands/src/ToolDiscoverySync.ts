// The synchronous escape hatch for tool discovery — over a CONSUMER-SUPPLIED
// spawn.
//
// A lint-staged handler is a plain function called on every commit; there is
// no Effect runtime to run `ToolDiscovery` in. This module gives that caller
// the same answers: the refusal, the version reading, the presence rule and the
// selection are `internal/toolResolution.ts` and `resolveFromEvidence`, shared
// with the Effect service. Only the spawn and the cache are its own. It imports
// nothing platform-shaped — `@effected/commands/node-sync` binds the spawn to
// `node:child_process`.

import { MutableHashMap, Option, Result } from "effect";
import type { Evidence, Probe } from "./internal/toolResolution.js";
import { ABSENT, isPositive, isRefusedName, probeArgs, probeFromRun } from "./internal/toolResolution.js";
import type { ExecContext } from "./LocalExec.js";
import type { Tool } from "./Tool.js";
import type { ResolvedTool, ToolNotFoundError, ToolVersionMismatchError } from "./ToolDiscovery.js";
import { EvidenceKey, ToolRefusedError, resolveFromEvidence } from "./ToolDiscovery.js";

/**
 * What one synchronous spawn reports — the subset of Node's
 * `spawnSync(..., { encoding: "utf8" })` result that discovery reads.
 *
 * @public
 */
export interface SyncSpawnResult {
	/** Set when the process could not be started (`ENOENT` for a missing executable). */
	readonly error?: unknown;
	/** The exit code, or `null` when a signal ended the process. */
	readonly status: number | null;
	/** Captured standard output, decoded as UTF-8. */
	readonly stdout: string;
}

/**
 * Spawns `command` with `args` synchronously, with no shell, and reports how
 * it went.
 *
 * @remarks
 * The contract: never interpolate into a shell (argv only), capture stdout,
 * and report a process that could not start through `error` rather than by
 * throwing. A throw is tolerated — it reads as "could not start" — but a
 * spawn that never returns blocks the caller, so an implementation for
 * untrusted tools should bound it (`spawnSync`'s `timeout`).
 *
 * @public
 */
export type SyncSpawn = (
	command: string,
	args: ReadonlyArray<string>,
	options: { readonly cwd?: string | undefined },
) => SyncSpawnResult;

/**
 * Options for {@link makeToolDiscoverySync}.
 *
 * @public
 */
export interface ToolDiscoverySyncOptions {
	/** The synchronous spawn; `nodeSpawnSync` from `@effected/commands/node-sync` on Node. */
	readonly spawn: SyncSpawn;
	/**
	 * The project-local execution context — the sync counterpart of the
	 * `LocalExec` service. Omitted, every tool resolves globally, like
	 * `LocalExec.layerNone`. Build one with `LocalExec.contextFor`, or derive it
	 * from a workspace with `@effected/workspaces`' `localExecContextSync`.
	 */
	readonly context?: ExecContext | undefined;
}

/**
 * Every way {@link ToolDiscoverySync.resolve} can fail.
 *
 * @remarks
 * `ToolDiscovery`'s taxonomy minus `LocalExecError`: the execution context is
 * a value the caller already holds, so determining it cannot fail here.
 *
 * @public
 */
export type ToolSyncResolutionFailure = ToolNotFoundError | ToolVersionMismatchError | ToolRefusedError;

/**
 * Synchronous tool discovery: `ToolDiscovery`'s contract for a caller with no
 * Effect runtime.
 *
 * @public
 */
export interface ToolDiscoverySync {
	/** Resolve a tool against its `source`, `onMismatch` and `prefer`. Never throws. */
	readonly resolve: (tool: Tool) => Result.Result<ResolvedTool, ToolSyncResolutionFailure>;
	/** Whether a tool resolves. Never throws. */
	readonly isAvailable: (tool: Tool) => boolean;
	/** Forget one tool's probe evidence. */
	readonly invalidate: (tool: Tool) => void;
	/** Forget every tool's probe evidence. */
	readonly invalidateAll: () => void;
}

/**
 * Builds synchronous tool discovery over a caller-supplied spawn.
 *
 * @remarks
 * **The same answers as `ToolDiscovery`, from the same code.** The pre-spawn
 * refusal of an empty or `-`-prefixed name (`ToolRefusedError`), the version
 * reading, the presence rule and the choice between copies are shared with the
 * Effect service, so for the same evidence the two cannot disagree. Absence is
 * a spawn that could not start; a global tool whose `--version` exits non-zero
 * still exists, while a local probe needs exit 0, because the launcher runs
 * either way and reports a missing tool as a failure.
 *
 * **The same caching rule.** Each instance remembers probe EVIDENCE, keyed by
 * the tool's name and version probe, and applies each call's policy to it — so
 * two `Tool`s differing only in `source`, `onMismatch` or `prefer` share one
 * probe. Only a tool that was found is remembered; absence is re-probed on the
 * next call, so a tool installed mid-process is found. Hold one instance for
 * the process (a module-level `const`) to get the memoization; a fresh
 * instance per call re-probes every time.
 *
 * A first resolution costs one spawn for the global copy plus one for the
 * local copy when a context is supplied; later resolutions of a found tool
 * cost none.
 *
 * @param options - The spawn, and the project-local context if there is one.
 *
 * @example
 * ```ts
 * import { LocalExec, Tool, makeToolDiscoverySync } from "@effected/commands";
 * import { nodeSpawnSync } from "@effected/commands/node-sync";
 * import { Result } from "effect";
 *
 * const discovery = makeToolDiscoverySync({
 *   spawn: nodeSpawnSync,
 *   context: LocalExec.contextFor("pnpm", { directory: process.cwd() }),
 * });
 *
 * const biome = discovery.resolve(Tool.named("biome", { prefer: "global" }));
 * const command = Result.isSuccess(biome) ? biome.success.argv("check", "--write").join(" ") : undefined;
 * ```
 *
 * @public
 */
export const makeToolDiscoverySync = (options: ToolDiscoverySyncOptions): ToolDiscoverySync => {
	const { spawn, context } = options;
	const cache = MutableHashMap.empty<EvidenceKey, Evidence>();
	const keyOf = (tool: Tool): EvidenceKey => EvidenceKey.make({ name: tool.name, probe: tool.version });

	/** One probe; a spawn that reports `error` — or throws — is absence. */
	const probeLocation = (
		location: "global" | "local",
		command: string,
		args: ReadonlyArray<string>,
		cwd: string | undefined,
		tool: Tool,
	): Probe => {
		let result: SyncSpawnResult;
		try {
			result = spawn(command, args, { cwd });
		} catch {
			return ABSENT;
		}
		if (result.error !== undefined) return ABSENT;
		// A signal-ended run (`status: null`) still ran; it reads as a non-zero exit.
		return probeFromRun(location, tool.version, { exitCode: result.status ?? -1, stdout: result.stdout });
	};

	const gather = (tool: Tool): Evidence => {
		const args = probeArgs(tool.version);
		const global = probeLocation("global", tool.name, args, undefined, tool);
		const [launcher, ...launcherArgs] = context?.prefix ?? [];
		// A context with an empty prefix runs the tool bare in its directory —
		// what `ExecContext.apply` does with one.
		const local =
			context === undefined
				? ABSENT
				: launcher === undefined
					? probeLocation("local", tool.name, args, context.directory, tool)
					: probeLocation("local", launcher, [...launcherArgs, tool.name, ...args], context.directory, tool);
		return { global, local, context: context === undefined ? Option.none() : Option.some(context) };
	};

	const evidenceFor = (tool: Tool): Evidence => {
		const key = keyOf(tool);
		const cached = MutableHashMap.get(cache, key);
		if (Option.isSome(cached)) return cached.value;
		const evidence = gather(tool);
		// Only a POSITIVE result is remembered: a tool that does not exist very
		// often starts to, and memoized absence would hide it for the process.
		if (isPositive(evidence)) MutableHashMap.set(cache, key, evidence);
		return evidence;
	};

	const resolve = (tool: Tool): Result.Result<ResolvedTool, ToolSyncResolutionFailure> =>
		isRefusedName(tool.name)
			? Result.fail(new ToolRefusedError({ tool: tool.name }))
			: resolveFromEvidence(tool, evidenceFor(tool));

	return {
		resolve,
		isAvailable: (tool) => Result.isSuccess(resolve(tool)),
		invalidate: (tool) => {
			MutableHashMap.remove(cache, keyOf(tool));
		},
		invalidateAll: () => {
			MutableHashMap.clear(cache);
		},
	};
};
