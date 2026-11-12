// Seeded triple generation for the differential runner: (pattern, path,
// options) from a weighted alphabet of token classes. Pure and deterministic
// for a seed, so a divergence reproduces from its seed and index.

import type { EngineOptions } from "../../src/internal/minimatch.js";

export interface Triple {
	readonly pattern: string;
	readonly path: string;
	readonly options: EngineOptions;
}

/** A named group of pattern tokens with a weight; a class with weight 0 is off. */
export interface TokenClass {
	readonly tokens: ReadonlyArray<string>;
	readonly weight: number;
}

export type Alphabet = Readonly<Record<string, TokenClass>>;

export const DEFAULT_ALPHABET: Alphabet = {
	literal: { tokens: ["a", "b", "abc", "x-y", "a.b", ".hidden", "..", ".", "😀", "aa", "ab"], weight: 6 },
	sep: { tokens: ["/", "/", "//"], weight: 3 },
	star: { tokens: ["*", "**", "*a", "a*", "**/", "/**"], weight: 4 },
	qmark: { tokens: ["?", "??"], weight: 2 },
	class: {
		tokens: ["[ab]", "[a-c]", "[!a]", "[^b]", "[]a]", "[a", "]", "[[:alpha:]]", "[[:digit:]]", "[a-a]", "[😀]"],
		weight: 3,
	},
	extglob: {
		tokens: [
			"@(a|b)",
			"*(a)",
			"+(a|?)",
			"?(a|b)",
			"!(a)",
			"!(a|b)",
			"@(",
			"*(a|*(b))",
			"!(!(a))",
			"@()",
			"+(|)",
			"*()",
		],
		weight: 4,
	},
	nestedExtglob: {
		tokens: ["@(a|@(b|@(c|*(d))))", "+(*(a|b)|c)", "!(+(a)|*(b))", "*(*(*(a)))", "+(+(+(a|b)))", "!(*(a)x)"],
		weight: 1,
	},
	brace: {
		tokens: [
			"{a,b}",
			"{a,b,c}",
			"{1..3}",
			"{a..c}",
			"{,a}",
			"{a,}",
			"{0..199}",
			"{x,{0..120}}",
			"{Z..a}",
			"a{,b}",
			"{a}",
			"{}",
		],
		weight: 2,
	},
	escape: { tokens: ["\\*", "\\?", "\\[", "\\\\", "\\a", "\\"], weight: 1 },
	negate: { tokens: ["!", "!!", "#"], weight: 1 },
};

const OPTION_FLAGS = [
	"nobrace",
	"nocomment",
	"nonegate",
	"noglobstar",
	"noext",
	"windowsPathsNoEscape",
	"partial",
	"dot",
	"nocase",
	"nocaseMagicOnly",
	"magicalBraces",
	"matchBase",
	"flipNegate",
	"preserveMultipleSlashes",
	"optimizationLevel",
] as const;

const PATH_SEGMENTS = [
	"a",
	"b",
	"abc",
	".hidden",
	"..",
	".",
	"x-y",
	"😀",
	"ab",
	"aab",
	"a.b",
	"",
	"A",
	"B",
	"150",
	"a)",
];

/** mulberry32: small, fast, good enough for fuzz input. */
export const rng = (seed: number): (() => number) => {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
};

const pick = <A>(r: () => number, xs: ReadonlyArray<A>): A => xs[Math.floor(r() * xs.length)] as A;

const weighted = (r: () => number, alphabet: Alphabet): ReadonlyArray<string> => {
	const entries = Object.values(alphabet).filter((c) => c.weight > 0 && c.tokens.length > 0);
	const total = entries.reduce((n, c) => n + c.weight, 0);
	let x = r() * total;
	for (const c of entries) {
		x -= c.weight;
		if (x < 0) return c.tokens;
	}
	return (entries[entries.length - 1] as TokenClass).tokens;
};

export interface GenerateConfig {
	readonly seed: number;
	readonly alphabet: Alphabet;
	readonly platforms: ReadonlyArray<"posix" | "win32">;
	/** Pattern length in tokens, inclusive. */
	readonly minTokens: number;
	readonly maxTokens: number;
}

const genOptions = (r: () => number, platform: "posix" | "win32"): EngineOptions => {
	const o: Record<string, unknown> = { platform };
	// most triples run on default options; the rest turn on a few flags
	if (r() < 0.45) return o as EngineOptions;
	const n = 1 + Math.floor(r() * 3);
	for (let i = 0; i < n; i++) {
		const flag = pick(r, OPTION_FLAGS);
		o[flag] = flag === "optimizationLevel" ? pick(r, [0, 1, 2]) : true;
	}
	return o as EngineOptions;
};

const genPath = (r: () => number, pattern: string, platform: "posix" | "win32"): string => {
	// four in ten paths are the pattern with its syntax stripped, which lands
	// on matches far more often than independent segments do
	if (r() < 0.4) {
		const stripped = pattern.replace(/[*?[\]()|!@+{}\\]/g, "").replace(/,/g, "");
		if (stripped.length > 0 && r() < 0.8) return stripped;
	}
	const n = 1 + Math.floor(r() * 4);
	const sep = platform === "win32" && r() < 0.4 ? "\\" : "/";
	const segs: Array<string> = [];
	for (let i = 0; i < n; i++) segs.push(pick(r, PATH_SEGMENTS));
	return segs.join(sep);
};

/** Triple number `index` of a seed: independent of the others, so a run can resume or shard. */
export const generate = (cfg: GenerateConfig, index: number): Triple => {
	const r = rng((cfg.seed * 2654435761 + index * 40503) >>> 0);
	const platform = pick(r, cfg.platforms);
	const len = cfg.minTokens + Math.floor(r() * (cfg.maxTokens - cfg.minTokens + 1));
	let pattern = "";
	for (let i = 0; i < len; i++) pattern += pick(r, weighted(r, cfg.alphabet));
	return { pattern, path: genPath(r, pattern, platform), options: genOptions(r, platform) };
};
