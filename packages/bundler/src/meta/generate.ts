import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { TsdoctorEmitError } from "../errors.js";
import { runApiExtractor } from "./api-extractor.js";
import type { OpenGraphImage } from "./BundleManifest.js";
import { TSDOCTOR_MANIFEST_FILENAME, encodeBundleManifest } from "./BundleManifest.js";
import type { NormalizedMeta } from "./config.js";
import type { ManifestSource } from "./ManifestSource.js";
import { mergeApiModels } from "./merge-models.js";
import { resolveOgCacheSalt, writeGeneratedOgImage } from "./og-image.js";
import { scrubDeclarationMapsUnder } from "./scrub-declaration-maps.js";
import { resolvePortableTsconfig } from "./tsconfig-resolver.js";
import { writeTsdocConfig } from "./tsdoc-config.js";
import type { TsdoctorMetaOptions } from "./tsdoctor-config.js";
import type { ManifestRepository, ManifestTarget } from "./tsdoctor-manifest.js";
import { composeTsdoctorManifest, ogImageInfoOf } from "./tsdoctor-manifest.js";

function unscopedName(name: string): string {
	const slash = name.lastIndexOf("/");
	return slash >= 0 ? name.slice(slash + 1) : name;
}

/** Normalize the manifest's `repository` (string shorthand or object) to the composer's shape. */
function manifestRepositoryOf(value: unknown): ManifestRepository | undefined {
	if (typeof value === "string") return value.length > 0 ? { url: value } : undefined;
	if (typeof value === "object" && value !== null && "url" in value && typeof value.url === "string") {
		const directory = "directory" in value && typeof value.directory === "string" ? value.directory : undefined;
		return { url: value.url, ...(directory !== undefined ? { directory } : {}) };
	}
	return undefined;
}

/** @public */
export interface GenerateMetaOptions {
	readonly cwd: string;
	readonly packageName: string;
	/** Resolved tsconfig (from writeResolvedTsconfig) for the api-extractor compiler. */
	readonly tsconfigPath: string;
	/** Directory holding the tsdown-emitted per-file .d.ts (e.g. dist/dev/pkg). */
	readonly dtsDir: string;
	/**
	 * Per-module declarations dir used ONLY for a second, diagnostics-only API Extractor run that
	 * resolves accurate per-file source locations. The shipped api-model is still produced from
	 * `dtsDir` (the bundled dts), so it is unchanged. When omitted or equal to `dtsDir`, a single
	 * run over `dtsDir` produces both model and diagnostics (legacy behavior).
	 */
	readonly aeInputDir?: string | undefined;
	/** Map of entry name to the .d.ts basename (without extension) inside dtsDir. */
	readonly entries: Record<string, string>;
	/** Map of entry name to its export path (".", "./sub"). */
	readonly exportPaths: Record<string, string>;
	/** Where to write the meta bundle (.api.json + package.json + tsconfig.json). */
	readonly outMetaDir: string;
	/** Directories (relative to cwd) to copy the meta bundle into. */
	readonly localPaths: ReadonlyArray<string>;
	readonly tsdoc: NormalizedMeta["tsdoc"];
	/**
	 * Optional transform applied to the bundle `package.json` (read from `dtsDir`) before it is
	 * written to `outMetaDir` and copied into `localPaths`. Used for the optimistic next-version
	 * rewrite. When omitted, the package.json is copied verbatim.
	 */
	readonly manifestTransform?: ((pkg: Record<string, unknown>) => Record<string, unknown>) | undefined;
	/** When set, API Extractor warnings/errors are routed here (and suppressed from console). */
	readonly onMessage?: ((entry: import("../report/collector.js").DiagnosticInput) => void) | undefined;
	/** When true (CI), forgotten exports become a hard build error. */
	readonly ci?: boolean | undefined;
	/** When set, messages matched by `suppressWarnings` are routed here for accounting. */
	readonly onSuppressed?: ((entry: import("../report/collector.js").DiagnosticInput) => void) | undefined;
	/**
	 * The `tsdoctor.json` sidecar inputs: the config tier, the two source tiers, and the targets bound
	 * to this group (registries derive from them). Omitted means no sidecar and no Open Graph image.
	 */
	readonly tsdoctor?:
		| {
				readonly config: TsdoctorMetaOptions | undefined;
				readonly leaf: ManifestSource | undefined;
				readonly project: ManifestSource | undefined;
				readonly targets: ReadonlyArray<ManifestTarget>;
		  }
		| undefined;
}

