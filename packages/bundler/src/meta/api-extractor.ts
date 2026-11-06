import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { TsconfigLoaderSync } from "@effected/tsconfig-json";
import type { ExtractorMessage } from "@microsoft/api-extractor";
import { Extractor, ExtractorConfig, ExtractorLogLevel } from "@microsoft/api-extractor";
import { TSDocConfigFile } from "@microsoft/tsdoc-config";
import { MetaGenerationError } from "../errors.js";
import type { DiagnosticInput } from "../report/collector.js";
import { tsconfigSyncOptions } from "../tsconfig/sync-options.js";
import type { WarningSuppressionRule } from "./config.js";
import { createMessageSuppressor } from "./message-suppressor.js";

export interface RunApiExtractorOptions {
	readonly cwd: string;
	readonly packageJsonPath: string;
	/** The entry's .d.ts (api-extractor follows imports from here). */
	readonly entryDtsPath: string;
	/** Resolved tsconfig (absolute paths) for the api-extractor compiler. */
	readonly tsconfigPath: string;
	/** The tsdoc.json the extractor should load (from writeTsdocConfig). */
	readonly tsdocConfigPath: string;
	/** Where to write the per-entry .api.json. */
	readonly apiJsonPath: string;
	/** Where to write tsdoc-metadata.json (only the main entry needs it). */
	readonly tsdocMetadataPath?: string | undefined;
	readonly suppressWarnings: ReadonlyArray<WarningSuppressionRule>;
	/** When set, non-suppressed warnings/errors are routed here and marked handled (no console output). */
	readonly onMessage?: ((entry: DiagnosticInput) => void) | undefined;
	/** When true (CI), ae-forgotten-export is escalated to a hard error that fails the build. */
	readonly ci?: boolean | undefined;
	/** Receives messages matched by `suppressWarnings` (for accounting / --verbose). */
	readonly onSuppressed?: ((entry: DiagnosticInput) => void) | undefined;
	/** When false, the run analyzes + reports diagnostics but writes no api-model (the diagnostics run). Default true. */
	readonly emitDocModel?: boolean | undefined;
	/**
	 * `compilerOptions.paths` mappings (specifier -> declaration files) added to the extractor's derived
	 * tsconfig. Run B passes the package's own export specifiers -> the per-module declarations so a
	 * self-name import inside an emitted `.d.ts` resolves to the BUILT declarations instead of
	 * self-referencing the source manifest's `exports` (raw `.ts`). See systems#771.
	 */
	readonly selfReferencePaths?: Readonly<Record<string, ReadonlyArray<string>>> | undefined;
}

/** messageIds that become a hard build error in CI (they corrupt the .api.json). */
const CI_FATAL_MESSAGE_IDS = new Set<string>(["ae-forgotten-export"]);

/** Options for {@link writeApiExtractorTsconfig}. */
export interface WriteApiExtractorTsconfigOptions {
	/** Absolute package root (only used to locate the `types/*.d.ts` legacy-typings glob). */
	readonly cwd: string;
	/** The resolved compile tsconfig the derived config extends. */
	readonly tsconfigPath: string;
	/** The single entry `.d.ts` this extractor run analyzes. */
	readonly entryDtsPath: string;
	/**
	 * `compilerOptions.paths` entries to add (#771). Merged over the base tsconfig's own `paths` (a
	 * derived-file `paths` REPLACES the inherited one, so the base's are re-emitted). Absent or empty
	 * leaves the output without a `compilerOptions` key.
	 */
	readonly paths?: Readonly<Record<string, ReadonlyArray<string>>> | undefined;
}

