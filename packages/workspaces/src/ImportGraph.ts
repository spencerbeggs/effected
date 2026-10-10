import { GlobSet } from "@effected/glob";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import type { SourceLiteral } from "./internal/sourceText.js";
import { isIdentifierChar, lex, locate, specifierLiterals, wordEndingAt } from "./internal/sourceText.js";
import { DEFAULT_EXTENSIONS, walkSources } from "./internal/sourceWalk.js";
import { SourceBoundary } from "./SourceBoundary.js";
import { WorkspaceDiscovery } from "./WorkspaceDiscovery.js";

/**
 * The entries list named no file to start from, so a walk would prove nothing.
 *
 * @public
 */
export class NoEntriesError extends Schema.TaggedError<NoEntriesError>()("NoEntriesError", {
	/** The root the walk would have reported against. */
	root: Schema.String,
}) {
	/** Renders the root into a one-line message. */
	override get message(): string {
		return `No entries to walk under "${this.root}": a walk of nothing proves nothing`;
	}
}

/**
 * An entry named a file no resolution candidate could find. The walk fails
 * rather than starting from nothing: a typo'd entry must never read as clean.
 *
 * @public
 */
export class EntryNotFoundError extends Schema.TaggedError<EntryNotFoundError>()("EntryNotFoundError", {
	/** The entry, verbatim. */
	entry: Schema.String,
	/** The root it was resolved against. */
	root: Schema.String,
}) {
	/** Renders the entry and root into a one-line message. */
	override get message(): string {
		return `Entry "${this.entry}" resolves to no file under "${this.root}"`;
	}
}

/**
 * One relative import no file candidate resolved: a link of the graph the
 * walk could not follow, so whatever it would have reached is unproven.
 *
 * @public
 */
export class UnresolvedImport extends Schema.Class<UnresolvedImport>("UnresolvedImport")({
	/** The importing file, relative to the root, with `/` separators. */
	file: Schema.String,
	/** The specifier, verbatim. */
	specifier: Schema.String,
}) {
	/** `file specifier`, the form an assertion message reads best in. */
	get label(): string {
		return `${this.file} ${this.specifier}`;
	}
}

/**
 * One forbidden import a walk from the entries reached.
 *
 * @public
 */
export class ReachOffence extends Schema.Class<ReachOffence>("ReachOffence")({
	/** The importing file, relative to the root, with `/` separators. */
	file: Schema.String,
	/** The 1-based line. */
	line: Schema.Number,
	/** The 1-based column, in UTF-16 code units. */
	column: Schema.Number,
	/** The forbidden specifier, verbatim. */
	specifier: Schema.String,
	/**
	 * The files the walk took from an entry to `file`, entry first and `file`
	 * last, each relative to the root with `/` separators. Breadth-first, so
	 * this is a shortest chain; it is the chain the walk first reached `file`
	 * by, and a file is visited once whatever else reaches it.
	 */
	chain: Schema.Array(Schema.String),
}) {
	/** `file:line:column specifier via chain`, the form an assertion message reads best in. */
	get label(): string {
		return `${this.file}:${this.line}:${this.column} ${this.specifier} via ${this.chain.join(" -> ")}`;
	}
}

/**
 * What a reachability walk read and found.
 *
 * @public
 */
export class ReachabilityScan extends Schema.Class<ReachabilityScan>("ReachabilityScan")({
	/**
	 * Every file the walk reached, entries included, relative to the root with
	 * `/` separators, sorted. Assert it is non-empty: a walk that reached
	 * nothing proves nothing.
	 */
	files: Schema.Array(Schema.String),
	/**
	 * Every relative specifier no file candidate resolved, one per
	 * file-and-specifier pair, sorted by file then specifier. Assert it is
	 * empty, or exactly the generated files you expect: an unresolved link is
	 * a part of the graph the walk could not prove anything about.
	 */
	unresolved: Schema.Array(UnresolvedImport),
	/** Every forbidden import the walk reached, sorted by file, then line, then column. */
	offences: Schema.Array(ReachOffence),
}) {
	/** One `file:line:column specifier via chain` label per offence: `[]` means the entries reach nothing forbidden. */
	get violations(): ReadonlyArray<string> {
		return this.offences.map((offence) => offence.label);
	}
}

