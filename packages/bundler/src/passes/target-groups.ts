// packages/bundler/src/passes/target-groups.ts
import { join } from "node:path";

/**
 * A build group id: "dev" or any prod byte-variant id (e.g. "npm", "github", a custom key).
 *
 * @public
 */
export type TargetGroupId = string;

/**
 * An output module format the build can emit.
 *
 * @public
 */
export type BuildFormat = "esm" | "cjs";

/**
 * Bundling platform for the JS pass. Defaults to "node". Use "browser" for web runtime partitions.
 *
 * @public
 */
export type BuildPlatform = "node" | "browser" | "neutral";

/**
 * A prod/dev group to build: its folder id and the resolved package name its manifest carries.
 *
 * @public
 */
export interface BuildGroupSpec {
	readonly id: TargetGroupId;
	readonly name: string;
}

/** @public */
export interface DeriveOptions {
	readonly group: TargetGroupId;
	readonly cwd: string;
	readonly version: string;
	readonly entry: Record<string, string>;
	readonly tsconfigPath: string;
	readonly devManifest: "preserve" | "resolve";
	readonly externals?: ReadonlyArray<string>;
	/** JS-pass platform. Defaults to "node"; set "browser" for an RSPress runtime partition. */
	readonly platform?: BuildPlatform | undefined;
	/** Output formats to emit. Defaults to esm-only when unset. */
	readonly format?: ReadonlyArray<BuildFormat> | undefined;
	/** Minify prod output (prod groups only; dev is never minified). Defaults to false. */
	readonly minify?: boolean | undefined;
	/**
	 * Compile-time global replacements forwarded to the build `define`. Merged AFTER the
	 * auto-injected `process.env.__PACKAGE_VERSION__` so a user key of the same name wins.
	 * Values are inserted verbatim (string literals must already be quoted).
	 */
	readonly define?: Record<string, string> | undefined;
	/**
	 * External packages whose declarations should be INLINED into the bundled dts
	 * (the rslib `dtsBundledPackages` equivalent). Maps to tsdown's `deps.onlyBundle`
	 * in the dts pass, so ONLY these node_modules packages are rolled into the
	 * `.d.ts` and every other dependency stays an external `import`. dts-pass-only:
	 * runtime JS bundling is unaffected.
	 */
	readonly bundledPackages?: ReadonlyArray<string> | undefined;
	/**
	 * Force-bundle node_modules (and workspace) JS dependencies into the JS pass.
	 * Consumed here ONLY to decide the JS pass's `unbundle` posture — see
	 * {@link DerivedTsdownOptions.unbundle} — which is the whole of its effect: tsdown
	 * already bundles anything the manifest does not declare as a production dependency,
	 * so no `deps` flag is needed to force it.
	 */
	readonly bundleNodeModules?: boolean | undefined;
}

