import { GlobPattern, GlobPatternOptions } from "@effected/glob";
import { Effect, Result, Schema } from "effect";
import { LockfileImporter } from "../LockfileImporter.js";
import { ResolvedPackage } from "../ResolvedPackage.js";
import type { LockfileFields, ParseFailure, WorkspaceEntry } from "./shared.js";
import {
	extractWorkspaceDeps,
	importerDependencies,
	peerDeclarations,
	requireLockfileVersion,
	syntaxFailure,
	toIntegrityHash,
	validationFailure,
} from "./shared.js";

// ── Raw schema (permissive validation scaffolding, not API) ────────────────

const DepRecord = Schema.optionalKey(Schema.Record(Schema.String, Schema.String));

const PeerMetaRecord = Schema.optionalKey(
	Schema.Record(Schema.String, Schema.Struct({ optional: Schema.optionalKey(Schema.Boolean) })),
);

const NpmPackageEntry = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	version: Schema.optionalKey(Schema.String),
	resolved: Schema.optionalKey(Schema.String),
	integrity: Schema.optionalKey(Schema.String),
	link: Schema.optionalKey(Schema.Boolean),
	dev: Schema.optionalKey(Schema.Boolean),
	dependencies: DepRecord,
	devDependencies: DepRecord,
	peerDependencies: DepRecord,
	peerDependenciesMeta: PeerMetaRecord,
	optionalDependencies: DepRecord,
	// The root entry's workspace globs, read defensively by `workspaceMatcher`:
	// npm writes an array, a hand-edited file may hold anything.
	workspaces: Schema.optionalKey(Schema.Unknown),
});

/**
 * The version gate's own input: `lockfileVersion` and nothing else.
 *
 * The gate has to read the version *before* the shape decode, because the
 * shape it would decode against is the shape of a supported version. `packages`
 * is a required key here and a v1 tree does not have one, so a shape-first
 * order reports npm v1 as **malformed** rather than as **too old** — losing
 * exactly the distinction the `UnsupportedLockfileVersion` cause exists to
 * carry.
 *
 * @internal
 */
const NpmVersionProbe = Schema.Struct({
	lockfileVersion: Schema.Union([Schema.Number, Schema.String]),
});

const NpmLockfileRaw = Schema.Struct({
	name: Schema.optionalKey(Schema.String),
	version: Schema.optionalKey(Schema.String),
	lockfileVersion: Schema.Union([Schema.Number, Schema.String]),
	requires: Schema.optionalKey(Schema.Boolean),
	packages: Schema.Record(Schema.String, NpmPackageEntry),
});

type NpmLockfileRawType = typeof NpmLockfileRaw.Type;
type NpmPackageEntryType = typeof NpmPackageEntry.Type;

const NODE_MODULES_PREFIX = "node_modules/";
const NESTED_NODE_MODULES = "/node_modules/";

/**
 * Where a `packages` key's package name starts: after the **last**
 * `node_modules/` segment, not the first.
 *
 * npm encodes the whole install position in the key, so
 * `node_modules/express/node_modules/debug` is *debug*, nested under express —
 * and `packages/lib/node_modules/react` is *react*, nested under a workspace
 * directory and carrying no `node_modules/` prefix at all. Returns `-1` for a
 * key that is not a package position (the root `""` entry, a workspace path
 * entry), which the caller skips.
 *
 * @internal
 */
const packageNameIndex = (key: string): number => {
	const nested = key.lastIndexOf(NESTED_NODE_MODULES);
	if (nested !== -1) return nested + NESTED_NODE_MODULES.length;
	return key.startsWith(NODE_MODULES_PREFIX) ? NODE_MODULES_PREFIX.length : -1;
};

/**
 * Resolve one entry's outgoing edges by replaying node resolution over the key
 * space: from the depending package's own directory, try
 * `<prefix>/node_modules/<name>`, then strip one path segment and try again,
 * out to the root — **deepest first**, first hit wins. That order is the whole
 * algorithm: outermost-first would return the hoisted copy and silently
 * mis-report every shadowed dependency.
 *
 * Only keys that actually exist in the lockfile are emitted, so an edge npm
 * did not record is omitted rather than invented.
 *
 * @internal
 */