/**
 * Options for {@link ImportGraph.reachability}.
 *
 * @public
 */
export interface ReachabilityOptions {
	/** The directory every entry and reported path is relative to. */
	readonly root: string;
	/**
	 * The files the walk starts from, relative to `root` with `/` separators,
	 * or absolute. Each resolves like a relative import (see `extensions`);
	 * one that resolves to no file fails `EntryNotFoundError`, and an empty
	 * list fails `NoEntriesError` — the walk never proves nothing silently.
	 */
	readonly entries: ReadonlyArray<string>;
	/**
	 * Specifiers no reached file may import, matched like a `SourceBoundary`
	 * `forbidImports` entry: equal to the specifier, a subpath of it, or its
	 * text before a trailing `*`.
	 */
	readonly forbid: ReadonlyArray<string>;
	/**
	 * File extensions a relative specifier resolves through: `./a.js` also
	 * tries `./a` with each extension, and `./a/index` with each. Defaults to
	 * `.ts`, `.mts`, `.cts`, `.js`, `.mjs` and `.cjs`; declaration files are
	 * never a candidate.
	 */
	readonly extensions?: ReadonlyArray<string> | undefined;
	/**
	 * The workspace-package extension point: called with every bare specifier
	 * a reached file imports, answering the file to continue the walk from
	 * (relative to `root` with `/` separators, or absolute, resolved like an
	 * entry), or `undefined` to stop at the specifier. A path that resolves to
	 * no file is reported in `unresolved` under the specifier it was reached
	 * by. The default stops at every bare specifier: the walk follows relative
	 * imports only.
	 */
	readonly followPackage?: ((specifier: string) => string | undefined) | undefined;
}

/**
 * One runtime import the owning package's manifest does not declare.
 *
 * @public
 */
export class UndeclaredImport extends Schema.Class<UndeclaredImport>("UndeclaredImport")({
	/** The name of the package that owns the importing file. */
	package: Schema.String,
	/** The importing file, relative to its package, with `/` separators. */
	file: Schema.String,
	/** The 1-based line. */
	line: Schema.Number,
	/** The 1-based column, in UTF-16 code units. */
	column: Schema.Number,
	/** The specifier, verbatim. */
	specifier: Schema.String,
	/** The package name the specifier names: `effect` for `effect/Schema`. */
	dependency: Schema.String,
}) {
	/** `package file:line:column undeclared dependency`, the form an assertion message reads best in. */
	get label(): string {
		return `${this.package} ${this.file}:${this.line}:${this.column} undeclared ${this.dependency}`;
	}
}

/**
 * What an undeclared-import check read and found.
 *
 * @public
 */
export class UndeclaredScan extends Schema.Class<UndeclaredScan>("UndeclaredScan")({
	/** Every package whose manifest the check read, sorted by name. Assert it is non-empty. */
	packages: Schema.Array(Schema.String),
	/**
	 * Every file the check read, relative to the workspace root with `/`
	 * separators, sorted. Assert it is non-empty: a check that read no file
	 * proves nothing, and a mistyped `include` shows up here.
	 */
	files: Schema.Array(Schema.String),
	/** Every undeclared runtime import, sorted by package, then file, then line, then column. */
	undeclared: Schema.Array(UndeclaredImport),
}) {
	/** One `package file:line:column undeclared dependency` label per import: `[]` means every runtime import is declared. */
	get violations(): ReadonlyArray<string> {
		return this.undeclared.map((entry) => entry.label);
	}
}

/**
 * Options for {@link ImportGraph.undeclared}.
 *
 * @public
 */
