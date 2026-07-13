// The string↔numeric enum codec — PURE DATA, per R1.6 (task-4 reference
// table). Every table is transcribed from R1.6 verbatim, in R1.6's own row
// order: an alias immediately precedes the canonical spelling it collapses
// to, and the reverse (numeric→canonical string) map is built by iterating
// each family's rows in that same order and always overwriting on a
// duplicate value — so the LAST row listed for a given numeric value wins as
// canonical. That single rule reproduces every alias/canonical pairing R1.6
// documents (es6→es2015, node→node10) with no per-family special-casing.
//
// Zero `typescript` imports, including `import type` — Task 2's
// `CompilerOptions` is consumed type-only, and every value here is a plain
// map/Option lookup. No Schema: this module does no validation, only lossless
// numeric↔string data movement for values a schema already validated
// upstream (`CompilerOptions.ts`'s case-insensitive decode normalizes casing
// before a value ever reaches this codec).
//
// lib encode form (`encodeCompilerOptions`): emits the file-name form
// (`lib.esnext.d.ts`), NOT the plain short name. Settled at rung 2
// (existence/signature) against the installed `typescript@6.0.3` +
// `@typescript/vfs@1.6.4` (both under node_modules/.pnpm, 2026-07-13):
//
//   - `typescript@6.0.3`'s `Program` construction (`typescript.js:129392`,
//     `pathForLibFile`) resolves each `options.lib` entry with
//     `combinePaths(defaultLibraryPath, libFileName)` — i.e. it treats the
//     entry as a literal file name and joins it directly onto the lib
//     directory. A short name like "esnext" would resolve to a
//     nonexistent "<libdir>/esnext" path; only "lib.esnext.d.ts" resolves
//     to the real file. `@effected/ts-vfs`'s `TsEnvironment.make` hands
//     `options.compilerOptions` straight to `@typescript/vfs`'s
//     `createVirtualTypeScriptEnvironment`, which hands it straight to
//     `ts.createProgram` — so this IS the form that reaches the real
//     compiler.
//   - `@typescript/vfs@1.6.4`'s OWN `knownLibFilesForCompilerOptions`
//     helper (used by `createDefaultMapFromNodeModules`, which
//     `TsEnvironment.make` also calls) separately expects the short form
//     for ITS OWN over-inclusive cut-index heuristic — but that helper's
//     doc comment says it "will return a bit more than necessary", so it
//     tolerates the mismatch by over-including rather than under-including
//     when handed the file-name form. The `Program`-level requirement
//     above is the one with no tolerance for the wrong form.
//   - This matches the task brief's own worked example verbatim:
//     `encodeCompilerOptions({ target: "es2023", strict: true, lib: ["esnext"] })`
//     → `{ target: 10, strict: true, lib: ["lib.esnext.d.ts"] }`.

import { Option } from "effect";
import type { CompilerOptions } from "./CompilerOptions.js";

/**
 * The nine `compilerOptions` / `watchOptions` enum families this codec knows,
 * per R1.6.
 *
 * @public
 */
export type EnumFamily =
	| "target"
	| "module"
	| "moduleResolution"
	| "jsx"
	| "newLine"
	| "moduleDetection"
	| "watchFile"
	| "watchDirectory"
	| "fallbackPolling";

/** One family's forward (string→number, aliases included) and reverse (number→canonical string) maps. */
interface FamilyTable {
	readonly forward: ReadonlyMap<string, number>;
	readonly reverse: ReadonlyMap<number, string>;
}

/**
 * Builds a family's forward/reverse maps from its R1.6 row order. The
 * reverse map overwrites on every duplicate value, so the last-listed name
 * for a value is canonical — exactly R1.6's alias/canonical rule.
 */
const buildTable = (rows: ReadonlyArray<readonly [name: string, value: number]>): FamilyTable => {
	const forward = new Map<string, number>();
	const reverse = new Map<number, string>();
	for (const [name, value] of rows) {
		forward.set(name, value);
		reverse.set(value, name);
	}
	return { forward, reverse };
};