/**
 * The JS pass: per-module JavaScript, no declarations.
 *
 * The build runs TWO tsdown passes per TargetGroup to the SAME outDir:
 *  - pass 1 (this) emits per-module JS (`unbundle: true`) with `dts: false` and the
 *    default `clean: true`, so it starts from a fresh outDir;
 *  - pass 2 (`DerivedDtsPassOptions`) emits ONLY bundled declarations (`unbundle: false`,
 *    `dts: { emitDtsOnly: true }`) with `clean: false`, so it must NOT wipe pass 1.
 *
 * We cannot do this in a single pass: tsdown's `unbundle` maps to rolldown
 * `output.preserveModules` for the WHOLE build, and the dts plugin shares it — so one pass
 * gives EITHER per-module JS + per-module dts OR bundled JS + bundled dts. Per-module dts
 * breaks type portability (TS2883) when a package exports only its root entry, and bundling
 * the JS re-bundles workspace consumers (e.g. silk re-bundling silk-effects crashes at
 * runtime). The split keeps per-module JS (no re-bundle hazard) AND bundled, self-contained
 * declarations (no TS2883).
 *
 * **`unbundle` flips to `false` when `bundleNodeModules` is set.** `bundleNodeModules: true`
 * exists to produce a genuinely self-contained artifact (its own TSDoc already promises this),
 * but `preserveModules` (the per-module JS pass) writes every inlined node_modules dependency
 * out to its OWN sibling file, mirroring its `node_modules/.pnpm/...` (or workspace) path
 * relative to the package root — for BOTH esm and cjs. `npm pack` unconditionally strips any
 * directory literally named `node_modules` from the published tarball, so an esm entry built
 * this way throws `Cannot find module '.../node_modules/.pnpm/.../foo.js'` once packed and
 * installed (the cjs sibling accidentally escapes this: tsdown's own dts pass, which always
 * runs `unbundle: false`, re-emits and overwrites a dual-format build's `.cjs` JS chunk as a
 * side effect of emitting `.d.cts` — see the dts-pass rebuild note in `buildTargetGroups` — so
 * only the esm artifact keeps the broken preserveModules layout). Turning `unbundle` off for
 * the JS pass whenever `bundleNodeModules` is requested makes BOTH formats bundle into one
 * self-contained file, matching what the flag already promises and what the cjs side already
 * does by accident. Scoped to `bundleNodeModules` alone: every other build keeps the default
 * per-module dev-friendly layout unchanged.
 * @public
 */
export interface DerivedTsdownOptions {
	readonly outDir: string;
	readonly sourcemap: boolean;
	readonly minify: boolean;
	readonly format: ReadonlyArray<BuildFormat>;
	/** `false` only when `bundleNodeModules` is set — see the interface TSDoc above. */
	readonly unbundle: boolean;
	/** JS pass starts fresh; it owns the outDir before the dts pass appends to it. */
	readonly clean: true;
	readonly platform: BuildPlatform;
	/**
	 * Controls output file extensions. Always false for this builder.
	 *
	 * tsdown 0.22.2 finding (verified by running a real esm+cjs build of a type:module package):
	 * - With fixedExtension: false, tsdown emits ESM index.js plus CJS index.cjs for a
	 *   type:module package in the JS pass. There is no collision: tsdown derives the .js
	 *   extension for ESM and the .cjs extension for CJS automatically. An earlier M1.1 note
	 *   claimed the two formats collide on ambient .js under fixedExtension: false; that claim
	 *   was wrong and is corrected here.
	 * - This .js plus .cjs scheme is the one we want. It matches the rslib parity target, where
	 *   silk's dual-format output uses import: .js, require: .cjs, and a single types: .d.ts, and
	 *   it matches the flat manifest the emit-manifest transform writes.
	 * - Setting fixedExtension: true would instead yield .mjs plus .cjs (and .d.mts plus .d.cts),
	 *   which is NOT wanted, so dual-format needs no fixedExtension change and we leave it false.
	 * - The matching `.d.ts` / `.d.cts` declarations are emitted by the SEPARATE dts pass (see
	 *   `DerivedDtsPassOptions`), which keeps `unbundle: false` so the declarations are rolled up.
	 */
	readonly fixedExtension: false;
	readonly entry: Record<string, string>;
	/** JS pass emits no declarations; the dts pass owns them. */
	readonly dts: false;
	readonly define: Record<string, string>;
	readonly isProd: boolean;
	/**
	 * CJS named-export interop, the equivalent of rslib's cjsInterop: true. This is the real
	 * tsdown option name, so it threads straight to the build with no rename.
	 *
	 * tsdown 0.22.2 finding (verified against the dist Options dts plus the build source):
	 * - cjsDefault is a top-level boolean, default true. The build maps it to rolldown's
	 *   output.exports: cjsDefault ? "auto" : "named", and also silences the MIXED_EXPORT
	 *   warning. With "auto", a module whose only default-style export is a single default
	 *   becomes module.exports = value, while named exports stay attached, so a require() call
	 *   returns the value directly and named exports survive, the interop rslib gives with
	 *   cjsInterop: true.
	 * - We only set it (to true) when cjs is in the format, so esm-only builds leave the tsdown
	 *   default untouched and stay byte-identical to before.
	 */
	readonly cjsDefault?: boolean | undefined;
}

