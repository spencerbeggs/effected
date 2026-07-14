// The portable-tsconfig filter — projects a `ResolvedTsconfig` (Task 5) or a
// bare `CompilerOptions.Type` (Task 2) down to the small, machine-independent
// slice of compilerOptions that a virtual TypeScript environment (Twoslash,
// API Extractor, an in-memory language service) can safely reuse: no absolute
// paths, no emit artifacts, no file-selection surface.
//
// This module is already string-level (CompilerOptions decodes TS's numeric
// enums to canonical lowercase strings — see CompilerOptions.ts and
// TsEnumCodec.ts), so unlike the numeric-enum-juggling prior art it
// generalizes from (savvy-web/systems' tsdown-plugins TsconfigResolver), the
// filter here is exactly three things: a key allow-list, two forced flags,
// and a `$schema` stamp. No enum conversion is needed or performed.
//
// ALLOW-LIST, NOT DENY-LIST (per the task brief): only the keys named below
// ever reach the output. An option this package does not yet know about —
// including every unknown/future passthrough key `CompilerOptions.Type`
// preserves for forward tolerance — is silently dropped here. A portable
// config is deliberately a strict subset of "everything the source config
// said"; growing it is an explicit, reviewed addition to the allow-list
// below, never an accident of "we didn't exclude it."

import type { CompilerOptions } from "./CompilerOptions.js";
import type { ResolvedTsconfig } from "./ResolvedTsconfig.js";

const TSCONFIG_SCHEMA_URL = "https://json.schemastore.org/tsconfig";

// ── The allow-list (R1.2/R1.3/R1.4 classification) ──────────────────────────
//
// Preserved = affects what the type checker accepts/reports, independent of
// any file path or emitted artifact. Excluded = emit destination, absolute/
// machine-specific paths, file selection, build/project-reference
// orchestration, or CLI diagnostics formatting — none of which a virtual
// environment driving its own file set and its own emit (or non-emit) should
// inherit from the source config.
//
// Three groups below are judgment calls documented for review (see the task
// report for the full rationale): `importHelpers` / `downlevelIteration` /
// `preserveConstEnums` are carried even though they shape emitted JS, because
// they were in the prior art's PRESERVED_BOOLEAN_OPTIONS and a Twoslash-style
// virtual environment can still execute emitted code; `newLine` and
// `maxNodeModuleJsDepth` are excluded despite touching neither path nor emit
// destination, because the former is pure output formatting and the latter is
// an obscure checking-depth tuning knob, not a type-semantics switch a
// portable config needs to travel with.

/**
 * Boolean `compilerOptions` preserved in a {@link (PortableTsconfig:interface)}: the
 * strict family, module/interop semantics, checking-depth and lib controls,
 * and language-feature switches — every one type-checking behavior, none of
 * them naming a path or producing a build artifact.
 */
const PRESERVED_BOOLEAN_OPTIONS = [
	// strict family
	"strict",
	"noImplicitAny",
	"strictNullChecks",
	"strictFunctionTypes",
	"strictBindCallApply",
	"strictPropertyInitialization",
	"strictBuiltinIteratorReturn",
	"noImplicitThis",
	"useUnknownInCatchVariables",
	"alwaysStrict",
	"noUnusedLocals",
	"noUnusedParameters",
	"exactOptionalPropertyTypes",
	"noImplicitReturns",
	"noFallthroughCasesInSwitch",
	"noUncheckedIndexedAccess",
	"noImplicitOverride",
	"noPropertyAccessFromIndexSignature",
	"allowUnusedLabels",
	"allowUnreachableCode",
	"noUncheckedSideEffectImports",
	// module / interop semantics
	"allowJs",
	"checkJs",
	"resolveJsonModule",
	"allowArbitraryExtensions",
	"allowImportingTsExtensions",
	"rewriteRelativeImportExtensions",
	"resolvePackageJsonExports",
	"resolvePackageJsonImports",
	"allowSyntheticDefaultImports",
	"esModuleInterop",
	"preserveSymlinks",
	"allowUmdGlobalAccess",
	"verbatimModuleSyntax",
	"isolatedModules",
	"isolatedDeclarations",
	"erasableSyntaxOnly",
	"forceConsistentCasingInFileNames",
	"useDefineForClassFields",
	// checking-depth / lib controls
	"noLib",
	"skipDefaultLibCheck",
	"skipLibCheck",
	"noCheck",
	// language-feature / decorator semantics
	"experimentalDecorators",
	"emitDecoratorMetadata",
	// carried for virtual-JS-execution environments (judgment call — see above)
	"importHelpers",
	"downlevelIteration",
	"preserveConstEnums",
] as const;