/**
 * Derive the extractor-scoped tsconfig for ONE api-extractor run and return its path (#354).
 *
 * The compile tsconfig's `include` covers `src/**` — necessary for the dts-emit pass, poison for
 * the extractor: a hand-authored `src/*.d.ts` shim matched by that glob survives api-extractor's
 * .d.ts root filter, and a self-name import inside it resolves through the SOURCE manifest's
 * `exports` to raw `.ts` sources under `src/`, putting non-declaration files in the Program and
 * firing an unsuppressable `ae-wrong-input-file-type` on every build. The derived config keeps the
 * base's `compilerOptions` (via an absolute-path `extends`) but replaces the input set with exactly
 * what the extractor's Program should hold: the entry `.d.ts` (`files`) plus the `types/*.d.ts`
 * legacy typings — the same effective roots as before minus everything under `src/`.
 *
 * The same failure class has a second route (#771): a self-name import (`import type * as Root from
 * "@scope/pkg"`) inside an emitted per-module `.d.ts` resolves, from a declarations tree with no
 * package.json, via TS package self-reference through the SOURCE manifest's `exports` into raw `.ts`
 * (`ae-wrong-input-file-type`, or an `Unable to follow symbol` crash). Run B therefore supplies `paths`
 * mapping each own export specifier to its declarations file, which wins over self-reference.
 *
 * Best-effort, mirroring `writeDtsEmitTsconfig`: a base that does not exist (e.g. a synthetic test
 * path) gets no variant — the original path is returned unchanged. The filename is deterministic
 * per (pid, base, entry) via a content hash (the two joined paths overflow a filename), so repeated
 * calls within a process overwrite the same file; cross-process temp files are left for the OS to
 * reap, consistent with the other tmpdir tsconfig writers.
 */
export function writeApiExtractorTsconfig(options: WriteApiExtractorTsconfigOptions): string {
	const absBase = isAbsolute(options.tsconfigPath) ? options.tsconfigPath : resolve(options.tsconfigPath);
	if (!existsSync(absBase)) return options.tsconfigPath;
	const entryDts = isAbsolute(options.entryDtsPath) ? options.entryDtsPath : resolve(options.cwd, options.entryDtsPath);
	// `files` wins regardless of the inherited `exclude` (exclude never filters `files`), and the
	// explicit empty-`include` override would be implied — but the legacy-typings glob keeps
	// hand-authored ambient declarations under types/ analyzable, exactly as the base include did.
	const ownPaths = options.paths ?? {};
	const hasPaths = Object.keys(ownPaths).length > 0;
	// A `compilerOptions.paths` here replaces the inherited one, so re-emit the base's (best-effort).
	const cfg = {
		extends: absBase,
		files: [entryDts],
		include: [join(options.cwd, "types/*.d.ts")],
		...(hasPaths ? { compilerOptions: { paths: { ...readBasePaths(absBase), ...ownPaths } } } : {}),
	};
	const hash = createHash("sha256")
		.update(`${absBase}\0${entryDts}${hasPaths ? `\0${JSON.stringify(ownPaths)}` : ""}`)
		.digest("hex")
		.slice(0, 16);
	const path = join(tmpdir(), `tsconfig-api-extractor-${process.pid}-${hash}.json`);
	writeFileSync(path, `${JSON.stringify(cfg, null, "\t")}\n`, "utf-8");
	return path;
}

/**
 * The base tsconfig's effective `compilerOptions.paths`, with every relative target made absolute.
 *
 * A `compilerOptions.paths` in the derived config replaces the inherited one wholesale, so the base's
 * mappings must be re-emitted, and they must keep resolving where they did. TypeScript resolves a
 * relative target against `baseUrl` when one is in effect, and otherwise against the directory of the
 * config that declared `paths`. Re-emitted verbatim from the derived config in the tmpdir, a target such
 * as `./src/*` would resolve under the tmpdir instead. The chain is resolved with the same tsc-parity
 * loader the portable-tsconfig resolver uses (`extends`, JSONC, an absolutized `baseUrl`, `pathsBase`),
 * so `paths` inherited from further up the chain are kept too. Best-effort: a base that cannot be
 * resolved contributes no paths.
 */