export interface UndeclaredOptions {
	/**
	 * Bare Node built-ins (`"fs"`, `"child_process"`), never flagged. A
	 * `node:`-prefixed specifier is always a built-in; no bare list ships
	 * here, because one would drift with Node releases — spread
	 * `builtinModules` from `node:module` in your test file. A bare built-in
	 * not on this list is flagged like any undeclared package.
	 */
	readonly builtins?: ReadonlyArray<string> | undefined;
	/**
	 * Globs, matched against each package-relative path with `/` separators,
	 * naming the runtime source files to read. Defaults to `["src/**"]`: the
	 * check compares against `dependencies` and `peerDependencies`, so test
	 * files importing devDependencies are out of scope by design. Each glob
	 * is walked from its static prefix (the text before its first pattern
	 * character), so the default walks `src/` and never `dist/` or
	 * `node_modules`; a glob with no static prefix walks the package
	 * directory.
	 */
	readonly include?: ReadonlyArray<string> | undefined;
	/**
	 * File extensions to read. Defaults to `.ts`, `.mts`, `.cts`, `.js`,
	 * `.mjs` and `.cjs`; declaration files are always skipped.
	 */
	readonly extensions?: ReadonlyArray<string> | undefined;
}

/** The runtime sources an undeclared check reads when the caller names none. */
const DEFAULT_INCLUDE: ReadonlyArray<string> = ["src/**"];

/** A compiled or source extension a specifier may carry, which resolution swaps for the candidates. */
const COMPILED_EXTENSION = /\.(?:[cm]?js|[cm]?ts|jsx|tsx)$/u;

/** Any URL-style scheme (`node:`, `http:`), which is never a package specifier. */
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u;

const SPACE = /\s/;

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byPosition = (
	a: { readonly file: string; readonly line: number; readonly column: number },
	b: { readonly file: string; readonly line: number; readonly column: number },
): number => byCodeUnit(a.file, b.file) || a.line - b.line || a.column - b.column;

/** Whether the specifier is a bare package specifier: not relative, not absolute, not a subpath import, not a URL. */
const isBare = (specifier: string): boolean =>
	!specifier.startsWith(".") && !specifier.startsWith("/") && !specifier.startsWith("#") && !SCHEME.test(specifier);

/**
 * The package name a bare specifier names (`effect/Schema` → `effect`,
 * `@org/pkg/x` → `@org/pkg`), or `undefined` for anything that is not one.
 */
const packageNameOf = (specifier: string): string | undefined => {
	if (!isBare(specifier)) return undefined;
	const segments = specifier.split("/");
	if (specifier.startsWith("@"))
		return segments.length >= 2 && segments[1] !== "" ? `${segments[0]}/${segments[1]}` : undefined;
	const name = segments[0] ?? "";
	return name === "" ? undefined : name;
};

/**
 * The offset just past the `import` or `export` keyword opening the statement
 * the `from` starting at `from` belongs to, walking back over the code view;
 * `undefined` when a `;` or the start of the file comes first, which reads as
 * runtime — the conservative side.
 */
const statementStart = (code: string, from: number): number | undefined => {
	let j = from - 1;
	while (j >= 0) {
		const char = code[j] ?? "";
		if (char === ";") return undefined;
		if (isIdentifierChar(char)) {
			let start = j;
			while (start >= 0 && isIdentifierChar(code[start])) start--;
			const word = code.slice(start + 1, j + 1);
			if (word === "import" || word === "export") return j + 1;
			j = start;
			continue;
		}
		j--;
	}
	return undefined;
};

/**
 * Whether the specifier at `literal` sits in a type-only import or re-export
 * (`import type { X } from`, `export type * from`), which the compiler erases
 * and so never needs a runtime dependency. A side-effect import, a dynamic
 * `import()`, a `require()` and an `import { type X }` binding list all load
 * at runtime and are not type-only.
 */