const resolveNpmEdges = (
	start: string,
	sections: ReadonlyArray<Readonly<Record<string, string>> | undefined>,
	packages: Readonly<Record<string, unknown>>,
): Record<string, string> => {
	const names = new Set<string>();
	for (const section of sections) {
		if (!section) continue;
		for (const name of Object.keys(section)) if (name !== "") names.add(name);
	}
	if (names.size === 0) return {};

	const prefixes: Array<string> = [];
	for (let prefix = start; ; ) {
		prefixes.push(prefix);
		if (prefix === "") break;
		const slash = prefix.lastIndexOf("/");
		prefix = slash === -1 ? "" : prefix.slice(0, slash);
	}

	const edges = new Map<string, string>();
	for (const name of names) {
		for (const prefix of prefixes) {
			const candidate = prefix === "" ? `${NODE_MODULES_PREFIX}${name}` : `${prefix}${NESTED_NODE_MODULES}${name}`;
			if (Object.hasOwn(packages, candidate)) {
				edges.set(name, candidate);
				break;
			}
		}
	}
	// Map-backed until the last step: `Object.fromEntries` defines own data
	// properties, so a "__proto__" dependency name neither pollutes nor drops.
	return Object.fromEntries(edges);
};

/**
 * The most patterns the root entry's `workspaces` field may declare. Real
 * repositories declare tens; the ceiling sits far above that and bounds the
 * cancellation, which is quadratic in the pattern count (every negation is
 * matched against every later positive, as `map-workspaces` does). The
 * per-row cost is bounded by {@link MAX_WILDCARD_WORKSPACE_PATTERNS} and
 * {@link MAX_WILDCARD_ALTERNATIVES}.
 *
 * Measured at both ceilings on darwin-arm64, node 26.13.0, CPU time, the
 * best of three. With 64 wildcards (the ceiling before it was lowered to
 * 32), `p/**`, 63 wildcard `/**` negations and 936 literal ones over about
 * 1 MB of link rows took 256 ms at path depth 2 (10,599 rows), 336 ms at
 * depth 12, 457 ms at depth 42, 495 ms at depth 120; at 32 wildcards
 * (31 negations, 968 literal), depth 120 takes 291 ms. The cancellation's
 * worst split inside the ceilings (500 literal negations then 500 literal
 * positives) takes 24 ms. Before the ceilings, the memo and the literal
 * lookups, 999 wildcard negations over 1 MB took 2.4–6.1 s, and the 592 KB
 * case a reviewer measured took 88 s.
 *
 * A lockfile over the ceiling fails typed at validation rather than being
 * read some other way: a fallback reading would silently misclassify the
 * links the globs exist to tell apart.
 *
 * @internal
 */
const MAX_WORKSPACE_PATTERNS = 1000;

/**
 * The most wildcard patterns — any that are not plain paths — the field may
 * declare. Each costs a match per link-row directory, so this, not the total,
 * bounds the per-row work; literal paths are set lookups. Real repositories
 * declare a handful. It is 32, not 64: the per-row cost is linear in
 * wildcards × file size, and at 64 a near-miss shape over 1 MB of link rows
 * took 1.4 s (see {@link MAX_WILDCARD_PATTERN_LENGTH}).
 *
 * @internal
 */
const MAX_WILDCARD_WORKSPACE_PATTERNS = 32;

/**
 * The longest a matched pattern may be, in characters: every negation, and
 * every positive that is not a plain path once its trailing `/.` run is
 * dropped. Plain-path positives are set lookups and stay uncapped. glob's
 * matcher is polynomial, not linear: a run of `x!(a)` matched against a
 * candidate of similar length is about cubic (1,000 characters cost 26 ms
 * per match, 63 such negations over 971 KB of rows 27.6 s). Real workspace
 * globs are tens of characters.
 *
 * Measured at all four ceilings together (1000 patterns, 32 wildcards, 256
 * alternatives, 256 characters) over about 1 MB of link rows, darwin-arm64,
 * node 26.13.0, CPU time, best of three after a warm-up, load average about
 * 20: `p/**`, 31 negations `!p/*` + `/x!(a)` × 50 (254 characters) and 968
 * literal ones, against rows `p/qN/` + `xb` × 50, takes 76–79 ms when the
 * rows match (the first matching negation ends the test). Against near-miss
 * rows (`…xb xa`), where every negation runs to the end and fails, it takes
 * 454–688 ms, and 32 such positives take 364–503 ms. That cost scales with
 * wildcard count × file size, not with pattern length, which is why the
 * wildcard ceiling is 32: at 64 the same near-miss shape took 1.4 s.
 * Without this length ceiling, 63 negations of 1,000 characters over
 * 971 KB took 27.6 s.
 *
 * @internal
 */
