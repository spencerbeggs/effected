// packages/bundler/src/dts/resolved-tsconfig.ts
import { createHash } from "node:crypto";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import { TsconfigLoaderSync } from "@effected/tsconfig-json";
import { Result } from "effect";
import { tsconfigSyncOptions } from "../tsconfig/sync-options.js";

/** @public */
export interface ResolvedTsconfigOptions {
	/** Absolute package root. */
	readonly cwd: string;
	/** TS `compilerOptions.jsx` override (e.g. "react-jsx"); wins over the resolved config. */
	readonly jsx?: string | undefined;
	/** TS `compilerOptions.jsxImportSource` override (e.g. "react"); wins over the resolved config. */
	readonly jsxImportSource?: string | undefined;
}

/** @public */
export interface ResolvedTsconfig {
	readonly compilerOptions: Record<string, unknown>;
	readonly include: ReadonlyArray<string>;
	readonly exclude: ReadonlyArray<string>;
}

/**
 * The dts-pass deltas layered over whatever the package's own tsconfig declares. The shared
 * `ecma.json` base sets `composite`/`incremental` true and points `tsBuildInfoFile` at a build
 * info file; the declaration pass must never skip emit on stale build info, so all three are
 * forced off here. `declarationMap` is forced on for the emitted maps. `declaration` and
 * `emitDeclarationOnly` are forced on/off respectively because this pass's entire job is
 * emitting declarations — it cannot honor a consumer's `declaration: false`; TypeScript's
 * emitter asserts (`Debug Failure` in `getSourceMappingURL`) when `declarationMap` is
 * requested without `declaration`.
 *
 * @internal
 */
const DTS_OVERLAY: Record<string, unknown> = {
	declaration: true,
	declarationMap: true,
	emitDeclarationOnly: false,
	composite: false,
	incremental: false,
	tsBuildInfoFile: undefined,
};

/**
 * The compiler options used when a package has no own `tsconfig.json` — today's synthesized
 * defaults, preserved verbatim. The e2e `leaf` / `leaf-escape` fixtures build without one, so
 * absence is a supported case, not an error.
 *
 * @internal
 */
function fallbackCompilerOptions(cwd: string): Record<string, unknown> {
	return {
		declaration: true,
		emitDeclarationOnly: false,
		rootDir: cwd,
		outDir: join(cwd, "dist"),
		declarationDir: join(cwd, "dist"),
		typeRoots: [join(cwd, "node_modules/@types"), join(cwd, "types")],
		types: ["node"],
	};
}

/**
 * Build the portable absolute-path tsconfig object for the dts pass.
 *
 * @remarks
 * Resolves the package's own `<cwd>/tsconfig.json` (which extends the shared
 * `ecma.json` base) through `@effected/tsconfig-json`'s `TsconfigLoaderSync`, so the
 * result carries the package's real effective options — target, module, lib, strict,
 * jsx — with `${configDir}` already substituted to absolute paths. Only the dts-pass
 * overlay (composite/incremental/tsBuildInfoFile forced off, declarationMap forced on)
 * and an explicit jsx override are layered on top.
 *
 * `include`/`exclude` are NOT taken from the resolved config. The shared base includes
 * `__test__` and `lib` sources, which have no business in a declaration program; the
 * narrow list below is dts-pass-specific and deliberately held fixed.
 *
 * @public
 */
