import type { VirtualTypeScriptEnvironment } from "@typescript/vfs";
import { Effect, Schema } from "effect";
import type * as ts from "typescript";
import { isTypeDefinition } from "./internal/resolution.js";
import type { Vfs } from "./Vfs.js";

/**
 * Raised when building a virtual TypeScript environment fails — including
 * when the optional `typescript` / `@typescript/vfs` peers are not
 * installed.
 *
 * @public
 */
export class TsEnvironmentError extends Schema.TaggedErrorClass<TsEnvironmentError>()("TsEnvironmentError", {
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return "Failed to create the virtual TypeScript environment";
	}
}

/**
 * Options for {@link TsEnvironment.make}.
 *
 * @public
 */
export interface TsEnvironmentOptions {
	/** The virtual file system to typecheck against. */
	readonly vfs: Vfs;
	/** Compiler options for the language service. */
	readonly compilerOptions: ts.CompilerOptions;
	/**
	 * The directory VFS paths are rooted under and the filesystem fallback
	 * root. Defaults to `process.cwd()` (which v3 hardcoded).
	 */
	readonly projectRoot?: string;
}

/**
 * The `@typescript/vfs` seam: builds a `VirtualTypeScriptEnvironment` over a
 * {@link Vfs} plus the TypeScript default lib files.
 *
 * @remarks
 * The ONLY module touching the optional `typescript` / `@typescript/vfs`
 * peers, and it loads them lazily inside {@link TsEnvironment.make} — a
 * consumer that never calls it never loads the compiler, and a missing peer
 * fails typed as {@link TsEnvironmentError} instead of crashing at import
 * time. The underlying `createDefaultMapFromNodeModules` /
 * `createFSBackedSystem` read the real filesystem through TypeScript's own
 * `sys`, outside the Effect `FileSystem` service — accepted and documented;
 * this module is why the package is integrated tier on its own surface.
 *
 * No cache map (v3's `createTypeScriptCache` returned a one-entry `Map`
 * keyed by `JSON.stringify(compilerOptions)`): a consumer that wants keyed
 * reuse holds its own map.
 *
 * `VirtualTypeScriptEnvironment` is deliberately not re-exported — import
 * the type from `@typescript/vfs`, which consumers of this module already
 * declare.
 *
 * @example
 * ```ts
 * import { TsEnvironment } from "@effected/ts-vfs";
 * import * as ts from "typescript";
 *
 * const environment = TsEnvironment.make({
 *   vfs,
 *   compilerOptions: { strict: true, target: ts.ScriptTarget.ES2022 },
 * });
 * ```
 *
 * @public
 */
export class TsEnvironment {
	private constructor() {}

	/** Build a `VirtualTypeScriptEnvironment` over a {@link Vfs}. */
	static make(options: TsEnvironmentOptions): Effect.Effect<VirtualTypeScriptEnvironment, TsEnvironmentError> {
		return Effect.gen(function* () {
			// Lazy imports: the peers are optional, so failing to load them is a
			// typed failure, not an import-time crash.
			const [tsModule, tsVfs] = yield* Effect.tryPromise({
				try: () => Promise.all([import("typescript"), import("@typescript/vfs")]),
				catch: (cause) => new TsEnvironmentError({ cause }),
			});
			return yield* Effect.try({
				try: () => {
					const typescript = tsModule.default;
					const projectRoot = options.projectRoot ?? process.cwd();

					// Lib files resolve from the real node_modules; user files are
					// re-rooted under projectRoot (bare `node_modules/…` keys do not
					// resolve — probed against @typescript/vfs 1.6.x).
					const system = new Map<string, string>(
						tsVfs.createDefaultMapFromNodeModules(options.compilerOptions, typescript),
					);
					const rootFiles: Array<string> = [];
					for (const [path, content] of options.vfs) {
						const rooted = path.startsWith("/") ? path : `${projectRoot}/${path}`;
						system.set(rooted, content);
						if (isTypeDefinition(rooted)) rootFiles.push(rooted);
					}

					const sys = tsVfs.createFSBackedSystem(system, projectRoot, typescript);
					return tsVfs.createVirtualTypeScriptEnvironment(sys, rootFiles, typescript, options.compilerOptions);
				},
				catch: (cause) => new TsEnvironmentError({ cause }),
			});
		}).pipe(Effect.withSpan("TsEnvironment.make"));
	}
}