function readBasePaths(absBase: string): Record<string, ReadonlyArray<string>> {
	let resolved: ReturnType<typeof TsconfigLoaderSync.resolve>;
	try {
		resolved = TsconfigLoaderSync.resolve(absBase, tsconfigSyncOptions);
	} catch {
		return {};
	}
	const paths = resolved.compilerOptions.paths;
	if (paths === undefined) return {};
	const anchor = resolved.compilerOptions.baseUrl ?? resolved.pathsBase ?? dirname(absBase);
	return Object.fromEntries(
		Object.entries(paths).map(([key, targets]) => [
			key,
			targets.map((target) => (isAbsolute(target) ? target : resolve(anchor, target))),
		]),
	);
}

/**
 * Map an API Extractor message to a collector DiagnosticInput, or undefined if not warn/error.
 *
 * Location (`file`/`line`/`column`) is preserved: diagnostics now come from a per-module declaration
 * run (see generateMeta's two-input split), where each `.d.ts.map` references only its own source, so
 * positions resolve to the true source declaration. Reverts the systems#154 mitigation. See systems#162.
 */
export function mapExtractorMessage(message: ExtractorMessage): DiagnosticInput | undefined {
	const isError = message.logLevel === ExtractorLogLevel.Error;
	const isWarning = message.logLevel === ExtractorLogLevel.Warning;
	if (!isError && !isWarning) return undefined;
	return {
		source: "api-extractor",
		level: isError ? "error" : "warn",
		text: message.text,
		...(message.messageId !== undefined ? { code: message.messageId } : {}),
		...(message.sourceFilePath !== undefined ? { file: message.sourceFilePath } : {}),
		...(message.sourceFileLine !== undefined ? { line: message.sourceFileLine } : {}),
		...(message.sourceFileColumn !== undefined ? { column: message.sourceFileColumn } : {}),
	};
}