export function buildResolvedTsconfig(options: ResolvedTsconfigOptions): ResolvedTsconfig {
	const cwd = options.cwd;
	const ownConfig = join(cwd, "tsconfig.json");
	let base: Record<string, unknown>;
	if (existsSync(ownConfig)) {
		try {
			base = { ...TsconfigLoaderSync.resolve(ownConfig, tsconfigSyncOptions).compilerOptions };
		} catch (error) {
			// A config that EXISTS but will not resolve — malformed JSON, or an `extends` that cannot be
			// located — is a defect, not a fallback case, so fail loudly. Synthesizing defaults here
			// would emit declarations compiled under the WRONG options while still reporting a green
			// build: the tsconfig this function returns is written to a temp file that extends the base
			// by absolute path and never references the broken source, so the dts pass itself sees
			// nothing wrong. A consumer running only `build:*` would never learn about it.
			// `resolvePortableTsconfig` below throws on the same failure; these two must not diverge.
			// Genuine ABSENCE stays a supported case and is handled by the `else` branch.
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Cannot resolve tsconfig at ${ownConfig}: ${message}`, { cause: error });
		}
	} else {
		base = fallbackCompilerOptions(cwd);
	}
	return {
		compilerOptions: {
			...base,
			...DTS_OVERLAY,
			...(options.jsx !== undefined ? { jsx: options.jsx } : {}),
			...(options.jsxImportSource !== undefined ? { jsxImportSource: options.jsxImportSource } : {}),
		},
		include: [
			join(cwd, "src/**/*.ts"),
			join(cwd, "src/**/*.mts"),
			join(cwd, "src/**/*.tsx"),
			join(cwd, "types/*.d.ts"),
			join(cwd, "package.json"),
		],
		exclude: [join(cwd, "node_modules"), join(cwd, "dist/**/*")],
	};
}

/**
 * The base's `files`/`include`/`exclude` (through its whole `extends` chain) as absolute CANONICAL
 * paths under `baseDir`; a base declaring neither `files` nor `include` gets TypeScript's default
 * `**\/*` pinned to `baseDir` explicitly. Paths the base already spelled absolutely (the
 * `writeResolvedTsconfig` output builds them from the package cwd) are canonicalized too, so a
 * symlinked cwd cannot smuggle a non-canonical name past the canonical `extends`. A base the loader
 * cannot resolve contributes nothing (the wrapper then inherits whatever the base declares, as before).
 */
function absoluteFileSet(
	configPath: string,
	baseDir: string,
): { files?: string[]; include?: string[]; exclude?: string[] } {
	let resolved: { files?: ReadonlyArray<string>; include?: ReadonlyArray<string>; exclude?: ReadonlyArray<string> };
	try {
		resolved = TsconfigLoaderSync.resolve(configPath, tsconfigSyncOptions);
	} catch {
		return {};
	}
	const abs = (p: string): string => canonicalGlob(isAbsolute(p) ? p : join(baseDir, p));
	const files = resolved.files?.map(abs);
	const include = resolved.include?.map(abs) ?? (files === undefined ? [join(baseDir, "**/*")] : undefined);
	const exclude = resolved.exclude?.map(abs);
	return {
		...(files !== undefined ? { files } : {}),
		...(include !== undefined ? { include } : {}),
		...(exclude !== undefined ? { exclude } : {}),
	};
}

/**
 * Compiler options the dts program must never inherit, each written as `null`: `customConditions` and `paths`
 * exist to make the TYPECHECK program resolve siblings from source (an export condition, a path alias), while the
 * declaration program must resolve them the way the package manifest says. They are cleared unconditionally rather
 * than only when the base declares them, so nothing about how the base resolves can leave the leak open.
 */
const DTS_RESET_OPTIONS: Record<string, null> = { customConditions: null, paths: null };

/**
 * tsconfig globs have only `*`, `?` and `**`: an extglob's parentheses, or a leading `#` or `!`, are literal
 * text in a directory name, so none of them may end the literal prefix.
 */
const TSCONFIG_GLOB = GlobPatternOptions.make({ noext: true, nocomment: true, nonegate: true });

/**
 * Resolve symlinks in the literal directory prefix of an absolute path or glob (everything before the
 * first segment carrying a glob character), leaving the pattern tail untouched. A pattern the kit rejects,
 * a prefix that does not exist, or one whose spelling the kit changed (an undone escape) is returned unchanged.
 */
function canonicalGlob(absPath: string): string {
	const compiled = GlobPattern.compileResult(absPath, TSCONFIG_GLOB);
	if (Result.isFailure(compiled)) return absPath;
	const prefix = compiled.success.literalPrefix;
	if (!absPath.startsWith(prefix)) return absPath;
	const tail = absPath.slice(prefix.length);
	let canonicalPrefix: string;
	try {
		canonicalPrefix = realpathSync.native(prefix);
	} catch {
		return absPath;
	}
	return /^\/*$/.test(tail) ? canonicalPrefix : join(canonicalPrefix, tail);
}

/** The longest filename the platforms we build on accept. */
const MAX_FILE_NAME = 255;

/**
 * A temp filename deterministic per (pid, key). The key is a path, sanitized into the name when it fits and hashed
 * when it does not: a deep checkout would otherwise fail the write with `ENAMETOOLONG`, and the dts-emit name
 * embeds the already-sanitized bundle name, so it reaches the limit first.
 */
function tempTsconfigName(prefix: string, key: string): string {
	const name = `${prefix}-${process.pid}-${key.replace(/[^\w]/g, "_")}.json`;
	if (name.length <= MAX_FILE_NAME) return name;
	return `${prefix}-${process.pid}-${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`;
}

/**
 * Write the resolved tsconfig to a temp file and return its absolute path.
 *
 * @public
 */
export function writeResolvedTsconfig(options: ResolvedTsconfigOptions): string {
	const cfg = buildResolvedTsconfig(options);
	const path = join(tmpdir(), tempTsconfigName("tsconfig-bundle", options.cwd));
	writeFileSync(path, `${JSON.stringify(cfg, null, "\t")}\n`, "utf-8");
	return path;
}

/**
 * What a dts-emit tsconfig adds for one partition.
 *
 * @public
 */
export interface DtsEmitTsconfigOptions {
	/** The `paths` map of the bundled workspace siblings. Absent or empty, `paths` stays cleared. */
	readonly paths?: Readonly<Record<string, ReadonlyArray<string>>> | undefined;
}

/**
 * Derive a dts-EMIT variant of an already-written resolved tsconfig that adds
 * `stableTypeOrdering: true`, and return its path. This makes the TypeScript declaration emitter
 * (rolldown-plugin-dts' tsgo generator over this package's `typescript`) order union/type members
 * deterministically, so a multi-union `.d.ts` (e.g. an Effect `Layer.Layer<…>` requirement channel)
 * does not flip member order across otherwise-identical builds (#156). It is kept in a SEPARATE file
 * from the api-extractor tsconfig on purpose: `@microsoft/api-extractor` compiles with its own
 * bundled TypeScript 6, which predates the flag and hard-errors on the unknown compiler option — so
 * only the emit passes ever see it, while the api-extractor compile reads the original clean config.
 *
 * The wrapper is written for the tsgo generator, which opens it as a TypeScript PROJECT and then
 * looks every entry up by the realpath'd module id rolldown hands it — so it has to describe the
 * same file set under the same names:
 *
 * - `extends` names the base by its CANONICAL (symlink-free) path. Root files are resolved relative
 *   to the base's directory, and on a symlinked base dir (macOS `/var` resolving to `/private/var`, a linked
 *   checkout) a non-canonical name would key them differently from rolldown's ids and every entry
 *   would fail with "No TypeScript Go project found".
 * - `files`/`include`/`exclude` are restated as ABSOLUTE paths under the base's directory. A base
 *   that declares none would otherwise get TypeScript's default `**\/*` resolved against the
 *   wrapper's own directory — the OS temp dir — so the project would be every stray temp file on
 *   the machine and never the package's sources.
 *
 * The wrapper also ALWAYS clears `customConditions` and `paths` (written as `null`, which the TypeScript compiler
 * reads as removing an inherited value): the declaration program must resolve sibling packages the way the package
 * manifest says, never through a typecheck-only condition or path alias that would pull source files into the
 * emitted declarations. The one exception is `options.paths`, the bundled workspace siblings resolved to their built
 * declarations, which is the only `paths` map this file ever carries. The only reader of this file is the tsgo
 * declaration generator; nothing in the bundler reads it back through the kit's `TsconfigLoaderSync`, which rejects
 * `null` compiler options.
 *
 * Best-effort: if the base tsconfig cannot be read or parsed (e.g. a synthetic test path that was
 * never written), the original path is returned unchanged — the emit then simply keeps TS's
 * default ordering rather than aborting the build at this layer.
 *
 * @public
 */
export function writeDtsEmitTsconfig(resolvedTsconfigPath: string, options: DtsEmitTsconfigOptions = {}): string {
	const absBase = isAbsolute(resolvedTsconfigPath) ? resolvedTsconfigPath : resolve(resolvedTsconfigPath);
	// Best-effort: a base that does not exist (e.g. a synthetic test path) gets no variant — return it
	// unchanged so the emit keeps TS's default ordering rather than aborting at this layer.
	if (!existsSync(absBase)) return resolvedTsconfigPath;
	const canonicalBase = realpathSync.native(absBase);
	const baseDir = dirname(canonicalBase);
	// A thin wrapper that `extends` the base by ABSOLUTE (canonical) path and adds only
	// `stableTypeOrdering` plus the absolutized file set. Written to the OS temp dir (NOT next to the
	// base) so it never pollutes the source tree when the base is an in-tree `tsconfig.json`, and the
	// absolute `extends` keeps the base's own relative `extends`/paths resolving from the base's
	// location. The filename is deterministic per (pid, base), so repeated calls within a process
	// overwrite the same file rather than accumulating; cross-process temp files are left for the OS
	// to reap, intentionally consistent with `writeResolvedTsconfig`'s pid-scoped temp pattern.
	const paths = options.paths !== undefined && Object.keys(options.paths).length > 0 ? options.paths : undefined;
	const cfg = {
		extends: canonicalBase,
		compilerOptions: { stableTypeOrdering: true, ...DTS_RESET_OPTIONS, ...(paths !== undefined ? { paths } : {}) },
		...absoluteFileSet(canonicalBase, baseDir),
	};
	// A partition that inlines siblings gets its own file: a partition that does not must keep `paths` cleared.
	const key = paths !== undefined ? `${absBase}:${Object.keys(paths).join(",")}` : absBase;
	const path = join(tmpdir(), tempTsconfigName("tsconfig-dts-emit", key));
	writeFileSync(path, `${JSON.stringify(cfg, null, "\t")}\n`, "utf-8");
	return path;
}
