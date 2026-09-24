// biome-ignore-all lint/suspicious/noTemplateCurlyInString: the shipped fixtures are source text, and a template substitution inside one is the point
import { GlobSet } from "@effected/glob";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { isIdentifierChar, lex, locate, references, specifierLiterals } from "./internal/sourceText.js";

/**
 * One rule a source file must keep.
 *
 * @remarks
 * `"process"` forbids a read of the global `process`. `"node:process"` forbids
 * importing `node:process` or `process`. `"stdout-write"` forbids a
 * `stdout.write` call on anything. `"console-write"` forbids any reference to
 * the global `console`. `{ forbidImports }` forbids an import whose specifier
 * equals an entry, is a subpath of one, or starts with an entry's text before a
 * trailing `*` (so `"node:*"` and `"@effect/platform*"` are prefixes).
 *
 * @public
 */
export type BoundaryRule =
	| "process"
	| "node:process"
	| "stdout-write"
	| "console-write"
	| { readonly forbidImports: ReadonlyArray<string> };

/**
 * Options for the `process` rule.
 *
 * @public
 */
export interface ReferenceOptions {
	/**
	 * Exact tokens exempt from the `process` rule, each starting at the
	 * reference (`"process.env.MY_CONSTANT"`). `process.env.__PACKAGE_VERSION__`
	 * is always exempt: the bundler substitutes it at build time.
	 */
	readonly ignoreTokens?: ReadonlyArray<string> | undefined;
}

/**
 * A snippet with the verdict one rule must reach on it.
 *
 * @public
 */
export interface BoundaryFixture {
	/** What the snippet exercises. */
	readonly name: string;
	/** The source text. */
	readonly source: string;
	/** The rule it is checked against. */
	readonly rule: BoundaryRule;
	/** Whether that rule must flag it. */
	readonly flagged: boolean;
}

/**
 * One place a source file breaks a {@link BoundaryRule}.
 *
 * @public
 */
export class Offence extends Schema.Class<Offence>("Offence")({
	/** The file, relative to the scanned root, with `/` separators. */
	file: Schema.String,
	/** The 1-based line. */
	line: Schema.Number,
	/** The 1-based column, in UTF-16 code units. */
	column: Schema.Number,
	/** The rule broken. */
	rule: Schema.Literals(["process", "node:process", "stdout-write", "console-write", "forbidImports"]),
	/** What matched: the identifier, the call, or the import specifier. */
	detail: Schema.String,
}) {
	/** `file:line:column rule detail`, the form an assertion message reads best in. */
	get label(): string {
		return `${this.file}:${this.line}:${this.column} ${this.rule} ${this.detail}`;
	}
}

/**
 * What a scan read and found.
 *
 * @public
 */
export class SourceScan extends Schema.Class<SourceScan>("SourceScan")({
	/** Every source file visited, relative to the root with `/` separators, sorted. Assert it is non-empty. */
	files: Schema.Array(Schema.String),
	/** The visited files an `allow` glob exempted from every rule. */
	allowed: Schema.Array(Schema.String),
	/** Every offence, sorted by file, then line, then column. */
	offences: Schema.Array(Offence),
}) {
	/** One `file:line:column rule detail` label per offence: `[]` means clean. */
	get violations(): ReadonlyArray<string> {
		return this.offences.map((offence) => offence.label);
	}
}

/**
 * Options for {@link SourceBoundary.scan}.
 *
 * @public
 */
export interface ScanOptions extends ReferenceOptions {
	/** The directory to scan. */
	readonly root: string;
	/** The rules every non-allowed file must keep. */
	readonly rules: ReadonlyArray<BoundaryRule>;
	/** Globs, relative to `root` with `/` separators, naming files exempt from every rule. */
	readonly allow?: ReadonlyArray<string> | undefined;
	/**
	 * File extensions to scan. Defaults to `.ts`, `.mts`, `.cts`, `.js`,
	 * `.mjs` and `.cjs`; declaration files are always skipped.
	 */
	readonly extensions?: ReadonlyArray<string> | undefined;
}