// ── R1.6 tables, transcribed verbatim in row order ───────────────────────

/** ScriptTarget. Decode-only 0=es3 and 100=JSON have no forward string and are deliberately omitted. */
const TARGET = buildTable([
	["es5", 1],
	["es6", 2],
	["es2015", 2],
	["es2016", 3],
	["es2017", 4],
	["es2018", 5],
	["es2019", 6],
	["es2020", 7],
	["es2021", 8],
	["es2022", 9],
	["es2023", 10],
	["es2024", 11],
	["es2025", 12],
	["esnext", 99],
]);

/** ModuleKind. */
const MODULE = buildTable([
	["none", 0],
	["commonjs", 1],
	["amd", 2],
	["umd", 3],
	["system", 4],
	["es6", 5],
	["es2015", 5],
	["es2020", 6],
	["es2022", 7],
	["esnext", 99],
	["node16", 100],
	["node18", 101],
	["node20", 102],
	["nodenext", 199],
	["preserve", 200],
]);

/** ModuleResolutionKind. */
const MODULE_RESOLUTION = buildTable([
	["classic", 1],
	["node", 2],
	["node10", 2],
	["node16", 3],
	["nodenext", 99],
	["bundler", 100],
]);

/** JsxEmit. 0=none exists numerically but has no tsconfig string, so it is omitted. */
const JSX = buildTable([
	["preserve", 1],
	["react", 2],
	["react-native", 3],
	["react-jsx", 4],
	["react-jsxdev", 5],
]);

/** NewLineKind. */
const NEW_LINE = buildTable([
	["crlf", 0],
	["lf", 1],
]);

/** ModuleDetectionKind. */
const MODULE_DETECTION = buildTable([
	["legacy", 1],
	["auto", 2],
	["force", 3],
]);

/** WatchFileKind. */
const WATCH_FILE = buildTable([
	["fixedpollinginterval", 0],
	["prioritypollinginterval", 1],
	["dynamicprioritypolling", 2],
	["fixedchunksizepolling", 3],
	["usefsevents", 4],
	["usefseventsonparentdirectory", 5],
]);

/** WatchDirectoryKind. */
const WATCH_DIRECTORY = buildTable([
	["usefsevents", 0],
	["fixedpollinginterval", 1],
	["dynamicprioritypolling", 2],
	["fixedchunksizepolling", 3],
]);

/** PollingWatchKind (compilerOptions/watchOptions key `fallbackPolling`). */
const FALLBACK_POLLING = buildTable([
	["fixedinterval", 0],
	["priorityinterval", 1],
	["dynamicpriority", 2],
	["fixedchunksize", 3],
]);

const TABLES: Record<EnumFamily, FamilyTable> = {
	target: TARGET,
	module: MODULE,
	moduleResolution: MODULE_RESOLUTION,
	jsx: JSX,
	newLine: NEW_LINE,
	moduleDetection: MODULE_DETECTION,
	watchFile: WATCH_FILE,
	watchDirectory: WATCH_DIRECTORY,
	fallbackPolling: FALLBACK_POLLING,
};

/**
 * Encodes a family's canonical (or alias) string spelling to its numeric
 * form. `Option.none()` for a string with no table entry — never guessed.
 *
 * @public
 */
const encode = (family: EnumFamily, value: string): Option.Option<number> =>
	Option.fromNullishOr(TABLES[family].forward.get(value));

/**
 * Decodes a family's numeric value to its canonical string spelling.
 * `Option.none()` for a numeric value with no table entry (a future TS enum
 * member) — never guessed.
 *
 * @public
 */
const decode = (family: EnumFamily, value: number): Option.Option<string> =>
	Option.fromNullishOr(TABLES[family].reverse.get(value));