const isTypeOnly = (code: string, literal: SourceLiteral): boolean => {
	let j = literal.start - 1;
	while (j >= 0 && SPACE.test(code[j] ?? "")) j--;
	if (code[j] === "(") return false;
	if (wordEndingAt(code, j) !== "from") return false;
	let k = j;
	while (k >= 0 && isIdentifierChar(code[k])) k--;
	const start = statementStart(code, k + 1);
	if (start === undefined) return false;
	let m = start;
	while (m < code.length && SPACE.test(code[m] ?? "")) m++;
	let e = m;
	while (e < code.length && isIdentifierChar(code[e])) e++;
	if (code.slice(m, e) !== "type") return false;
	// The `type` keyword, not a default binding named `type`: an identifier,
	// `{` or `*` must follow. (`import type from "x"` is type-only: TypeScript
	// reads `type` there as the keyword.)
	let n = e;
	while (n < code.length && SPACE.test(code[n] ?? "")) n++;
	const next = code[n] ?? "";
	return next === "{" || next === "*" || isIdentifierChar(next);
};

/**
 * The static prefix of a glob: the text before its first pattern character,
 * cut back to the last `/`, so `src/**` walks `src` and a leading `**` walks
 * everything. Over-cutting is safe — the glob still filters every file — so
 * every character any glob syntax could treat as special cuts.
 */