const DEFAULT_EXTENSIONS: ReadonlyArray<string> = [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"];
const DECLARATION = /\.d\.[cm]?ts$/;
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const EXEMPT: ReadonlyArray<string> = ["process.env.__PACKAGE_VERSION__"];
const STDOUT_WRITE = /stdout\s*(?:\?\.|\.)\s*write/gu;

/** Whether the reference at `at` is itself a member access (`globalThis.process`), which no ignore token exempts. */
const isMemberAccess = (code: string, at: number): boolean => {
	let j = at - 1;
	while (j >= 0 && /\s/.test(code[j] ?? "")) j--;
	return code[j] === ".";
};

const processReads = (code: string, ignoreTokens: ReadonlyArray<string>): ReadonlyArray<number> =>
	references(code, "process").filter(
		(at) =>
			isMemberAccess(code, at) ||
			!ignoreTokens.some((token) => code.startsWith(token, at) && !isIdentifierChar(code[at + token.length])),
	);

const stdoutWrites = (code: string): ReadonlyArray<number> =>
	[...code.matchAll(STDOUT_WRITE)]
		.map((match) => ({ at: match.index ?? 0, end: (match.index ?? 0) + match[0].length }))
		.filter(({ at, end }) => !isIdentifierChar(code[at - 1]) && code[at - 1] !== "#" && !isIdentifierChar(code[end]))
		.map(({ at }) => at);

const forbids = (entry: string, specifier: string): boolean =>
	entry.endsWith("*")
		? specifier.startsWith(entry.slice(0, -1))
		: specifier === entry || specifier.startsWith(`${entry}/`);

const isNodeModule = (specifier: string, module: string): boolean =>
	[module, `node:${module}`].some((name) => specifier === name || specifier.startsWith(`${name}/`));

const FIXTURES: ReadonlyArray<BoundaryFixture> = [
	{ name: "process: destructuring", source: "const { env } = process;", rule: "process", flagged: true },
	{ name: "process: bracket access", source: 'const env = process["env"];', rule: "process", flagged: true },
	{
		name: "process: a member of globalThis",
		source: "const cwd = globalThis.process?.cwd();",
		rule: "process",
		flagged: true,
	},
	{
		name: "process: a template substitution",
		source: "const where = `cwd: ${process.cwd()}`;",
		rule: "process",
		flagged: true,
	},
	{
		name: "process: after a string holding a comment opener",
		source: 'const open = "/*"; const argv = process.argv; const close = "*/";',
		rule: "process",
		flagged: true,
	},
	{
		name: "process: after a regex holding a quote",
		source: 'const re = /"/; const argv = process.argv; const q = "x";',
		rule: "process",
		flagged: true,
	},
	{
		name: "process: after a division",
		source: "const half = total / 2; const argv = process.argv; const r = 1 / 4;",
		rule: "process",
		flagged: true,
	},
	{ name: "process: a comment", source: "// process.exit(1)\n/* process.cwd() */", rule: "process", flagged: false },
	{ name: "process: a string", source: 'const label = "process.env";', rule: "process", flagged: false },
	{
		name: "process: template text",
		source: "const help = `run process.exit to quit`;",
		rule: "process",
		flagged: false,
	},
	{ name: "process: a regex literal", source: "const re = /process\\.env/g;", rule: "process", flagged: false },
	{
		name: "process: a member of another object",
		source: "const pid = child.process;",
		rule: "process",
		flagged: false,
	},
	{
		name: "process: the build-time version constant",
		source: "const version = process.env.__PACKAGE_VERSION__;",
		rule: "process",
		flagged: false,
	},
	// The lexer-ambiguity corpus: each snippet once hid a real read (or invented one).
	{
		name: "process: the version constant reached through globalThis",
		source: "const version = globalThis.process.env.__PACKAGE_VERSION__;",
		rule: "process",
		flagged: true,
	},
	{
		name: "process: after a non-null assertion divided",
		source: "const y = x! / 2; const a = process.argv; const b = 1 / 4;",
		rule: "process",
		flagged: true,
	},
	{
		name: "process: after a postfix increment divided",
		source: "const y = i++ / 2; const a = process.argv; const b = 1 / 4;",
		rule: "process",
		flagged: true,
	},
	{
		name: "process: after a call divided",
		source: "const y = f(x) / 2; const a = process.argv; const b = 1 / 4;",
		rule: "process",
		flagged: true,
	},
	{
		name: "process: after a regex that follows an if condition",
		source: "if (x) /\\/*/.test(s);\nconst a = process.argv;\n/* c */",
		rule: "process",
		flagged: true,
	},
	{ name: "process: a ternary branch", source: "const p = ok ? process : fallback;", rule: "process", flagged: true },
	{ name: "process: an object-literal key", source: "const o = { process: 1 };", rule: "process", flagged: false },
	{ name: "process: a type member", source: "interface I { process?: string }", rule: "process", flagged: false },
	{
		name: "node:process: a static import",
		source: 'import { env } from "node:process";',
		rule: "node:process",
		flagged: true,
	},
	{
		name: "node:process: a dynamic import",
		source: 'const p = await import("process");',
		rule: "node:process",
		flagged: true,
	},
	{
		name: "node:process: a string that is not a specifier",
		source: 'const s = "node:process";',
		rule: "node:process",
		flagged: false,
	},
	{
		name: "node:process: an unrelated specifier",
		source: 'import { ChildProcess } from "effect/unstable/process";',
		rule: "node:process",
		flagged: false,
	},
	{ name: "stdout-write: a direct write", source: 'process.stdout.write("x");', rule: "stdout-write", flagged: true },
	{ name: "stdout-write: a string", source: 'const s = "stdout.write";', rule: "stdout-write", flagged: false },
	{ name: "console-write: console.log", source: 'console.log("x");', rule: "console-write", flagged: true },
	{
		name: "console-write: the Console service",
		source: "const current = yield* Console.Console;",
		rule: "console-write",
		flagged: false,
	},
	{
		name: "forbidImports: a platform package",
		source: 'import { NodeServices } from "@effect/platform-node";',
		rule: { forbidImports: ["@effect/platform*"] },
		flagged: true,
	},
	{
		name: "forbidImports: a commented-out import",
		source: '// import { NodeServices } from "@effect/platform-node";',
		rule: { forbidImports: ["@effect/platform*"] },
		flagged: false,
	},
];

/**
 * Source-text boundary checks: which files read `process`, import a forbidden
 * module, or write to stdout or the console.
 *
 * @remarks
 * Every check runs over one lexer pass that separates code from comments,
 * strings, template text and regex bodies, so `process` in prose, in a string
 * or in an embedded script's template text never counts, and a `/*` inside a
 * string never hides the code behind it. A `/` after an operand divides (an
 * identifier, `)`, `]`, a postfix `++`/`--` or a non-null `!`), while one after
 * an operator, a keyword or the `)` of an `if`/`while`/`for`/`with` condition
 * opens a regex. An object-literal key or type member named `process`
 * (`{ process: 1 }`) is not a read.
 *
 * It is a lexer, not a type checker, and these misses are known:
 *
 * - there is no scope analysis, so a local binding named `console` is still
 *   flagged (allowlist the file), and so is an unannotated class field named
 *   `process` (`process = 1`; an annotated `process: T` reads as a type member);
 *
 * - a computed access through a string key (`globalThis["process"]`) and a
 *   destructuring of a global (`const { process: p } = globalThis`) are not seen;
 *
 * - a regex literal directly after a block-closing `}` reads as a division, so
 *   a quote or `/*` inside it can hide the code after it;
 *
 * - JSX text reads as code.
 *
 * Assert on {@link SourceBoundary.verifyFixtures} beside your own scan: it
 * proves the scanner you are trusting still flags what it must and spares
 * what it must.
 *
 * @example
 * ```ts
 * import { SourceBoundary } from "@effected/workspaces/testing";
 *
 * const offences = SourceBoundary.check("src/a.ts", "const { env } = process;", ["process"]);
 * const clean = SourceBoundary.verifyFixtures().length === 0;
 * console.log(offences.map((offence) => offence.label), clean);
 * // => [ 'src/a.ts:1:17 process process' ] true
 * ```
 *
 * @public
 */
export class SourceBoundary {
	private constructor() {}

	/** `text` with every comment blanked to spaces; strings, templates and regexes untouched, length and line breaks kept. */
	static readonly stripComments = (text: string): string => lex(text).withoutComments;

	/** Whether `text` reads the global `process` in code (see {@link BoundaryRule}). */
	static readonly referencesProcess = (text: string, options?: ReferenceOptions): boolean =>
		processReads(lex(text).code, [...EXEMPT, ...(options?.ignoreTokens ?? [])]).length > 0;

	/** Every module specifier `text` imports: static, side-effect, re-export, type-only, `import(...)` with a literal, and `require(...)`. */
	static readonly importSpecifiers = (text: string): ReadonlyArray<string> =>
		specifierLiterals(lex(text)).map((literal) => literal.value);

	/** Whether `text` imports the Node built-in `module`, in either its `node:` or bare form. */
	static readonly importsNode = (text: string, module: string): boolean =>
		SourceBoundary.importSpecifiers(text).some((specifier) => isNodeModule(specifier, module));

	/** Every place `text` breaks one of `rules`, in source order, attributed to `file`. */
	static readonly check = (
		file: string,
		text: string,
		rules: ReadonlyArray<BoundaryRule>,
		options?: ReferenceOptions,
	): ReadonlyArray<Offence> => {
		const lexed = lex(text);
		const at = locate(text);
		const specifiers = specifierLiterals(lexed);
		const found: Array<{ readonly offset: number; readonly rule: Offence["rule"]; readonly detail: string }> = [];
		for (const rule of rules) {
			if (rule === "process") {
				for (const offset of processReads(lexed.code, [...EXEMPT, ...(options?.ignoreTokens ?? [])])) {
					found.push({ offset, rule, detail: "process" });
				}
			} else if (rule === "node:process") {
				for (const literal of specifiers) {
					if (isNodeModule(literal.value, "process"))
						found.push({ offset: literal.start, rule, detail: literal.value });
				}
			} else if (rule === "stdout-write") {
				for (const offset of stdoutWrites(lexed.code)) found.push({ offset, rule, detail: "stdout.write" });
			} else if (rule === "console-write") {
				for (const offset of references(lexed.code, "console")) found.push({ offset, rule, detail: "console" });
			} else {
				for (const literal of specifiers) {
					if (rule.forbidImports.some((entry) => forbids(entry, literal.value))) {
						found.push({ offset: literal.start, rule: "forbidImports", detail: literal.value });
					}
				}
			}
		}
		return found
			.sort((a, b) => a.offset - b.offset)
			.map(({ offset, rule, detail }) => Offence.make({ file, ...at(offset), rule, detail }));
	};

	/**
	 * Check every source file under `root` against `rules`.
	 *
	 * @remarks
	 * Walks with an explicit stack, visiting each real directory once (via
	 * `realPath`), so a symlink loop terminates and a linked directory is not
	 * scanned twice. `node_modules` is never entered. Paths come back relative
	 * and `/`-separated whatever the platform's separator, and that is also
	 * what `allow` globs match against. A missing root fails; it never scans
	 * nothing. A dangling symlink under the root is skipped, having nothing to
	 * scan; any other entry that cannot be read fails the scan.
	 *
	 * @example
	 * ```ts
	 * import { NodeServices } from "@effect/platform-node";
	 * import { SourceBoundary } from "@effected/workspaces/testing";
	 * import { Effect } from "effect";
	 *
	 * const scan = SourceBoundary.scan({
	 *   root: "/repo/packages/engine/src",
	 *   rules: ["process", "node:process", { forbidImports: ["node:*", "@effect/platform*"] }],
	 * }).pipe(Effect.provide(NodeServices.layer));
	 * ```
	 */
	static readonly scan = Effect.fn("SourceBoundary.scan")(function* (options: ScanOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const allow = yield* GlobSet.compile(options.allow ?? []);
		const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
		const posix = (relative: string): string => relative.split(path.sep).join("/");
		const files: Array<string> = [];
		const allowed: Array<string> = [];
		const offences: Array<Offence> = [];
		const visited = new Set<string>();
		const pending: Array<string> = [options.root];
		while (pending.length > 0) {
			const directory = pending.pop();
			if (directory === undefined) break;
			const real = yield* fs.realPath(directory);
			if (visited.has(real)) continue;
			visited.add(real);
			for (const name of yield* fs.readDirectory(directory)) {
				const full = path.join(directory, name);
				// stat follows links, so a dangling one fails NotFound; it has nothing to scan, so skip it.
				// A NotFound on an entry that is not a link still fails: nothing may drop out of the scan silently.
				const found = yield* fs.stat(full).pipe(
					Effect.map(Option.some),
					Effect.catch((error) =>
						error.reason._tag === "NotFound"
							? fs.readLink(full).pipe(
									Effect.as(Option.none<FileSystem.File.Info>()),
									Effect.mapError(() => error),
								)
							: Effect.fail(error),
					),
				);
				if (Option.isNone(found)) continue;
				const info = found.value;
				if (info.type === "Directory") {
					if (name !== "node_modules") pending.push(full);
					continue;
				}
				if (
					info.type !== "File" ||
					DECLARATION.test(name) ||
					!extensions.some((extension) => name.endsWith(extension))
				) {
					continue;
				}
				const file = posix(path.relative(options.root, full));
				files.push(file);
				if (allow.matches(file)) {
					allowed.push(file);
					continue;
				}
				offences.push(...SourceBoundary.check(file, yield* fs.readFileString(full), options.rules, options));
			}
		}
		return SourceScan.make({
			files: files.sort(byCodeUnit),
			allowed: allowed.sort(byCodeUnit),
			offences: offences.sort((a, b) => byCodeUnit(a.file, b.file) || a.line - b.line || a.column - b.column),
		});
	});

	/** The shipped positive- and negative-control snippets, at least one of each per rule kind. */
	static readonly fixtures: ReadonlyArray<BoundaryFixture> = FIXTURES;

	/** The names of shipped fixtures the scanner now gets wrong; `[]` means it still flags and spares what it must. */
	static readonly verifyFixtures = (): ReadonlyArray<string> =>
		FIXTURES.filter(
			(fixture) => SourceBoundary.check("fixture.ts", fixture.source, [fixture.rule]).length > 0 !== fixture.flagged,
		).map((fixture) => `${fixture.flagged ? "missed" : "false positive"}: ${fixture.name}`);
}