/**
 * The dts pass: bundled (rolled-up, self-contained) declarations only, no JS.
 *
 * Appended to the SAME outDir as the JS pass, so `clean` MUST be false (otherwise it wipes
 * the per-module JS the JS pass just wrote). `unbundle: false` makes rolldown roll the
 * declarations up per public entry, so a type re-exported through the root entry lands inline
 * in `index.d.ts` (fixing TS2883) instead of as a per-module sibling `.d.ts`.
 * `dts: { emitDtsOnly: true }` strips the JS chunks this pass would otherwise produce.
 *
 * Dual format: when `format` includes `cjs`, the dts pass still emits both `index.d.ts` (esm)
 * and `index.d.cts` (cjs) to the shared outDir.
 *
 * @public
 */
export interface DerivedDtsPassOptions {
	readonly outDir: string;
	readonly sourcemap: false;
	readonly format: ReadonlyArray<BuildFormat>;
	readonly unbundle: false;
	readonly clean: false;
	readonly platform: "node";
	readonly fixedExtension: false;
	readonly entry: Record<string, string>;
	readonly dts: DtsPassDtsOptions;
	readonly define: Record<string, string>;
	readonly isProd: boolean;
	/** External packages to inline into the bundled dts (tsdown `deps.onlyBundle`). */
	readonly bundledPackages?: ReadonlyArray<string> | undefined;
}

/**
 * The `dts` block both declaration passes hand to tsdown.
 *
 * The generator is pinned to `"tsgo"` — the TypeScript 7.1 declaration-emit API — and the
 * TypeScript module is named explicitly via `tsgo.moduleUrl`, resolved from THIS package's own
 * `typescript` dependency. rolldown-plugin-dts' auto-detection only inspects whatever
 * `typescript` it can reach from its own location, which in a consumer workspace may be a
 * hoisted copy with no API (TypeScript 7.0's main export is a version stub); naming the module
 * makes the pass resolve the same compiler in every install topology.
 *
 * @public
 */
export interface DtsPassDtsOptions {
	readonly tsconfig: string;
	readonly emitDtsOnly: true;
	readonly generator: "tsgo";
	readonly tsgo: { readonly moduleUrl: string };
}

/** The `file://` URL of the TypeScript module this package resolves (its own pinned dependency). */
const typescriptModuleUrl = (): string => import.meta.resolve("typescript");

/**
 * Build the {@link DtsPassDtsOptions} for a resolved tsconfig path.
 *
 * @public
 */
export const dtsPassDtsOptions = (tsconfig: string): DtsPassDtsOptions => ({
	tsconfig,
	emitDtsOnly: true,
	generator: "tsgo",
	tsgo: { moduleUrl: typescriptModuleUrl() },
});

/**
 * The output dir for a group: `dist/prod/\<group\>/pkg`, or `dist/dev/pkg` for the unused dev group.
 *
 * @public
 */
export const outDirFor = (cwd: string, group: TargetGroupId): string =>
	group === "dev" ? join(cwd, "dist/dev/pkg") : join(cwd, "dist/prod", group, "pkg");

/**
 * Per-module declarations dir for a prod group: a sibling of `pkg/`, NOT published, used only as
 * API Extractor's diagnostics-run input so locations resolve to per-file source. Kept (not stripped)
 * as a cacheable, inspectable build artifact (issue #162).
 *
 * @public
 */
export const declarationsDirFor = (cwd: string, group: TargetGroupId): string =>
	join(cwd, "dist/prod", group, "declarations");

/**
 * Derive the JS-pass tsdown options for one TargetGroup (per-module JS, no dts).
 *
 * @public
 */