const globPrefix = (pattern: string): string => {
	const at = pattern.search(/[*?[{\]()!|@]/u);
	const prefix = at === -1 ? pattern : pattern.slice(0, at);
	const slash = prefix.lastIndexOf("/");
	return slash === -1 ? "" : prefix.slice(0, slash);
};

/** The distinct walk roots a set of include globs needs, shortest first: a prefix under another walks nothing twice. */
const includePrefixes = (patterns: ReadonlyArray<string>): ReadonlyArray<string> => {
	const prefixes = [...new Set(patterns.map(globPrefix))];
	return prefixes.filter(
		(prefix) => prefix === "" || !prefixes.some((other) => other !== prefix && prefix.startsWith(`${other}/`)),
	);
};

/**
 * Import-graph checks: properties of what the imports of a set of files
 * reach, which no one-file rule can express.
 *
 * @remarks
 * {@link SourceBoundary} checks one file at a time. Two guards consumers want
 * are properties of the import graph itself:
 *
 * - {@link ImportGraph.reachability} answers "nothing reachable from entry X
 *   imports Y". A directory rule approximates that, but a refactor which adds
 *   a new static path from the root entry into an allowed directory still
 *   passes it; a reachability walk follows the real import edges and reports
 *   the chain that reaches the forbidden specifier.
 * - {@link ImportGraph.undeclared} answers "every runtime import is
 *   declared". Workspace hoisting resolves an import of a package the
 *   manifest never declared, and only a packed install catches that today —
 *   far too slow for the edit loop. This check is static and fast: each
 *   package's literal specifiers against its own `dependencies` and
 *   `peerDependencies`.
 *
 * Both are static analysis of literal specifiers: static imports,
 * re-exports, and `import()`/`require()` calls whose argument is one string
 * literal. There is no dynamic-import guarantee: a computed specifier
 * (`import("./ui/" + name)`) is invisible to both, and a packed install
 * (`PackedInstall`) remains the proof of what actually resolves at
 * runtime. Both reuse the `SourceBoundary` lexer, so a specifier in a
 * comment, a string, template text or a regex body is never an import, and
 * both refuse to pass vacuously: every result reports what it read.
 *
 * @example
 * ```ts
 * import { NodeServices } from "@effect/platform-node";
 * import { ImportGraph } from "@effected/workspaces/testing";
 * import { Effect } from "effect";
 *
 * // Nothing reachable from the root entry may import ink or react.
 * const walk = ImportGraph.reachability({
 *   root: "/repo/packages/ui/src",
 *   entries: ["index.ts"],
 *   forbid: ["ink", "react"],
 * }).pipe(Effect.provide(NodeServices.layer));
 * ```
 *
 * @public
 */
export class ImportGraph {
	private constructor() {}

	/**
	 * Walk the import graph from `entries` through relative imports and report
	 * every forbidden specifier a reached file imports.
	 *
	 * @remarks
	 * The walk is breadth-first, so a violation's chain is a shortest path
	 * from an entry, and each file is visited once through its `realPath`, so
	 * a symlink loop terminates and a diamond reports one chain. The walk is
	 * conservative: it follows every literal specifier, type-only imports
	 * included, so a forbidden import only a type reaches is still reported.
	 * A bare specifier is checked against `forbid` — the same matcher
	 * `SourceBoundary.check` uses — but only walked into when `followPackage`
	 * names a file for it. A relative specifier that resolves to no file is
	 * reported in `unresolved`, never dropped: the part of the graph behind it
	 * is unproven.
	 */
	static readonly reachability = Effect.fn("ImportGraph.reachability")(function* (options: ReachabilityOptions) {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		if (options.entries.length === 0) return yield* Effect.fail(NoEntriesError.make({ root: options.root }));
		const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
		const posix = (relative: string): string => relative.split(path.sep).join("/");

		/** The first candidate that exists as a file, or none. */
		const firstFile = (candidates: ReadonlyArray<string>) =>
			Effect.gen(function* () {
				for (const candidate of candidates) {
					if (yield* fs.exists(candidate)) {
						const info = yield* fs.stat(candidate);
						if (info.type === "File") return Option.some(candidate);
					}
				}
				return Option.none<string>();
			});

		/** Every file a specifier could name: itself, its stem under each extension, and each extension's index. */
		const candidatesOf = (target: string): ReadonlyArray<string> => {
			const stem = target.replace(COMPILED_EXTENSION, "");
			const candidates = [target];
			for (const extension of extensions) {
				candidates.push(stem + extension, path.join(stem, `index${extension}`));
			}
			return candidates;
		};

		/** An entry or a `followPackage` answer as an absolute path: absolute stays, relative joins under the root. */
		const absolute = (given: string): string =>
			path.isAbsolute(given) ? given : path.join(options.root, ...given.split("/"));

		const files: Array<string> = [];
		const offences: Array<ReachOffence> = [];
		const unresolved: Array<UnresolvedImport> = [];
		const reportedUnresolved = new Set<string>();
		const visited = new Set<string>();
		const queue: Array<{ readonly full: string; readonly file: string; readonly chain: ReadonlyArray<string> }> = [];

		const recordUnresolved = (file: string, specifier: string): void => {
			const key = `${file}\u0000${specifier}`;
			if (reportedUnresolved.has(key)) return;
			reportedUnresolved.add(key);
			unresolved.push(UnresolvedImport.make({ file, specifier }));
		};

		for (const entry of options.entries) {
			const found = yield* firstFile(candidatesOf(absolute(entry)));
			if (Option.isNone(found)) {
				return yield* Effect.fail(EntryNotFoundError.make({ entry, root: options.root }));
			}
			const file = posix(path.relative(options.root, found.value));
			queue.push({ full: found.value, file, chain: [file] });
		}

		for (let i = 0; i < queue.length; i++) {
			const current = queue[i];
			if (current === undefined) continue;
			const real = yield* fs.realPath(current.full);
			if (visited.has(real)) continue;
			visited.add(real);
			files.push(current.file);
			const text = yield* fs.readFileString(current.full);
			for (const offence of SourceBoundary.check(current.file, text, [{ forbidImports: options.forbid }])) {
				offences.push(
					ReachOffence.make({
						file: offence.file,
						line: offence.line,
						column: offence.column,
						specifier: offence.detail,
						chain: [...current.chain],
					}),
				);
			}
			for (const specifier of SourceBoundary.importSpecifiers(text)) {
				let target: string | undefined;
				if (specifier.startsWith(".")) {
					target = path.resolve(path.dirname(current.full), specifier);
				} else if (options.followPackage !== undefined && isBare(specifier)) {
					const mapped = options.followPackage(specifier);
					if (mapped === undefined) continue;
					target = absolute(mapped);
				} else {
					continue;
				}
				const found = yield* firstFile(candidatesOf(target));
				if (Option.isNone(found)) {
					recordUnresolved(current.file, specifier);
					continue;
				}
				const file = posix(path.relative(options.root, found.value));
				queue.push({ full: found.value, file, chain: [...current.chain, file] });
			}
		}

		return ReachabilityScan.make({
			files: files.sort(byCodeUnit),
			unresolved: unresolved.sort((a, b) => byCodeUnit(a.file, b.file) || byCodeUnit(a.specifier, b.specifier)),
			offences: offences.sort(byPosition),
		});
	});

	/**
	 * Check every workspace package's runtime sources for imports its own
	 * manifest does not declare.
	 *
	 * @remarks
	 * For each discovered package, reads the files its `include` globs name
	 * (`src/**` by default) and compares every runtime specifier against the
	 * package's `dependencies` and `peerDependencies`. `devDependencies` and
	 * `optionalDependencies` never declare: an import of one from a runtime
	 * source is exactly the hoisting bug this check exists for. A relative,
	 * absolute, `#`-subpath or URL-scheme specifier is never a package import;
	 * a `node:` specifier is always a built-in, and a bare built-in is one only
	 * when `builtins` lists it. A package importing its own name (a
	 * self-reference through `exports`) is declared by definition. Type-only
	 * imports are erased by the compiler and never flagged; every other
	 * literal specifier counts, dynamic `import()` included. What the static
	 * pass cannot see — a computed specifier — only `PackedInstall`
	 * proves.
	 */
	static readonly undeclared = Effect.fn("ImportGraph.undeclared")(function* (options: UndeclaredOptions = {}) {
		const discovery = yield* WorkspaceDiscovery;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const include = options.include ?? DEFAULT_INCLUDE;
		const globs = yield* GlobSet.compile(include);
		const prefixes = includePrefixes(include);
		const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
		const builtins = new Set(options.builtins ?? []);
		const packages = yield* discovery.listPackages();
		const names: Array<string> = [];
		const files: Array<string> = [];
		const undeclared: Array<UndeclaredImport> = [];
		for (const pkg of packages) {
			names.push(pkg.name);
			const declared = new Set([...Object.keys(pkg.dependencies), ...Object.keys(pkg.peerDependencies)]);
			const seen = new Set<string>();
			for (const prefix of prefixes) {
				const walkRoot = prefix === "" ? pkg.path : path.join(pkg.path, ...prefix.split("/"));
				if (!(yield* fs.exists(walkRoot))) continue;
				for (const source of yield* walkSources({ root: walkRoot, extensions })) {
					const file = prefix === "" ? source.file : `${prefix}/${source.file}`;
					if (seen.has(file) || !globs.matches(file)) continue;
					seen.add(file);
					files.push(pkg.relativePath === "." ? file : `${pkg.relativePath}/${file}`);
					const text = yield* fs.readFileString(source.path);
					const lexed = lex(text);
					const at = locate(text);
					for (const literal of specifierLiterals(lexed)) {
						if (isTypeOnly(lexed.code, literal)) continue;
						const dependency = packageNameOf(literal.value);
						if (dependency === undefined) continue;
						if (builtins.has(dependency) || dependency === pkg.name || declared.has(dependency)) continue;
						undeclared.push(
							UndeclaredImport.make({
								package: pkg.name,
								file,
								...at(literal.start),
								specifier: literal.value,
								dependency,
							}),
						);
					}
				}
			}
		}
		return UndeclaredScan.make({
			packages: names.sort(byCodeUnit),
			files: files.sort(byCodeUnit),
			undeclared: undeclared.sort(
				(a, b) => byCodeUnit(a.package, b.package) || byCodeUnit(a.file, b.file) || byPosition(a, b),
			),
		});
	});
}
