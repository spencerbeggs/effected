// `node:fs` rather than `FileSystem`: the scratch directory is the SEA compiler's working tree, which tsdown and
// `@tsdown/exe` write and read on the host disk. It is their setup, not an output of this build.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "rolldown";
import type { BuildCollector } from "../report/collector.js";
import { buildMetricsPlugin } from "../report/metrics-plugin.js";
import { createTimer } from "../report/timer.js";
import { createTsdownLogger } from "../report/tsdown-logger.js";
import type { NormalizedExe } from "./config.js";

/**
 * A minimal structural type for tsdown's build, looser than `TsdownBuild` because this path passes an object literal.
 *
 * @public
 */
export type ExeBuild = (config: unknown) => Promise<unknown>;

/**
 * Options for compiling SEA binaries.
 *
 * @public
 */
export interface RunExeBuildOptions {
	readonly cwd: string;
	/** Directory the binaries are emitted into (e.g. dist/prod/npm/pkg/bin). */
	readonly outDir: string;
	/** One fully-resolved spec per binary. */
	readonly specs: ReadonlyArray<NormalizedExe>;
	/** Injectable tsdown build (defaults to tsdown's build function). */
	readonly build?: ExeBuild | undefined;
	/** When set with groupId, muzzle tsdown and record an "exe" pass into this collector. */
	readonly collector?: BuildCollector | undefined;
	/** Target-group id the exe pass belongs to (required to record into the collector). */
	readonly groupId?: string | undefined;
	/** Compute gzip sizes (verbose render). */
	readonly verbose?: boolean | undefined;
}

/**
 * Compile each SEA binary via tsdown's exe mode. One tsdown build per spec.
 *
 * @public
 */
export async function runExeBuild(options: RunExeBuildOptions): Promise<void> {
	const build: ExeBuild = options.build ?? ((await import("tsdown")).build as unknown as ExeBuild);
	for (const spec of options.specs) {
		// tsdown emits the bundled JS the SEA is compiled from to its top-level `outDir` — a separate
		// output from the binary in `exe.outDir`. Left unset it defaults to `<cwd>/dist`, leaving an
		// orphaned `dist/<entry>.mjs` beside the real binary that no manifest references and the
		// package never publishes. Point that intermediate at a throwaway scratch dir and drop it once
		// the binary is built, so only `exe.outDir` carries a deliverable.
		const scratch = mkdtempSync(join(tmpdir(), "effected-exe-"));
		const collector = options.collector;
		const groupId = options.groupId;
		const instrument: Record<string, unknown> =
			collector !== undefined && groupId !== undefined
				? { logLevel: "silent", customLogger: createTsdownLogger(collector, groupId) }
				: {};
		const plugins: Plugin[] =
			collector !== undefined && groupId !== undefined
				? [buildMetricsPlugin(collector, groupId, "exe", options.verbose ?? false)]
				: [];
		const timer = createTimer();
		try {
			await build({
				cwd: options.cwd,
				config: false,
				entry: [spec.entry],
				format: "esm",
				platform: "node",
				clean: false,
				outDir: scratch,
				// A SEA bundles every non-builtin import (nothing is resolvable from disk inside the SEA).
				deps: { alwaysBundle: (id: string) => !id.startsWith("node:") },
				exe: {
					fileName: spec.fileName,
					outDir: options.outDir,
					seaConfig: spec.seaConfig,
					targets: spec.targets,
				},
				...instrument,
				...(plugins.length > 0 ? { plugins } : {}),
			});
		} finally {
			if (collector !== undefined && groupId !== undefined) collector.recordPassTiming(groupId, "exe", timer.elapsed());
			rmSync(scratch, { recursive: true, force: true });
		}
	}
}