const MAX_WILDCARD_PATTERN_LENGTH = 256;

/**
 * The most brace alternatives the wildcard patterns may expand to, summed
 * over every wildcard pattern, positive and negated. The glob engine expands
 * a pattern's braces and matches each alternative, so one pattern
 * (`p/{a,b,c,d,e,f,g,h}` four times over is 4,096 alternatives) can cost what
 * thousands do; the wildcard-pattern ceiling alone does not bound it. Each
 * pattern is weighed by {@link braceAlternativesBound}, an upper bound, so a
 * field near the ceiling may be refused that would in truth fit — it fails
 * closed, never open. The bound is loose for several groups in one pattern:
 * `{1..99}{a,b}` makes 198 alternatives, which the engine expands cheaply,
 * yet weighs 99² = 9,801, and `{a,b}{c,d}{e,f}{g,h}{i,j}` makes 32 and
 * weighs 6⁵ = 7,776, so a field holding either fails typed rather than
 * being read. Real `workspaces` fields hold nothing of the kind; a field that
 * needs one can list its alternatives as separate patterns.
 *
 * Measured at the budget over about 1 MB of link rows (darwin-arm64, node
 * 26.13.0, CPU time, best of three), `p/**` plus 31 negations of eight
 * alternatives each: 432 ms at path depth 12, 366 ms at 42, 333 ms at 120;
 * with an extglob prefix on each, 507 / 419 / 353 ms; one negation of 255
 * alternatives, 294 / 167 / 94 ms. Without the budget, 64 negations of
 * 8^4 alternatives beside 936 literal positives — 14 KB, no link rows —
 * took 8.0 s, and 63 negations of 8^2 over 954 KB took 3.4 s.
 *
 * @internal
 */
const MAX_WILDCARD_ALTERNATIVES = 256;

/** A numeric brace sequence, `{lo..hi}` or `{lo..hi..step}`. */
const NUMERIC_SEQUENCE = /\{([-+]?\d+)\.\.([-+]?\d+)(?:\.\.[-+]?\d+)?\}/g;
/** A one-character brace sequence, `{a..z}` or `{a..z..step}`. */
const CHARACTER_SEQUENCE = /\{([^\\{},])\.\.([^\\{},])(?:\.\.[-+]?\d+)?\}/g;

/**
 * An upper bound on how many alternatives brace expansion can make of a
 * pattern, computed without expanding it.
 *
 * Every alternative-making group opens at an unescaped `{` (brace
 * expansion's own rewrites turn a `}` literal; they never add a `{`). A comma
 * group makes at most one alternative per part, a part at most (unescaped
 * commas in the whole pattern + 1); a sequence makes at most `|hi - lo| + 1`
 * (a step only lowers it). Nesting multiplies, a set of parts sums, and a sum
 * of `k` terms is at most `k` times its largest, so the product, over every
 * unescaped `{`, of the larger of those two per-group bounds bounds the whole.
 * It is loose — `{a,b}/{c,d}` makes 4 and is weighed 9 — and never low. A
 * backslash escapes the next character, as the engine reads a negation; a
 * positive is weighed after its backslashes become `/`, as it is compiled.
 *
 * @internal
 */
export const braceAlternativesBound = (pattern: string): number => {
	let opens = 0;
	let commas = 0;
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index];
		if (character === "\\") index += 1;
		else if (character === "{") opens += 1;
		else if (character === ",") commas += 1;
	}
	if (opens === 0) return 1;
	let widestSequence = 1;
	for (const [, lo, hi] of pattern.matchAll(NUMERIC_SEQUENCE)) {
		widestSequence = Math.max(widestSequence, sequenceSize(lo ?? "0", hi ?? "0"));
	}
	for (const [, lo, hi] of pattern.matchAll(CHARACTER_SEQUENCE)) {
		widestSequence = Math.max(widestSequence, Math.abs((hi?.codePointAt(0) ?? 0) - (lo?.codePointAt(0) ?? 0)) + 1);
	}
	const bound = Math.max(commas + 1, widestSequence) ** opens;
	// Saturate: a bound that is not a safe integer is "too many", never NaN.
	return Number.isSafeInteger(bound) ? bound : Number.POSITIVE_INFINITY;
};