/**
 * Enum-valued `compilerOptions` preserved in a {@link (PortableTsconfig:interface)}: the
 * target/module/moduleResolution/jsx/lib family plus `moduleDetection` and
 * `ignoreDeprecations`. `newLine` is deliberately excluded — pure emit
 * formatting, no bearing on type-checking behavior.
 */
const PRESERVED_ENUM_OPTIONS = [
	"target",
	"module",
	"moduleResolution",
	"jsx",
	"moduleDetection",
	"lib",
	"ignoreDeprecations",
] as const;

/**
 * Plain-string `compilerOptions` preserved in a {@link (PortableTsconfig:interface)}: the
 * jsx factory/namespace family. None of these name a filesystem path.
 */
const PRESERVED_STRING_OPTIONS = ["jsxFactory", "jsxFragmentFactory", "jsxImportSource", "reactNamespace"] as const;

const PRESERVED_OPTIONS: ReadonlyArray<string> = [
	...PRESERVED_BOOLEAN_OPTIONS,
	...PRESERVED_ENUM_OPTIONS,
	...PRESERVED_STRING_OPTIONS,
];

// ── Structural discrimination (ResolvedTsconfig | CompilerOptions.Type) ─────

/**
 * A `ResolvedTsconfig` carries a string `configPath`, an array `extendedPaths`
 * AND an object `compilerOptions`; a bare `CompilerOptions.Type` never carries
 * all three. Every conjunct is required — `CompilerOptions.Type`'s passthrough
 * index signature tolerates any unrecognized key, so a hostile config file can
 * plant a string `configPath` and even an array `extendedPaths` as passthrough
 * keys on a bare options bag (reachable from forward tolerance). The
 * `compilerOptions` conjunct is what makes the discrimination TOTAL: `make`
 * only branches into `input.compilerOptions` when that value is a non-null
 * object it can safely index, so no crafted bag can steer the filter into a
 * `TypeError` at the `source[key]` loop below. (A bag that fakes all three is
 * then read exactly like a `ResolvedTsconfig` — its `compilerOptions` object
 * is filtered, which is the safe outcome.)
 */
const isResolvedTsconfig = (input: ResolvedTsconfig | CompilerOptions.Type): input is ResolvedTsconfig =>
	typeof (input as { readonly configPath?: unknown }).configPath === "string" &&
	Array.isArray((input as { readonly extendedPaths?: unknown }).extendedPaths) &&
	typeof (input as { readonly compilerOptions?: unknown }).compilerOptions === "object" &&
	(input as { readonly compilerOptions?: unknown }).compilerOptions !== null;

// ── The filter ────────────────────────────────────────────────────────────

/**
 * A portable, JSON-serializable tsconfig.json (compilerOptions-only), for
 * virtual TypeScript environments that control their own file paths and emit
 * settings externally. Carries only knowably-portable options: no absolute or
 * machine-specific paths, and no emit or file-selection surface.
 *
 * @public
 */
export interface PortableTsconfig {
	/** The tsconfig JSON Schema URL, stamped for IDE support. */
	readonly $schema: "https://json.schemastore.org/tsconfig";
	/** The allow-listed, forced-flag-applied compiler options. */
	readonly compilerOptions: Record<string, unknown>;
}

/**
 * Project a {@link (ResolvedTsconfig:interface)} or a bare
 * `CompilerOptions.Type` down to a {@link (PortableTsconfig:interface)}: copy
 * only the allow-listed type-semantics options, force `composite: false` and
 * `noEmit: true` regardless of what the source declared, and stamp `$schema`.
 * Every other key — including every unknown passthrough key the source
 * preserved for forward tolerance — is dropped; this is an allow-list, not a
 * deny-list, so an option this package does not yet classify never leaks onto
 * the portable shape by accident.
 */
const make = (input: ResolvedTsconfig | CompilerOptions.Type): PortableTsconfig => {
	const source: Record<string, unknown> = isResolvedTsconfig(input) ? input.compilerOptions : input;
	const compilerOptions: Record<string, unknown> = {};
	for (const key of PRESERVED_OPTIONS) {
		const value = source[key];
		if (value !== undefined) compilerOptions[key] = value;
	}
	compilerOptions.composite = false;
	compilerOptions.noEmit = true;
	return { $schema: TSCONFIG_SCHEMA_URL, compilerOptions };
};

/**
 * The portable-tsconfig filter: {@link (PortableTsconfig:variable).make}
 * narrows a resolved or bare compiler-options object to the allow-listed,
 * machine-independent subset described on {@link (PortableTsconfig:interface)}.
 *
 * @public
 */
export const PortableTsconfig = { make } as const;