export function deriveTargetGroupOptions(options: DeriveOptions): DerivedTsdownOptions {
	const isProd = options.group !== "dev";
	const format = options.format ?? ["esm"];
	const hasCjs = format.includes("cjs");
	return {
		outDir: outDirFor(options.cwd, options.group),
		sourcemap: !isProd,
		// Minify is opt-in (default false) and prod-only: dev never minifies, and prod
		// minifies only when the caller asked. Node libraries favor readable output.
		minify: isProd && (options.minify ?? false),
		format,
		// See DerivedTsdownOptions' TSDoc: bundleNodeModules promises a self-contained
		// artifact, which per-module preserveModules output defeats for esm once packed
		// (npm pack strips node_modules dirs the JS pass wrote its inlined deps into).
		// Turning preserveModules off restores a single bundled file for every format.
		unbundle: !(options.bundleNodeModules ?? false),
		clean: true,
		platform: options.platform ?? "node",
		// Always false: tsdown derives ESM .js plus CJS .cjs for a type:module package, the
		// scheme we want. fixedExtension: true would yield .mjs and break the manifest parity.
		fixedExtension: false,
		entry: options.entry,
		dts: false,
		define: {
			"process.env.__PACKAGE_VERSION__": JSON.stringify(options.version),
			...options.define,
		},
		isProd,
		// Only enable CJS interop when cjs is actually built; esm-only keeps tsdown's default.
		...(hasCjs ? { cjsDefault: true } : {}),
	};
}

/**
 * Derive the dts-pass tsdown options for one TargetGroup (bundled declarations only).
 *
 * @public
 */
export function deriveDtsPassOptions(options: DeriveOptions): DerivedDtsPassOptions {
	const isProd = options.group !== "dev";
	const format = options.format ?? ["esm"];
	// Bin entries are side-effect-only executables with no exports. Generating a `.d.ts` for them
	// produces an empty `export {};` chunk that makes rolldown-plugin-dts:fake-js emit a spurious
	// SOURCEMAP_BROKEN warning. Excluding them from the dts pass eliminates the warning without
	// affecting the JS pass (bin/cli.js still builds — only declarations are skipped).
	const entry = Object.fromEntries(Object.entries(options.entry).filter(([name]) => !name.startsWith("bin/")));
	return {
		outDir: outDirFor(options.cwd, options.group),
		sourcemap: false,
		format,
		unbundle: false,
		clean: false,
		platform: "node",
		fixedExtension: false,
		entry,
		dts: dtsPassDtsOptions(options.tsconfigPath),
		define: {
			"process.env.__PACKAGE_VERSION__": JSON.stringify(options.version),
			...options.define,
		},
		isProd,
		...(options.bundledPackages !== undefined ? { bundledPackages: options.bundledPackages } : {}),
	};
}

/** @internal */
export interface DerivedDeclarationsPassOptions {
	readonly outDir: string;
	readonly sourcemap: false;
	readonly format: ReadonlyArray<BuildFormat>;
	readonly unbundle: true;
	readonly platform: "node";
	readonly fixedExtension: false;
	readonly entry: Record<string, string>;
	readonly dts: DtsPassDtsOptions;
	readonly define: Record<string, string>;
	readonly bundledPackages?: ReadonlyArray<string> | undefined;
}

/**
 * Derive the per-module declarations pass (API Extractor diagnostics input). Mirrors
 * {@link deriveDtsPassOptions} but `unbundle: true` (preserveModules → 1:1 source positions),
 * esm-only (AE reads the `.d.ts` entry only), into the `declarations/` sibling dir. Bin entries
 * are dropped (no exports).
 * @internal
 */
export function deriveDeclarationsPassOptions(options: DeriveOptions): DerivedDeclarationsPassOptions {
	const entry = Object.fromEntries(Object.entries(options.entry).filter(([name]) => !name.startsWith("bin/")));
	return {
		outDir: declarationsDirFor(options.cwd, options.group),
		sourcemap: false,
		format: ["esm"],
		unbundle: true,
		platform: "node",
		fixedExtension: false,
		entry,
		dts: dtsPassDtsOptions(options.tsconfigPath),
		define: {
			"process.env.__PACKAGE_VERSION__": JSON.stringify(options.version),
			...options.define,
		},
		...(options.bundledPackages !== undefined ? { bundledPackages: options.bundledPackages } : {}),
	};
}