/**
 * `|hi - lo| + 1` for a numeric sequence's endpoints, or `Infinity` when
 * either endpoint is past `Number.MAX_SAFE_INTEGER` or the size is. Brace
 * expansion reads an endpoint as a double, and one too large for it becomes
 * `Infinity`, which it then counts towards forever (to its own expansion
 * cap): `{9…9..9…9}` with 400 digits makes 100,000 alternatives, not one. The
 * endpoints are read as `BigInt`, so two of them never subtract to `NaN`.
 */
const sequenceSize = (lo: string, hi: string): number => {
	const max = BigInt(Number.MAX_SAFE_INTEGER);
	const low = BigInt(lo);
	const high = BigInt(hi);
	if (low > max || low < -max || high > max || high < -max) return Number.POSITIVE_INFINITY;
	const span = high - low;
	const size = (span < 0n ? -span : span) + 1n;
	return size > max ? Number.POSITIVE_INFINITY : Number(size);
};

/** Characters that make a pattern more than a plain path, conservatively. */
const GLOB_SYNTAX = /[*?[\]{}()!+@#\\,]/;

/**
 * The directory a literal pattern names, or `undefined` for a pattern that
 * takes a glob match: any glob syntax, an empty pattern, a doubled slash, or
 * a `.`/`..` segment. One trailing `/` is dropped, which is how a literal
 * pattern matches as both include (`dir/`) and ignore (`dir` or `dir/`).
 *
 * @internal
 */
const literalKey = (pattern: string): string | undefined => {
	if (pattern === "" || GLOB_SYNTAX.test(pattern) || pattern.includes("//")) return undefined;
	const key = pattern.endsWith("/") ? pattern.slice(0, -1) : pattern;
	if (key === "" || key.split("/").some((segment) => segment === "." || segment === "..")) return undefined;
	return key;
};

/**
 * A positive pattern with any trailing run of `/.` segments, and one `/` after
 * the run, dropped: `packages/a/.`, `packages/a/./` and `packages/a/./.` all
 * become `packages/a`. A pattern with no such run, or one that would become
 * empty, is kept as written.
 *
 * An index walk from the end, linear in the run it drops. The pattern is
 * untrusted, and the regex this replaced (`/(?:\/\.)+\/?$/`) retried its run
 * from every start position, so a long `/./.…x` cost quadratic time (32 s for
 * a 488 KB pattern) before any length guard could refuse it.
 */
export const stripTrailingDot = (pattern: string): string => {
	const end = pattern.endsWith("/") ? pattern.length - 1 : pattern.length;
	let stop = end;
	while (stop >= 2 && pattern.charCodeAt(stop - 1) === 46 && pattern.charCodeAt(stop - 2) === 47) stop -= 2;
	return stop === end || stop === 0 ? pattern : pattern.slice(0, stop);
};

/**
 * Compile the workspace pattern at `index` of the declaration, or the typed
 * validation failure naming that index and the guard glob tripped
 * (`PatternTooLong`, `CompileBudgetExceeded`, …). There is no fallback
 * reading: a pattern the parser cannot read would leave every link row
 * misclassified one way or the other.
 */
export const compileGlob = (
	index: number,
	source: string,
	options?: GlobPatternOptions,
): Result.Result<GlobPattern, ParseFailure> =>
	Result.mapError(GlobPattern.compileResult(source, options), (error) =>
		validationFailure(
			new Error(
				`the root entry's workspaces pattern at index ${index} will not compile: ` +
					`${error.reason} (limit ${error.limit}, actual ${error.actual})`,
				{ cause: error },
			),
		),
	);

/**
 * glob's ignore options, which npm's negated workspace patterns are matched
 * under: always `dot`, never comment or negation.
 */
const IGNORE_OPTIONS = GlobPatternOptions.make({ dot: true, nocomment: true, nonegate: true });

/**
 * One negated workspace pattern, compiled once when it is read: `plain` under
 * minimatch's defaults, which is how `map-workspaces` tests a later pattern
 * against it, and `ignore` under {@link IGNORE_OPTIONS}, which is how glob
 * tests a directory against it.
 */
interface Negation {
	readonly pattern: string;
	readonly plain: GlobPattern;
	readonly ignore: GlobPattern;
}

/**
 * Whether a link row's target directory is a workspace, read from the root
 * entry's `workspaces` globs the way npm's own `@npmcli/map-workspaces` reads
 * them.
 *
 * npm writes every symlinked dependency the same way — `{ resolved, link:
 * true }` — whether its target is a workspace or a `file:` directory that is
 * not one, so the globs are the only record that tells them apart. The
 * reading follows `map-workspaces` 5 and the glob 13 `Ignore` it hands
 * negations to:
 *
 * - the declaration is the array itself, or the array under `packages`; any
 *   other shape, or no field at all, declares no workspaces;
 * - a run of leading `!` negates when it is odd and is dropped when even, and
 *   one leading `./` or `/` (with any extra slashes) is stripped;
 * - a later positive pattern that a negation matches, read as a path, cancels
 *   that negation, and a positive pattern a surviving negation matches is
 *   dropped;
 * - a positive pattern matches directories, so it is matched with a trailing
 *   `/` against the directory with one, under glob's defaults (no `dot`);
 * - a negation is an ignore, matched with `dot`: it ignores a directory it
 *   matches with or without a trailing `/` (which, ending in `/**`, already
 *   covers every directory beneath one it matches); anything under
 *   `node_modules` is always ignored.
 *
 * A field declaring more than {@link MAX_WORKSPACE_PATTERNS} patterns fails
 * typed at validation, as does one whose patterns exceed
 * {@link MAX_WILDCARD_WORKSPACE_PATTERNS} wildcards or
 * {@link MAX_WILDCARD_ALTERNATIVES} brace alternatives, one holding a matched
 * pattern longer than {@link MAX_WILDCARD_PATTERN_LENGTH} characters, and one
 * holding a pattern glob will not compile (its cause names the pattern's index and
 * glob's reason). There is no fallback reading.
 *
 * The decision is made once per directory: one compile per pattern, then
 * (negations × positives) matches for the cancellation and two matches per
 * negation, plus one per positive, for each distinct link target.
 *
 * @internal
 */
const workspaceMatcher = (
	root: NpmPackageEntryType | undefined,
): Result.Result<(path: string) => boolean, ParseFailure> => {
	const raw = root?.workspaces;
	const packagesField =
		typeof raw === "object" && raw !== null && !Array.isArray(raw) && Object.hasOwn(raw, "packages")
			? (raw as { readonly packages: unknown }).packages
			: undefined;
	const declared = Array.isArray(packagesField) ? packagesField : raw;
	if (!Array.isArray(declared)) return Result.succeed(() => false);
	if (declared.length > MAX_WORKSPACE_PATTERNS) {
		return Result.fail(
			validationFailure(
				new Error(
					`the root entry's workspaces field declares ${declared.length} patterns, ` +
						`more than the ${MAX_WORKSPACE_PATTERNS} this parser reads`,
				),
			),
		);
	}
	// Read every pattern, and weigh the wildcard ones, before compiling any:
	// a compile expands braces, so an over-budget pattern must be refused
	// before it is built.
	const read: Array<{ readonly index: number; readonly negated: boolean; readonly pattern: string }> = [];
	let wildcards = 0;
	let alternatives = 0;
	for (const [index, entry] of declared.entries()) {
		if (typeof entry !== "string") continue;
		const bangs = /^!+/.exec(entry)?.[0].length ?? 0;
		const pattern = entry.slice(bangs).replace(/^\.?\/+/, "");
		const negated = bangs % 2 === 1;
		read.push({ index, negated, pattern });
		// Every negation is compiled, and so is every positive that is not a
		// plain path once its trailing `/.` run is dropped; each is matched,
		// and a match can cost far more than linear time, so each is capped.
		const compiledAs = negated ? pattern : stripTrailingDot(pattern.replace(/\\/g, "/"));
		if ((negated || literalKey(compiledAs) === undefined) && compiledAs.length > MAX_WILDCARD_PATTERN_LENGTH) {
			return Result.fail(
				validationFailure(
					new Error(
						`the root entry's workspaces pattern at index ${index} is ${compiledAs.length} characters long, ` +
							`more than the ${MAX_WILDCARD_PATTERN_LENGTH} this parser reads for a pattern it matches`,
					),
				),
			);
		}
		if (literalKey(pattern) !== undefined) continue;
		wildcards += 1;
		// A positive is compiled with backslashes turned to `/`, so it is
		// weighed as compiled; a negation is compiled as written.
		alternatives += braceAlternativesBound(negated ? pattern : pattern.replace(/\\/g, "/"));
	}
	if (wildcards > MAX_WILDCARD_WORKSPACE_PATTERNS) {
		return Result.fail(
			validationFailure(
				new Error(
					`the root entry's workspaces field declares ${wildcards} wildcard patterns, ` +
						`more than the ${MAX_WILDCARD_WORKSPACE_PATTERNS} this parser reads`,
				),
			),
		);
	}
	// Fail closed: anything not provably within the budget is over it.
	if (!(alternatives <= MAX_WILDCARD_ALTERNATIVES)) {
		return Result.fail(
			validationFailure(
				new Error(
					`the root entry's workspaces field's wildcard patterns may expand to ${Number.isFinite(alternatives) ? alternatives : "unboundedly many"} brace alternatives, ` +
						`more than the ${MAX_WILDCARD_ALTERNATIVES} this parser reads`,
				),
			),
		);
	}

	// Every pattern is compiled exactly once; what follows is only matching.
	// The cancellation and eager-removal steps match each negation against
	// each positive pattern, as `map-workspaces` does, so the cost is one
	// compile per pattern plus (negations × positives) matches.
	const positives: Array<{ readonly index: number; readonly pattern: string }> = [];
	let negations: Array<Negation> = [];
	for (const { index, negated, pattern } of read) {
		if (negated) {
			const plain = compileGlob(index, pattern);
			if (Result.isFailure(plain)) return Result.fail(plain.failure);
			const ignore = compileGlob(index, pattern, IGNORE_OPTIONS);
			if (Result.isFailure(ignore)) return Result.fail(ignore.failure);
			negations.push({ pattern, plain: plain.success, ignore: ignore.success });
			continue;
		}
		negations = negations.filter((negation) => !negation.plain.matches(pattern));
		positives.push({ index, pattern });
	}

	// A literal pattern is decided by a set lookup, a wildcard one by a match:
	// per directory, the cost is one lookup per set plus one match per
	// wildcard pattern, whatever the literal count.
	const surviving = positives.filter(({ pattern }) => !negations.some((negation) => negation.plain.matches(pattern)));
	const literalIncludes = new Set<string>();
	const includes: Array<GlobPattern> = [];
	for (const { index, pattern } of surviving) {
		// A positive pattern ending in `/.` (or `/./`) names the directory
		// itself to npm — glob's walk resolves the trailing `.` — so the
		// trailing segment is dropped before matching. Negations keep it:
		// `!packages/b/.` ignores nothing, in npm and here (fixture
		// `npm/workspacedotend`).
		const slashed = stripTrailingDot(pattern.replace(/\\/g, "/"));
		const key = literalKey(slashed);
		if (key !== undefined) {
			literalIncludes.add(key);
			continue;
		}
		const glob = compileGlob(index, slashed.endsWith("/") ? slashed : `${slashed}/`);
		if (Result.isFailure(glob)) return Result.fail(glob.failure);
		includes.push(glob.success);
	}
	if (includes.length === 0 && literalIncludes.size === 0) return Result.succeed(() => false);
	const literalIgnores = new Set<string>();
	const ignores: Array<GlobPattern> = [];
	for (const negation of negations) {
		const key = literalKey(negation.pattern);
		if (key !== undefined) literalIgnores.add(key);
		else ignores.push(negation.ignore);
	}

	// glob also ignores everything beneath a directory a negation ending in
	// `/**` matches (its `childrenIgnored`), but that adds nothing here. If
	// `P/**` matches an ancestor `A/`, `P` matched a prefix of `A`, and in a
	// normalized `resolved` path everything past `A` is a child name, which
	// `**` takes under `dot`, so `P/**` matches the directory itself — the
	// direct test above. A leading run of `..` is no exception: those
	// segments are parents, never children, and glob does not apply the rule
	// to them (`!../**` does not ignore `../../x`; real npm agrees, fixture
	// `npm/workspaceclimb`). So a directory costs two matches per negation,
	// never one per ancestor.
	const ignored = (dir: string): boolean =>
		dir.split("/").includes("node_modules") ||
		literalIgnores.has(dir) ||
		ignores.some((ignore) => ignore.matches(dir) || ignore.matches(`${dir}/`));
	// Decided once per directory: both parser passes ask, and npm writes one
	// link row per name a workspace is reached by.
	const decided = new Map<string, boolean>();
	return Result.succeed((dir) => {
		if (dir === "") return false;
		const known = decided.get(dir);
		if (known !== undefined) return known;
		const answer = (literalIncludes.has(dir) || includes.some((glob) => glob.matches(`${dir}/`))) && !ignored(dir);
		decided.set(dir, answer);
		return answer;
	});
};

/**
 * A link row's `resolved` as the workspace decision reads it: `.` segments
 * and empty segments (a doubled or trailing `/`) dropped. `..` is kept as
 * written and never resolved against what precedes it.
 *
 * The matcher assumes the path is normalized the way npm writes `resolved`
 * (POSIX separators, no `.` or empty segment, `..` only as a leading run), and
 * that assumption is what lets a plain path be a set lookup and a `/**`
 * negation be tested against the directory alone. This makes a hand-written
 * `packages/a/`, `./packages/a` or `packages//a` decide as `packages/a`
 * does. An absolute path keeps its leading `/`. An empty result names no
 * directory, and is no workspace.
 *
 * @internal
 */
const workspaceDirOf = (resolved: string): string => {
	const dir = resolved
		.split("/")
		.filter((segment) => segment !== "" && segment !== ".")
		.join("/");
	// An absolute path keeps its root; nothing else is anchored to one.
	return resolved.startsWith("/") && dir !== "" ? `/${dir}` : dir;
};

const entrySections = (entry: NpmPackageEntryType | undefined) =>
	[entry?.dependencies, entry?.devDependencies, entry?.optionalDependencies, entry?.peerDependencies] as const;

/**
 * Parse npm `package-lock.json` content into the unified field bundle —
 * `lockfileVersion` 3 and newer; v2 and older fail typed at validation.
 * Native `JSON.parse` inside `Effect.try` — its throw on hostile input
 * (including V8's `RangeError` on pathological depth) lands typed as
 * `stage: "syntax"`.
 *
 * @internal
 */
export const parseNpm = (content: string): Effect.Effect<LockfileFields, ParseFailure> =>
	Effect.gen(function* () {
		const raw = yield* Effect.try({
			try: () => JSON.parse(content) as unknown,
			catch: syntaxFailure,
		});
		// Format-version gate: npm lockfileVersion 3 and newer. v1/v2 trees record
		// resolution in a different shape this parser does not model.
		//
		// It runs BEFORE the shape decode, and must: a v1 tree carries no
		// `packages` object at all, so decoding first would report the oldest
		// format we reject as merely malformed. "Too old" is the more specific
		// true statement, and the only one a consumer can act on.
		const probe = yield* Schema.decodeUnknownEffect(NpmVersionProbe)(raw).pipe(Effect.mapError(validationFailure));
		yield* requireLockfileVersion("npm", probe.lockfileVersion);
		const validated = yield* Schema.decodeUnknownEffect(NpmLockfileRaw)(raw).pipe(Effect.mapError(validationFailure));
		return yield* toFields(validated);
	});

// ── Transform ──────────────────────────────────────────────────────────────

const toFields = (raw: NpmLockfileRawType): Effect.Effect<LockfileFields, ParseFailure> =>
	Effect.gen(function* () {
		const packages: Array<ResolvedPackage> = [];
		const workspaceNames = new Set<string>();
		const workspaceEntries = new Map<string, WorkspaceEntry>();
		const importers: Array<LockfileImporter> = [];
		/** Workspace directories already given an importer, so a second link row to one adds none. */
		const importerPaths = new Set<string>();

		// npm records concrete versions on the `node_modules/*` entries, not per
		// importer, so every importer dependency carries a specifier and no version.
		// The root manifest is the `""` entry — the `"."` importer.
		const rootEntry = raw.packages[""];
		if (rootEntry) {
			importers.push(
				LockfileImporter.make({ path: ".", dependencies: importerDependencies(rootEntry, (s) => ({ specifier: s })) }),
			);
		}

		// First pass: identify workspace link entries. Name resolution must match
		// the second pass (wsEntry first) or a link stub disagreeing with its
		// resolved entry drops inter-workspace edges.
		const isWorkspaceDir = yield* Effect.fromResult(workspaceMatcher(rootEntry));
		const isWorkspaceLink = (entry: NpmPackageEntryType): boolean =>
			entry.link === true && entry.resolved !== undefined && isWorkspaceDir(workspaceDirOf(entry.resolved));
		for (const [key, entry] of Object.entries(raw.packages)) {
			const nameIndex = packageNameIndex(key);
			if (nameIndex !== -1 && isWorkspaceLink(entry)) {
				const wsEntry = entry.resolved !== undefined ? raw.packages[entry.resolved] : undefined;
				const name = wsEntry?.name ?? entry.name ?? key.slice(nameIndex);
				if (name !== "") workspaceNames.add(name);
			}
		}

		// Second pass: build packages and workspace entries.
		for (const [key, entry] of Object.entries(raw.packages)) {
			if (key === "") continue; // root entry
			// Every key that names a package position, at any nesting depth —
			// `node_modules/x`, `node_modules/x/node_modules/y` and the workspace
			// form `packages/lib/node_modules/y` alike. A key that names none (a
			// workspace path entry) is reached through its link entry instead.
			const nameIndex = packageNameIndex(key);
			if (nameIndex === -1) continue;

			if (entry.link === true && !isWorkspaceLink(entry)) {
				// A link to a directory that is no workspace — a `file:` directory
				// dependency. Its package data lives at the resolved path entry, but
				// it is a plain package: no workspace row, no importer.
				const resolved = entry.resolved;
				const target = resolved !== undefined ? raw.packages[resolved] : undefined;
				const name = target?.name ?? entry.name ?? key.slice(nameIndex);
				if (name === "") continue; // a nameless entry cannot be modeled; skip, never throw
				packages.push(
					ResolvedPackage.make({
						name,
						version: target?.version ?? "0.0.0",
						instanceId: key,
						isWorkspace: false,
						dependencies: target?.dependencies ?? {},
						...peerDeclarations(target?.peerDependencies, target?.peerDependenciesMeta),
						resolved: resolveNpmEdges(
							resolved !== undefined && resolved !== "" ? resolved : key,
							entrySections(target),
							raw.packages,
						),
					}),
				);
			} else if (entry.link === true) {
				// Workspace link — actual package data lives at the resolved path entry.
				const resolved = entry.resolved;
				const wsEntry = resolved !== undefined ? raw.packages[resolved] : undefined;
				const name = wsEntry?.name ?? entry.name ?? key.slice(nameIndex);
				if (name === "") continue; // a nameless entry cannot be modeled; skip, never throw
				packages.push(
					ResolvedPackage.make({
						name,
						version: wsEntry?.version ?? "0.0.0",
						instanceId: key,
						isWorkspace: true,
						...(resolved !== undefined ? { relativePath: resolved } : {}),
						// A workspace link entry is a stub; its manifest sections —
						// peers included — live on the resolved path entry.
						...peerDeclarations(wsEntry?.peerDependencies, wsEntry?.peerDependenciesMeta),
						// Resolution starts from the workspace *directory*, which is where
						// npm nests a workspace-local copy (`packages/lib/node_modules/x`).
						resolved: resolveNpmEdges(
							resolved !== undefined && resolved !== "" ? resolved : key,
							entrySections(wsEntry),
							raw.packages,
						),
					}),
				);
				if (wsEntry) {
					workspaceEntries.set(name, {
						...(wsEntry.dependencies ? { dependencies: wsEntry.dependencies } : {}),
						...(wsEntry.devDependencies ? { devDependencies: wsEntry.devDependencies } : {}),
						...(wsEntry.peerDependencies ? { peerDependencies: wsEntry.peerDependencies } : {}),
						...(wsEntry.optionalDependencies ? { optionalDependencies: wsEntry.optionalDependencies } : {}),
					});
				}
				// An empty resolved path is malformed: `LockfileImporter.path` is a
				// `NonEmptyString`, so constructing one from "" would die as a defect.
				// Skip the row before construction, per the total-skip discipline.
				// npm writes one link row per name a workspace is reached by, so an
				// aliased `file:` dependency on a workspace adds a second row with the
				// same target. The importer is the directory: one per target.
				if (resolved !== undefined && resolved !== "" && !importerPaths.has(resolved)) {
					importerPaths.add(resolved);
					importers.push(
						LockfileImporter.make({
							path: resolved,
							dependencies: wsEntry ? importerDependencies(wsEntry, (s) => ({ specifier: s })) : [],
						}),
					);
				}
			} else {
				// Regular resolved package, at any depth.
				const name = key.slice(nameIndex);
				if (name !== "" && entry.version !== undefined) {
					const integrity = yield* toIntegrityHash(entry.integrity);
					packages.push(
						ResolvedPackage.make({
							name,
							version: entry.version,
							instanceId: key,
							...(integrity !== undefined ? { integrity } : {}),
							isWorkspace: false,
							dependencies: entry.dependencies ?? {},
							...peerDeclarations(entry.peerDependencies, entry.peerDependenciesMeta),
							resolved: resolveNpmEdges(key, entrySections(entry), raw.packages),
						}),
					);
				}
			}
		}

		const workspaceDependencies = extractWorkspaceDeps(workspaceEntries, workspaceNames);

		return {
			lockfileVersion: String(raw.lockfileVersion),
			packages,
			workspaceDependencies,
			importers,
		};
	});