/** Run API Extractor over a single entry's .d.ts, writing the .api.json (and optionally tsdoc-metadata.json). Throws on failure. */
export function runApiExtractor(options: RunApiExtractorOptions): void {
	const suppressor = createMessageSuppressor(options.suppressWarnings);
	// api-extractor compiles with its OWN bundled TypeScript (the TS 5/6 JavaScript compiler API it is
	// written against; see rushstack#6033 for the TypeScript 7 port). This package's `typescript` is
	// 7.1+, whose main export is a version stub with no compiler API, so it must NOT be handed over as
	// `typescriptCompilerFolder` — leave the option unset and api-extractor resolves its own dependency.
	const tsdocConfigFile = TSDocConfigFile.loadForFolder(dirname(options.tsdocConfigPath));

	const extractorConfig = ExtractorConfig.prepare({
		configObject: {
			projectFolder: options.cwd,
			mainEntryPointFilePath: options.entryDtsPath,
			enumMemberOrder: "preserve",
			// The extractor gets its own files-scoped tsconfig, never the compile config verbatim — the
			// compile include's src/ globs poison the analysis Program (#354, see writeApiExtractorTsconfig).
			compiler: {
				tsconfigFilePath: writeApiExtractorTsconfig({
					cwd: options.cwd,
					tsconfigPath: options.tsconfigPath,
					entryDtsPath: options.entryDtsPath,
					paths: options.selfReferencePaths,
				}),
			},
			// includeForgottenExports keeps "forgotten" declarations (referenced but not exported) IN the
			// doc model instead of dropping them (api-extractor's default). Without it the synthetic base
			// class TypeScript hoists for Effect class mixins (Schema.Class/Data.TaggedError/Context.Tag/
			// Effect.Service emit `declare const X_base = ...; class X extends X_base {}`) is dropped — its
			// name is not exportable from source, so it is always a forgotten export — leaving the model with
			// a dangling `extends X_base` and an empty class body. Downstream .d.ts reconstruction then loses
			// every field. Inclusion is always on so the model stays complete and reconstructable; the
			// diagnostic severity below is what stays configurable. See rspress-plugin-api-extractor#56.
			docModel:
				options.emitDocModel === false
					? { enabled: false }
					: { enabled: true, apiJsonFilePath: options.apiJsonPath, includeForgottenExports: true },
			...(options.tsdocMetadataPath !== undefined
				? { tsdocMetadata: { enabled: true, tsdocMetadataFilePath: options.tsdocMetadataPath } }
				: {}),
			// We do not want api-extractor to write a rollup .d.ts (tsdown already emitted the dts).
			dtsRollup: { enabled: false },
			apiReport: { enabled: false },
			// Without an api-extractor.json, the MessageRouter's compiler/extractor/tsdoc default rules
			// are all `logLevel: "none"`, so analyzer messages (ae-forgotten-export, ae-missing-release-tag,
			// tsdoc-*) reach messageCallback already silenced and mapExtractorMessage drops them. Route the
			// two actionable categories to "warning" so the diagnostics flow to the collector. Per-package
			// noise is filtered ahead of this via `suppressWarnings`.
			//
			// `compilerMessageReporting` is deliberately left at the "none" default: api-extractor analyzes
			// already-emitted, already-typechecked .d.ts with its own BUNDLED TypeScript, which lags the
			// project's compiler. That skew makes it emit spurious diagnostics against third-party lib types
			// (e.g. "Cannot find name 'Float16Array'" from @types/node) that are noise, not the user's code.
			messages: {
				extractorMessageReporting: {
					default: { logLevel: "warning" },
					// The underscore-prefix convention for `@internal` exports is not used in this
					// monorepo, so silence `ae-internal-missing-underscore` rather than nag on it.
					"ae-internal-missing-underscore": { logLevel: "none" },
					// In CI the CI-fatal messageIds are hard errors. With includeForgottenExports the symbol is
					// no longer dropped from the .api.json, so this escalation is no longer about model
					// corruption — it flags a developer who genuinely forgot to export one of their OWN public
					// symbols, a real API-surface mistake worth failing CI over. Derived from the same
					// CI_FATAL_MESSAGE_IDS set that drives the local `ciFatal` tag, so the nudge and the real
					// escalation cannot drift. Suppression still wins (per-package opt-out) — a suppressed
					// message is set to None in the callback before it can count toward errorCount.
					...(options.ci === true
						? Object.fromEntries([...CI_FATAL_MESSAGE_IDS].map((id) => [id, { logLevel: "error" }]))
						: {}),
				},
				tsdocMessageReporting: { default: { logLevel: "warning" } },
			},
		},
		packageJsonFullPath: options.packageJsonPath,
		configObjectFullPath: undefined,
		tsdocConfigFile,
	} as Parameters<typeof ExtractorConfig.prepare>[0]);

	const result = Extractor.invoke(extractorConfig, {
		localBuild: true,
		showVerboseMessages: false,
		messageCallback: (message: ExtractorMessage): void => {
			// Apply user suppressions first — a suppressed message must not fail CI or warn. Map it
			// BEFORE setting None so the pre-suppression level is captured for the accounting.
			if (suppressor.matches(message.messageId, message.text)) {
				if (options.onSuppressed !== undefined) {
					const entry = mapExtractorMessage(message);
					if (entry !== undefined) options.onSuppressed(entry);
				}
				message.logLevel = ExtractorLogLevel.None;
				message.handled = true;
				return;
			}
			// Silence noisy environment messages that are not actionable here.
			if (message.messageId === "console-compiler-version-notice" || message.messageId === "console-preamble") {
				message.logLevel = ExtractorLogLevel.None;
				message.handled = true;
			}
			// Route remaining warnings/errors to the collector and suppress API Extractor's own
			// console output for them, so they surface only in the unified build log.
			if (options.onMessage !== undefined) {
				const entry = mapExtractorMessage(message);
				if (entry !== undefined) {
					// Locally a CI-fatal message is shown as a warning; tag it so the formatter can nudge.
					const ciFatal =
						options.ci !== true &&
						entry.level === "warn" &&
						entry.code !== undefined &&
						CI_FATAL_MESSAGE_IDS.has(entry.code);
					options.onMessage(ciFatal ? { ...entry, ciFatal: true } : entry);
					message.handled = true;
				}
			}
		},
	});

	if (!result.succeeded) {
		throw new MetaGenerationError({
			entry: options.entryDtsPath,
			reason: `API Extractor reported ${result.errorCount} error(s) and ${result.warningCount} warning(s)`,
		});
	}
}