/** @public */
export interface MetaResult {
	readonly apiJsonPath: string;
	readonly apiJsonFilename: string;
}

/**
 * Generate the api-model meta bundle from already-emitted .d.ts. Writes tsdoc.json (idempotent),
 * runs the extractor per entry, merges if needed, and writes the "virtual TS env" trio to
 * outMetaDir (`<unscoped>.api.json` + the final `package.json` + a portable `tsconfig.json`),
 * copying that trio into each localPaths dir. The api-extractor `tsdoc-metadata.json` is a
 * published-package artifact and is written into `dtsDir` (the built pkg/), not the meta bundle.
 * @public
 */
export async function generateMeta(options: GenerateMetaOptions): Promise<MetaResult> {
	const {
		cwd,
		packageName,
		tsconfigPath,
		dtsDir,
		entries,
		exportPaths,
		outMetaDir,
		localPaths,
		tsdoc,
		manifestTransform,
		onMessage,
		ci,
		onSuppressed,
	} = options;
	const aeInputDir = options.aeInputDir ?? dtsDir;
	const splitDiagnostics = aeInputDir !== dtsDir;
	const tsdocConfigPath = writeTsdocConfig(cwd, tsdoc);
	const packageJsonPath = join(cwd, "package.json");

	mkdirSync(outMetaDir, { recursive: true });
	const apiJsonFilename = `${unscopedName(packageName)}.api.json`;
	// tsdoc-metadata.json is a published-package artifact (TSDoc tooling reads it from the package
	// root), so emit it into the built pkg dir rather than the shiki/Twoslash meta bundle.
	const tsdocMetadataPath = join(dtsDir, "tsdoc-metadata.json");

	const entryNames = Object.keys(entries);
	const perEntryModels = new Map<string, Record<string, unknown>>();
	// Intermediate per-entry models are working files; they must not leak into the meta bundle (outMetaDir ships for the npm target).
	const intermediateApiJsons: string[] = [];
	let mainEntryDidTsdocMetadata = false;
	// Identity key for the rollup-only-fatal dedup: code + text. Keyed on both so a same-text but
	// different-category message cannot collide, and only CI-fatal Run B entries are recorded (see below).
	const diagnosticKey = (e: import("../report/collector.js").DiagnosticInput): string => `${e.code ?? ""}\0${e.text}`;
	// A copy with the unreliable rollup `file`/`line`/`column` dropped — the bundled-rollup run's positions
	// point into the rolled-up .d.ts, not the source, so they are worse than no location.
	const stripLocation = (
		e: import("../report/collector.js").DiagnosticInput,
	): import("../report/collector.js").DiagnosticInput => ({
		source: e.source,
		level: e.level,
		text: e.text,
		...(e.code !== undefined ? { code: e.code } : {}),
		...(e.ciFatal !== undefined ? { ciFatal: e.ciFatal } : {}),
	});
	// An entry's package-relative export path (".", "./sub"); the fallback matches how entries are named.
	const exportPathFor = (entryName: string): string =>
		exportPaths[entryName] ?? (entryName === "index" ? "." : `./${entryName}`);
	// Run B only (#771): map every own export specifier to its per-module declarations file so a self-name
	// import in an emitted .d.ts resolves to the BUILT declarations, not the source manifest's `exports`.
	const selfReferencePaths: Record<string, ReadonlyArray<string>> = {};
	if (splitDiagnostics) {
		for (const name of entryNames) {
			const exportPath = exportPathFor(name);
			const specifier = exportPath === "." ? packageName : packageName + exportPath.slice(1);
			selfReferencePaths[specifier] = [join(aeInputDir, `${entries[name]}.d.ts`)];
		}
	}
	// API Extractor reads the `.d.ts.map` beside every input it analyzes and crashes (EISDIR) on a
	// source-less mapping segment (#817). Scrub both inputs once, before any run: the bundled dts
	// Run A models and the per-module declarations Run B reads.
	scrubDeclarationMapsUnder(dtsDir);
	if (splitDiagnostics) scrubDeclarationMapsUnder(aeInputDir);
	for (const entryName of entryNames) {
		const modelEntryDts = join(dtsDir, `${entries[entryName]}.d.ts`);
		// Entry names can contain path separators (e.g. "foo/index", "bin/cli"); flatten so the
		// intermediate working file stays directly under outMetaDir rather than a missing subdir.
		const safeEntry = entryName.replace(/[\\/]/g, "__");
		const perEntryApiJson = join(outMetaDir, `${safeEntry}.entry.api.json`);
		intermediateApiJsons.push(perEntryApiJson);
		const isMain = exportPathFor(entryName) === ".";
		// Run A — the model. Reads the bundled dts so the shipped .api.json is unchanged. When we will
		// re-run for diagnostics, this run's (wrong-location) diagnostics are normally silenced, since
		// Run B re-derives accurate locations. CI-fatal escalation stays here: a forgotten export corrupts
		// THIS run's model, so it must fail the build on CI.
		//
		// The rollup-only nudge: a CI-fatal message (ae-forgotten-export) can exist ONLY in the bundled
		// rollup — an external type inlined into the bundled .d.ts can drag in symbols the entry point does
		// not export, while the per-module dts (Run B's input) keeps that package an external import and
		// never sees it. That makes a local build look clean while CI fails hard. Locally (ci !== true)
		// capture Run A's CI-fatal messages and, after Run B, surface the ones Run B did not also report —
		// location stripped, since the rollup line is wrong — so the local build nudges instead of passing.
		const captureRollupOnlyFatal = splitDiagnostics && onMessage !== undefined && ci !== true;
		const rollupFatal: import("../report/collector.js").DiagnosticInput[] = [];
		const runBReported = new Set<string>();
		// The same blind spot exists for SUPPRESSED messages (#772): the suppressor absorbs a rollup-only
		// message in Run A, so unless Run A's suppressed entries are captured, one Run B never sees is missing
		// from the report's `suppressed` bucket. Independent of `ci` (a suppressed message is set to None and
		// never makes Run A throw); only needed when a sink exists. Flushed after Run B, location stripped,
		// for entries Run B did not also report as suppressed.
		const captureRollupSuppressed = splitDiagnostics && onSuppressed !== undefined;
		const rollupSuppressed: import("../report/collector.js").DiagnosticInput[] = [];
		const runBSuppressed = new Set<string>();
		// Run A's split-mode message sink. Three shapes:
		//  - non-CI (captureRollupOnlyFatal): buffer ciFatal entries for the post-Run-B dedup + flush.
		//  - CI (ci === true): a rollup-only CI-fatal escalates `ae-forgotten-export` to ERROR here, so Run A
		//    THROWS and Run B never runs — the buffer/flush path cannot fire. Forward error-level diagnostics
		//    straight to the collector (location stripped) BEFORE the throw, otherwise the no-op sink drops
		//    them and the build fails with only an opaque "API Extractor reported N error(s)" and no symbol.
		//  - otherwise: silence (a no-op also marks the message handled so API Extractor prints nothing).
		const runAOnMessage: (entry: import("../report/collector.js").DiagnosticInput) => void = captureRollupOnlyFatal
			? (entry): void => {
					if (entry.ciFatal === true) rollupFatal.push(entry);
				}
			: ci === true && onMessage !== undefined
				? (entry): void => {
						if (entry.level === "error") onMessage(stripLocation(entry));
					}
				: (): void => {};
		// A CI-fatal message makes Run A throw before Run B and the post-Run-B flush below, so flush the
		// suppressed buffer on the way out: a failed build's issues.json still lists what the rules absorbed.
		const flushRollupSuppressedOnThrow = (err: unknown): never => {
			if (onSuppressed !== undefined) for (const entry of rollupSuppressed) onSuppressed(stripLocation(entry));
			throw err;
		};
		try {
			runApiExtractor({
				cwd,
				packageJsonPath,
				entryDtsPath: modelEntryDts,
				tsconfigPath,
				tsdocConfigPath,
				apiJsonPath: perEntryApiJson,
				// Only the main entry emits tsdoc-metadata.json.
				...(isMain && !mainEntryDidTsdocMetadata ? { tsdocMetadataPath } : {}),
				suppressWarnings: tsdoc.suppressWarnings,
				...(ci !== undefined ? { ci } : {}),
				...(splitDiagnostics
					? {
							onMessage: runAOnMessage,
							...(captureRollupSuppressed
								? {
										onSuppressed: (entry: import("../report/collector.js").DiagnosticInput): void => {
											rollupSuppressed.push(entry);
										},
									}
								: {}),
						}
					: {
							...(onMessage !== undefined ? { onMessage } : {}),
							...(onSuppressed !== undefined ? { onSuppressed } : {}),
						}),
			});
		} catch (err) {
			flushRollupSuppressedOnThrow(err);
		}
		// Run B — diagnostics only. Reads the per-module declarations so locations resolve to the true
		// source declaration. No model emitted (emitDocModel:false). Not a CI gate (Run A is); wrapped so
		// a diagnostics-run failure never breaks a build whose model already succeeded.
		if (splitDiagnostics) {
			// When harvesting rollup-only fatals, observe which messages Run B reports so a fatal present in
			// BOTH runs is reported once (with Run B's accurate location), not duplicated by the flush below.
			const runBOnMessage =
				captureRollupOnlyFatal && onMessage !== undefined
					? (entry: import("../report/collector.js").DiagnosticInput): void => {
							// Record only CI-fatal Run B diagnostics for the dedup, so a non-fatal Run B message
							// that happens to share a text cannot suppress a captured Run A CI-fatal.
							if (entry.ciFatal === true) runBReported.add(diagnosticKey(entry));
							onMessage(entry);
						}
					: onMessage;
			try {
				runApiExtractor({
					cwd,
					packageJsonPath,
					entryDtsPath: join(aeInputDir, `${entries[entryName]}.d.ts`),
					tsconfigPath,
					tsdocConfigPath,
					apiJsonPath: perEntryApiJson,
					emitDocModel: false,
					selfReferencePaths,
					suppressWarnings: tsdoc.suppressWarnings,
					...(runBOnMessage !== undefined ? { onMessage: runBOnMessage } : {}),
					...(onSuppressed !== undefined
						? {
								onSuppressed: (entry: import("../report/collector.js").DiagnosticInput): void => {
									runBSuppressed.add(diagnosticKey(entry));
									onSuppressed(entry);
								},
							}
						: {}),
				});
			} catch (err) {
				if (onMessage !== undefined) {
					onMessage({
						source: "api-extractor",
						level: "warn",
						code: "diagnostics-harvest-failed",
						text: `Could not harvest per-module source locations for "${entryName}": ${String(err)}`,
					});
				}
			}
			// Surface CI-fatal messages that exist ONLY in the bundled rollup (Run B never saw them), so a
			// local build nudges about an issue that would fail CI. Strip the unreliable rollup location.
			if (captureRollupOnlyFatal && onMessage !== undefined) {
				for (const entry of rollupFatal) {
					if (runBReported.has(diagnosticKey(entry))) continue;
					onMessage(stripLocation(entry));
				}
			}
			// Likewise for suppressed messages that exist ONLY in the bundled rollup: record them (location
			// stripped) unless Run B already recorded the same message, with its accurate location.
			if (onSuppressed !== undefined) {
				for (const entry of rollupSuppressed) {
					if (runBSuppressed.has(diagnosticKey(entry))) continue;
					onSuppressed(stripLocation(entry));
				}
			}
		}
		if (isMain) mainEntryDidTsdocMetadata = true;
		perEntryModels.set(entryName, JSON.parse(readFileSync(perEntryApiJson, "utf-8")) as Record<string, unknown>);
	}

	// Merge or take the single model.
	const finalModel =
		perEntryModels.size === 1
			? (perEntryModels.values().next().value as Record<string, unknown>)
			: mergeApiModels({ perEntryModels, packageName, exportPaths });

	const apiJsonPath = join(outMetaDir, apiJsonFilename);
	writeFileSync(apiJsonPath, `${JSON.stringify(finalModel, null, 2)}\n`, "utf-8");

	// Remove the per-entry working files now that the final merged model is written.
	for (const intermediate of intermediateApiJsons) rmSync(intermediate, { force: true });

	// The meta bundle is a self-contained virtual TS env for shiki/Twoslash. It carries a portable,
	// derived tsconfig (compilerOptions-only, no absolute paths or emit settings). The portable config
	// is derived from the package's own tsconfig; `tsconfigPath` (the build's resolved api-extractor
	// compile config) is the fallback when there is no own tsconfig.
	// The meta bundle carries the FINAL transformed package.json (from the built pkg dir, not the
	// source manifest). When a manifestTransform is supplied (optimistic next-version rewrite), apply
	// it here so both the bundle and the localPaths copies below see the rewritten manifest.
	const bundlePackageJson = join(outMetaDir, "package.json");
	const builtPkg = JSON.parse(readFileSync(join(dtsDir, "package.json"), "utf-8")) as Record<string, unknown>;
	const finalPkg = manifestTransform ? manifestTransform(builtPkg) : builtPkg;
	writeFileSync(bundlePackageJson, `${JSON.stringify(finalPkg, null, 2)}\n`, "utf-8");

	const bundleTsconfig = join(outMetaDir, "tsconfig.json");
	const portableTsconfig = resolvePortableTsconfig(cwd, tsconfigPath);
	writeFileSync(bundleTsconfig, `${JSON.stringify(portableTsconfig, null, 2)}\n`, "utf-8");

	// Layer 3: the tsdoctor.json sidecar. Written only when there is something to say, through the
	// manifest package's encoder so the file is by construction what a reader decodes. The generated
	// Open Graph image (when configured) is rendered first so the manifest can list it.
	// The sidecar and its image are the bundle's only CONDITIONAL members, so a previous build's copies
	// are removed first: a package that drops its tsdoctor.json or its generator must stop advertising
	// the identity and og:image it no longer produces, in the meta dir and in every localPaths copy.
	rmSync(join(outMetaDir, TSDOCTOR_MANIFEST_FILENAME), { force: true });
	rmSync(join(outMetaDir, "og"), { recursive: true, force: true });
	let manifestPath: string | undefined;
	let generatedImageRelative: string | undefined;
	if (options.tsdoctor !== undefined) {
		const composeInput = {
			config: options.tsdoctor.config,
			leaf: options.tsdoctor.leaf,
			project: options.tsdoctor.project,
			packageName,
			isPrivate: finalPkg.private === true,
			targets: options.tsdoctor.targets,
			generatedImage: undefined as OpenGraphImage | undefined,
			repository: manifestRepositoryOf(finalPkg.repository),
		};
		const generate = options.tsdoctor.config?.openGraph?.generate;
		if (generate !== undefined) {
			// The cache lives outside the meta dir, so the rmSync above clears only the output copy.
			const cacheSalt = resolveOgCacheSalt(generate, options.tsdoctor.config?.openGraph?.cacheSalt);
			const generated = await writeGeneratedOgImage({
				generate,
				info: ogImageInfoOf({ ...composeInput, version: String(finalPkg.version ?? "0.0.0") }),
				outMetaDir,
				unscopedName: unscopedName(packageName),
				...(cacheSalt === undefined
					? {}
					: { cache: { directory: join(cwd, "node_modules", ".cache", "tsdown-plugins", "og"), salt: cacheSalt } }),
			});
			composeInput.generatedImage = generated;
			generatedImageRelative = generated.path;
		}
		const manifest = composeTsdoctorManifest(composeInput);
		if (manifest !== undefined) {
			const path = join(outMetaDir, TSDOCTOR_MANIFEST_FILENAME);
			try {
				const encoded = await Effect.runPromise(encodeBundleManifest(manifest));
				writeFileSync(path, `${JSON.stringify(encoded, null, 2)}\n`, "utf-8");
			} catch (cause) {
				// Same contract as the image: an encode or disk failure is named in issues.json, not raw.
				throw new TsdoctorEmitError({ packageName, path, cause });
			}
			manifestPath = path;
		}
	}

	// Copy the trio into each localPaths dir (api.json + package.json + tsconfig.json), plus the
	// sidecar and its generated image when they exist.
	for (const localPath of localPaths) {
		const dest = join(cwd, localPath);
		mkdirSync(dest, { recursive: true });
		copyFileSync(apiJsonPath, join(dest, apiJsonFilename));
		copyFileSync(bundlePackageJson, join(dest, "package.json"));
		copyFileSync(bundleTsconfig, join(dest, "tsconfig.json"));
		if (manifestPath !== undefined) copyFileSync(manifestPath, join(dest, TSDOCTOR_MANIFEST_FILENAME));
		else rmSync(join(dest, TSDOCTOR_MANIFEST_FILENAME), { force: true });
		rmSync(join(dest, "og"), { recursive: true, force: true });
		if (generatedImageRelative !== undefined) {
			mkdirSync(join(dest, "og"), { recursive: true });
			copyFileSync(join(outMetaDir, generatedImageRelative), join(dest, generatedImageRelative));
		}
	}

	return { apiJsonPath, apiJsonFilename };
}