/**
 * Normalizes any spelling of a `lib` reference — the plain short name
 * (`esnext`), the on-disk file name (`lib.esnext.d.ts`), or an absolute path
 * to one (`/…/typescript/lib/lib.dom.iterable.d.ts`) — to the canonical
 * lowercase short name (`esnext`, `dom.iterable`). Strips a leading
 * directory, the `lib.` prefix and the `.d.ts` suffix; idempotent on an
 * already-short name.
 *
 * @public
 */
const normalizeLibReference = (lib: string): string => {
	const base = lib.split("/").pop() ?? lib;
	const withoutPrefix = base.startsWith("lib.") ? base.slice(4) : base;
	return withoutPrefix.endsWith(".d.ts") ? withoutPrefix.slice(0, -5) : withoutPrefix;
};

/** `compilerOptions` keys whose values are one of the R1.6 enum families. */
const COMPILER_OPTION_ENUM_KEYS: ReadonlyArray<readonly [key: string, family: EnumFamily]> = [
	["target", "target"],
	["module", "module"],
	["moduleResolution", "moduleResolution"],
	["jsx", "jsx"],
	["newLine", "newLine"],
	["moduleDetection", "moduleDetection"],
];

/**
 * Encodes a decoded `compilerOptions` object into the numeric-enum-shaped
 * form `ts.CompilerOptions` (and `@typescript/vfs`'s `TsEnvironment`) expect:
 * every R1.6 enum family becomes its numeric value, and `lib` entries become
 * the file-name form (`lib.esnext.d.ts`) — see the module banner for the
 * evidence. Every other key (booleans, strings, arrays, unknown passthrough
 * keys) is copied through untouched.
 *
 * @public
 */
const encodeCompilerOptions = (options: CompilerOptions.Type): Record<string, unknown> => {
	const source: Readonly<Record<string, unknown>> = options;
	const result: Record<string, unknown> = { ...source };

	for (const [key, family] of COMPILER_OPTION_ENUM_KEYS) {
		const value = source[key];
		if (typeof value === "string") {
			const encoded = encode(family, value);
			if (Option.isSome(encoded)) result[key] = encoded.value;
		}
	}

	const lib = source.lib;
	if (Array.isArray(lib)) {
		result.lib = lib.map((entry) => (typeof entry === "string" ? `lib.${normalizeLibReference(entry)}.d.ts` : entry));
	}

	return result;
};

/**
 * Decodes a numeric-enum-shaped `compilerOptions` object (as produced by
 * {@link (TsEnumCodec:variable).encodeCompilerOptions} or read off a live
 * `ts.CompilerOptions`) back into the string-enum shape this package's
 * schemas use: every R1.6 enum family becomes its canonical string, and
 * `lib` entries become the short form. A numeric value with no table entry —
 * a future TS enum member — is left as-is (passthrough, never an error) —
 * which is why the return type stays the wider `Record<string, unknown>`
 * rather than {@link (CompilerOptions:variable).Type}: an unmappable
 * passthrough value would violate that narrower type's contract. Every other
 * key is copied through untouched.
 *
 * @public
 */
const decodeCompilerOptions = (numeric: Readonly<Record<string, unknown>>): Record<string, unknown> => {
	const result: Record<string, unknown> = { ...numeric };

	for (const [key, family] of COMPILER_OPTION_ENUM_KEYS) {
		const value = numeric[key];
		if (typeof value === "number") {
			const decoded = decode(family, value);
			if (Option.isSome(decoded)) result[key] = decoded.value;
		}
	}

	const lib = numeric.lib;
	if (Array.isArray(lib)) {
		result.lib = lib.map((entry) => (typeof entry === "string" ? normalizeLibReference(entry) : entry));
	}

	return result;
};

/**
 * The string↔numeric enum codec for `compilerOptions` / `watchOptions`
 * families, per R1.6. Plain data: every lookup is a synchronous map read
 * returning `Option.Option`, never a thrown error.
 *
 * @public
 */
export const TsEnumCodec = {
	encode,
	decode,
	normalizeLibReference,
	encodeCompilerOptions,
	decodeCompilerOptions,
} as const;
